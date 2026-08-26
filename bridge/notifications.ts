import { notifyContent } from "./notify-content.ts";
import type { PushMessage } from "./push.ts";
import { paneDisplayName, type AgentStatus, type AgentView } from "./types.ts";

// A notification shouldn't be fire-and-forget. This coordinator gives every blocked/done alert a
// lifecycle and collapses the herd into a single, always-accurate notification:
//
//   • Debounce + cancel — an agent that blocks and unblocks within the window (you handled it at your
//     desk) never reaches your phone. Herdr exposes no "user present" signal (only a `focused` pane,
//     no activity timestamp), so we infer presence: a quickly-resolved transition is an at-desk one.
//   • Coalesce — instead of N stacked notifications, we keep ONE summary of everything currently
//     outstanding: the named agent when exactly one needs you, or "N agents need you" for several.
//     Each change re-renders that single summary; when the last one resolves, we clear it.
//   • Retract — clearing an agent at the PC (or its pane closing) updates or removes the summary, so
//     handled work never lingers on your lock screen.
//
// Pure and clock-injected so `bun test` drives it without real timers: the bridge passes
// setTimeout/clearTimeout (see server.ts); tests pass a fake clock they fire on demand.

type NotifiableStatus = "blocked" | "done";

/** The timer primitive the coordinator schedules against — real setTimeout in the bridge, fake in tests. */
export interface NotifyClock<H> {
  schedule(fn: () => void, delayMs: number): H;
  cancel(handle: H): void;
}

/** The current state of the herd's single notification, derived from everything outstanding. */
export interface HerdSummary {
  /** Headline: "Needs you · <subject>" for one (notify-content.ts), or "3 agents need you" for several. */
  title: string;
  /** Sub-line: "<repo> · <what happened>" for one outstanding alert, or the agent names for a digest. */
  body: string;
  /** Deep-link target when exactly one alert is outstanding; undefined for a multi-agent digest. */
  paneId?: string;
  /** Re-alert (buzz) the device — true when a new alert arrived, false on a silent retraction update. */
  renotify: boolean;
}

export interface NotifySink {
  /** Render (or replace) the herd's single notification. */
  render(summary: HerdSummary): void;
  /** Close the herd notification — nothing is outstanding any more. */
  clear(): void;
}

/** Just the transport the sink needs — "deliver this message to the devices". */
export interface PushSender {
  send(msg: PushMessage): unknown;
}
/** Just the quiet-hours check the sink needs — "are we muted right now?". */
export interface MuteGate {
  isMuted(): boolean;
}

/**
 * Build the {@link NotifySink} the coordinator drives. One session's whole herd shares one
 * notification slot (`herdTag`), so a render replaces rather than stacks; an active snooze mutes both
 * render and clear (nothing is shown, so there's nothing to close). `sessionName` (the registry name)
 * is stamped into the push payload so the service worker can deep-link to the right session — omit it
 * (undefined) for the primary, keeping its payload byte-identical to the single-session case. Kept
 * here, decoupled from `Push`/`Snooze`, so the gating + summary→message mapping is unit-testable.
 */
export function makeNotifySink(
  push: PushSender,
  mute: MuteGate,
  herdTag: string,
  sessionName?: string,
): NotifySink {
  return {
    render: (s) => {
      if (mute.isMuted()) return;
      const msg: PushMessage = { title: s.title, body: s.body, tag: herdTag, paneId: s.paneId, renotify: s.renotify };
      if (sessionName !== undefined) msg.session = sessionName;
      void push.send(msg);
    },
    clear: () => {
      if (mute.isMuted()) return;
      void push.send({ type: "clear", tag: herdTag });
    },
  };
}

export interface Alert {
  agent: string;
  workspaceLabel: string;
  cwd: string;
  status: NotifiableStatus;
  /**
   * Rename ingredients + the card title. The card title is the push's SUBJECT (notify-content.ts);
   * the rename ingredients name the alert in the bell's history and the multi-agent digest, exactly
   * like the in-app toast does (`paneDisplayName`).
   */
  paneLabel?: string;
  sessionName?: string;
  kind?: "agent" | "shell";
  cardTitle?: string;
  /** The card this pane backs, and the agent's own session id — carried through for notify-subtitle.ts,
   *  which needs them to ask the copilot for a one-line account of what actually happened (the card's
   *  spec, its diff stat, the agent's last transcript message). Absent for a hand-launched pane, which
   *  the copilot then has nothing beyond the base body to improve on. */
  cardId?: string;
  agentSessionId?: string;
  /** What actually happened, filled in BEFORE the alert fires by the coordinator's `subtitleFor`
   *  hook (notify-subtitle.ts's free tiers), then overwritten in place by the copilot's later
   *  rephrase. Read by `summarize` — this is why the very first push already carries a body. */
  subtitle?: string;
}

/** An alert that has just fired, as handed to the history hook. */
export interface FiredAlert extends Alert {
  paneId: string;
}

export class NotificationCoordinator<H = unknown> {
  /** paneId → debouncing alert (timer + its kind) that hasn't entered the summary yet. */
  private readonly pending = new Map<string, { handle: H; status: NotifiableStatus }>();
  /** paneId → alert that has fired and is reflected in the current summary (insertion-ordered). */
  private readonly outstanding = new Map<string, Alert>();

  constructor(
    private readonly clock: NotifyClock<H>,
    private readonly sink: NotifySink,
    private readonly delayMs: number,
    // Whether a transition into a status should notify, read live from the prefs store so a runtime
    // change is honoured. A disabled kind behaves exactly like a non-notifiable status (idle/working).
    private readonly isNotifiable: (status: AgentStatus) => boolean,
    // Called once per alert that survives the debounce, BEFORE the sink's mute gate — the history
    // (bridge/notify-log.ts) records what pinged, including during quiet hours, which is precisely
    // the ping you go looking for afterwards. A retraction never reaches it: the summary changes,
    // what happened doesn't.
    private readonly onFire?: (alert: FiredAlert) => void,
    // Awaited between the debounce expiring and the alert being rendered: what actually happened,
    // if it can be had cheaply (notify-subtitle.ts's free tiers). THE FIRST PUSH IS THE ONLY ONE
    // THAT BUZZES — the collapse topic means a sleeping phone receives only the last message on the
    // slot, so a body that lands in a later silent update never reaches it (NOTIFY_AUDIT.md §N10).
    // The producer owns the deadline; a hook that hangs must cost the body, never the alert.
    private readonly subtitleFor?: (alert: FiredAlert) => Promise<string | null>,
  ) {}

  /** Wire to `StateEngine.onTransition`. */
  onTransition(agent: AgentView, _from: AgentStatus, to: AgentStatus): void {
    const id = agent.paneId;
    if (!this.isNotifiable(to)) {
      // Resolved to a non-notifiable (or preference-disabled) state: drop a still-pending alert,
      // retract a delivered one.
      this.resolve(id);
      return;
    }
    // (Re)arm the debounce. A blocked→done flip lands here too, so only the latest verb survives.
    this.cancelPending(id);
    const alert: Alert = {
      agent: agent.agent,
      workspaceLabel: agent.workspaceLabel,
      cwd: agent.cwd,
      status: to as NotifiableStatus,
      paneLabel: agent.paneLabel,
      sessionName: agent.sessionName,
      kind: agent.kind,
      cardTitle: agent.cardTitle,
      cardId: agent.cardId,
      agentSessionId: agent.agentSessionId,
    };
    const handle = this.clock.schedule(() => void this.fire(id, alert), this.delayMs);
    this.pending.set(id, { handle, status: alert.status });
  }

  /** Wire to `StateEngine.onRemove` — a vanished pane is implicitly resolved. */
  onRemove(paneId: string): void {
    this.resolve(paneId);
  }

  /**
   * The outstanding alert for `paneId`, but ONLY when it's the sole one outstanding — the one shape a
   * copilot-authored subtitle (notify-subtitle.ts) is allowed to silently replace the push body for.
   * Undefined once the alert has resolved, or once a second one joined it and the summary became a
   * multi-agent digest — either way, a subtitle answered against the old, single-alert shape would be
   * stale or would land on the wrong notification.
   */
  currentSolo(paneId: string): Alert | undefined {
    return this.outstanding.size === 1 ? this.outstanding.get(paneId) : undefined;
  }

  /**
   * Re-evaluate every pending + outstanding alert against the current prefs after they change,
   * dropping any whose kind is now disabled: cancel a still-debouncing timer, retract a delivered
   * alert. Retractions re-emit the shrunk summary (or a clear) once, silently. Call after the prefs
   * store is updated (see the /api/notifications/prefs route).
   */
  applyPrefs(): void {
    // Drop pending timers for a now-disabled kind — nothing was shown yet, so no re-emit is needed.
    for (const [id, p] of [...this.pending]) {
      if (!this.isNotifiable(p.status)) this.cancelPending(id);
    }
    // Retract delivered alerts of a now-disabled kind; re-emit the shrunk summary once if any went.
    let removed = false;
    for (const [id, a] of [...this.outstanding]) {
      if (!this.isNotifiable(a.status)) {
        this.outstanding.delete(id);
        removed = true;
      }
    }
    if (removed) this.emit(false);
  }

  /**
   * Tear down this session's notifications: cancel every pending timer and retract everything
   * outstanding, closing the herd slot. Called when a session is disposed (its socket vanished) so
   * its alerts never linger on the lock screen with no live session behind them.
   */
  clearAll(): void {
    for (const id of [...this.pending.keys()]) this.cancelPending(id);
    const had = this.outstanding.size > 0;
    this.outstanding.clear();
    if (had) this.sink.clear();
  }

  /**
   * The debounce expired: collect what the alert can say, then render it — once. `outstanding` is
   * populated BEFORE the wait so a resolution landing mid-wait is seen (the guard below drops the
   * alert rather than resurrecting it); with no `subtitleFor` hook nothing is ever awaited and this
   * stays as synchronous as it was.
   */
  private async fire(id: string, alert: Alert): Promise<void> {
    this.pending.delete(id);
    this.outstanding.set(id, alert);
    const subtitle = this.subtitleFor
      ? await this.subtitleFor({ ...alert, paneId: id }).catch(() => null)
      : null;
    // ponytail: resolved while we waited — the retraction already emitted, so just stand down. It
    // may have emitted a clear for a slot that never showed; harmless, and the window is ~ms.
    if (!this.outstanding.has(id)) return;
    if (subtitle) alert.subtitle = subtitle;
    this.onFire?.({ ...alert, paneId: id });
    this.emit(true);
  }

  private resolve(id: string): void {
    this.cancelPending(id);
    if (this.outstanding.delete(id)) this.emit(false);
  }

  /** Re-render the single herd summary from whatever's outstanding (or clear it when empty). */
  private emit(renotify: boolean): void {
    if (this.outstanding.size === 0) {
      this.sink.clear();
      return;
    }
    this.sink.render(this.summarize(renotify));
  }

  private summarize(renotify: boolean): HerdSummary {
    const entries = [...this.outstanding.entries()];
    if (entries.length === 1) {
      const [paneId, a] = entries[0]!;
      // One outstanding agent → deep-link straight to its pane on tap. The sentence itself is
      // notify-content.ts's, shared with the copilot's later update to this same slot — which is
      // why an already-filled `subtitle` survives every re-render of the summary.
      return { ...notifyContent(a, a.subtitle ?? null), paneId, renotify };
    }
    const alerts = entries.map(([, a]) => a);
    const n = alerts.length;
    const allBlocked = alerts.every((a) => a.status === "blocked");
    const allDone = alerts.every((a) => a.status === "done");
    const title = allBlocked
      ? `${n} agents need you`
      : allDone
        ? `${n} agents done`
        : `${n} agents need attention`;
    return { title, body: alerts.map((a) => paneDisplayName(a)).join(", "), renotify };
  }

  private cancelPending(id: string): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.clock.cancel(p.handle);
    this.pending.delete(id);
  }
}
