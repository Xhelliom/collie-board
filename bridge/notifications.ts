import { notifyCardId, notifyContent, notifyMarker, repoOf } from "./notify-content.ts";
import type { PushMessage } from "./push.ts";
import { type AgentStatus, type AgentView } from "./types.ts";

// A notification shouldn't be fire-and-forget. This coordinator gives every blocked/done alert a
// lifecycle and collapses the herd into a single, always-accurate notification:
//
//   • Debounce + cancel — an agent that blocks and unblocks within the window (you handled it at your
//     desk) never reaches your phone. Herdr exposes no "user present" signal (only a `focused` pane,
//     no activity timestamp), so we infer presence: a quickly-resolved transition is an at-desk one.
//   • Coalesce — instead of N stacked notifications, we keep ONE summary of everything currently
//     outstanding: the alert's own sentence when exactly one is, or a count-by-state digest for
//     several. Each change re-renders that single summary; when the last one resolves, we clear it.
//   • Retract — clearing an agent at the PC (or its pane closing) updates or removes the summary, so
//     handled work never lingers on your lock screen.
//
// Pure and clock-injected so `bun test` drives it without real timers: the bridge passes
// setTimeout/clearTimeout (see server.ts); tests pass a fake clock they fire on demand.

/**
 * What an alert can be ABOUT. `blocked`/`done` are pane transitions — `done` also the board's own,
 * for a card that reached `review` with no pane behind it (bridge/board-notify.ts, B12) — and
 * `stalled`/`ready` are the board's alone. `stalled` is a card whose work has stopped and which
 * nothing will restart (its pane vanished, or its handoff never landed) — deliberately ONE state for
 * both facts and not one per event, since they are the same decision for the operator (§6.4).
 *
 * `ready` is the one that OPENS a possibility instead of asking for one: the card a finished
 * predecessor was blocking may now be started. It gets its own state precisely because §6.4's test
 * is "is this still 'the work stopped'?" and this is its opposite — and because nothing here ever
 * starts it for you (bridge/cards.ts, "THE DEPENDENCY IS A GATE, NOT A TRIGGER").
 */
export type NotifiableStatus = "blocked" | "done" | "stalled" | "ready";

/** The timer primitive the coordinator schedules against — real setTimeout in the bridge, fake in tests. */
export interface NotifyClock<H> {
  schedule(fn: () => void, delayMs: number): H;
  cancel(handle: H): void;
}

/** The current state of the herd's single notification, derived from everything outstanding. */
export interface HerdSummary {
  /** Headline: "Needs you · <subject>" for one (notify-content.ts), or "1 question, 2 to review". */
  title: string;
  /** Sub-line: "<repo> · <what happened>" for one outstanding alert, or the agent names for a digest. */
  body: string;
  /** Deep-link target when exactly one alert is outstanding; undefined for a multi-agent digest. */
  paneId?: string;
  /** Overrides that deep-link with the CARD, when the alert is about a card to read (see
   *  notify-content.ts's `notifyCardId`). Absent otherwise, so a plain alert's payload is unchanged. */
  cardId?: string;
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
      if (s.cardId !== undefined) msg.cardId = s.cardId;
      void push.send(msg);
    },
    clear: () => {
      if (mute.isMuted()) return;
      void push.send({ type: "clear", tag: herdTag });
    },
  };
}

export interface Alert {
  /**
   * The pane behind the alert — ABSENT when there isn't one. The coordinator's key is opaque (see
   * `pending`/`outstanding`), so an alert about a card carries no pane, and that absence is what
   * routes its tap to the card instead of a terminal (notify-content.ts's `notifyCardId`).
   */
  paneId?: string;
  agent?: string;
  workspaceLabel?: string;
  cwd: string;
  status: NotifiableStatus;
  /**
   * The card title is the SUBJECT of every surface's sentence (notify-content.ts). The rename
   * ingredients are carried for the history entry alone (notify-log.ts) — since N9 no notification
   * names the pane, so nothing reads them today; they stay because dropping a field from the log's
   * wire shape costs more than keeping it.
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
  /** The card's status AS OF THE FIRE, filled in by the `beforeFire` hook alongside the subtitle —
   *  `review` is what turns the marker into `Review` and the tap into a card deep-link (§4.1). Read
   *  there and not at `onTransition` because the board hasn't reconciled the card yet at that point
   *  (§4.2); see notify-content.ts's `cardStatus` for the full ordering argument. */
  cardStatus?: string;
  /** What actually happened, filled in BEFORE the alert fires by the coordinator's `beforeFire`
   *  hook (notify-subtitle.ts's free tiers), then overwritten in place by the copilot's later
   *  rephrase. Read by `summarize` — this is why the very first push already carries a body. */
  subtitle?: string;
}

/** An alert that has just fired, as handed to the history + pre-fire hooks. Nothing is added to it
 *  any more: `paneId` moved onto {@link Alert} itself when the coordinator stopped assuming every
 *  alert has a pane, and the name is kept because it says WHEN the hooks see one. */
export type FiredAlert = Alert;

/**
 * How each state is COUNTED in a digest, in the fixed order they're listed — most urgent first: a
 * blocked agent is stalled on an answer only you can give, a finished card is not. Fixed rather than
 * by-size so the headline doesn't reshuffle itself every time one alert resolves.
 *
 * The count form is why the words differ from the single-alert markers they're keyed by ("1 Needs
 * you" is not a sentence). The MARKERS are the same, from the same `notifyMarker` — so `Review` here
 * and `Review` on its own notification can never mean two different things (§3.5, card N5).
 */
const DIGEST_COUNTS: ReadonlyArray<readonly [ReturnType<typeof notifyMarker>, (n: number) => string]> = [
  ["Needs you", (n) => `${n} question${n > 1 ? "s" : ""}`],
  // A blocked agent is waiting on you NOW, on an open session; a stalled card already stopped, and
  // ten more minutes change nothing — so it reads second. It reads before `Review` for the mirror
  // reason: a review is work you choose to pick up, a stalled card is work that did not happen.
  ["Stalled", (n) => `${n} stalled`],
  ["Review", (n) => `${n} to review`],
  ["Done", (n) => `${n} done`],
  // Last, and it is the whole point of the state: every marker above reports work that wants
  // something from you, this one only says a door opened. Nothing is late because you ignored it.
  ["Ready", (n) => `${n} ready`],
];

/**
 * The digest headline: `1 question, 2 to review` — WHAT is waiting, not how many workers produced it
 * (`3 agents done` counted the one thing that carries no information, §2.1/§3.5). Groups with nothing
 * in them are dropped, so a uniform herd reads `3 to review` and never mentions the empty states.
 */
function digestTitle(alerts: Alert[]): string {
  return DIGEST_COUNTS.map(([marker, say]) => [alerts.filter((a) => notifyMarker(a) === marker).length, say] as const)
    .filter(([n]) => n > 0)
    .map(([n, say]) => say(n))
    .join(", ");
}

export class NotificationCoordinator<H = unknown> {
  // THE KEY IS OPAQUE. It is a pane id for a pane alert because that is the id a transition has;
  // the board keys its own facts `card:<id>` (board-notify.ts). Nothing below reads it as anything
  // but a string — the deep-link comes from the ALERT, not from the key (NOTIFY_AUDIT.md §6.4).
  /** key → debouncing alert (timer + its kind) that hasn't entered the summary yet. */
  private readonly pending = new Map<string, { handle: H; status: NotifiableStatus }>();
  /** key → alert that has fired and is reflected in the current summary (insertion-ordered). */
  private readonly outstanding = new Map<string, Alert>();

  constructor(
    private readonly clock: NotifyClock<H>,
    private readonly sink: NotifySink,
    private readonly delayMs: number,
    // Whether a transition into a status should notify, read live from the prefs store so a runtime
    // change is honoured. A disabled kind behaves exactly like a non-notifiable status (idle/working).
    private readonly isNotifiable: (status: AgentStatus | NotifiableStatus) => boolean,
    // Called once per alert that survives the debounce, BEFORE the sink's mute gate — the history
    // (bridge/notify-log.ts) records what pinged, including during quiet hours, which is precisely
    // the ping you go looking for afterwards. A retraction never reaches it: the summary changes,
    // what happened doesn't.
    private readonly onFire?: (alert: FiredAlert) => void,
    // Awaited between the debounce expiring and the alert being rendered: everything the alert can
    // only learn NOW, after 30 seconds of waiting.
    //   • `subtitle` — what actually happened, if it can be had cheaply (notify-subtitle.ts's free
    //     tiers). THE FIRST PUSH IS THE ONLY ONE THAT BUZZES — the collapse topic means a sleeping
    //     phone receives only the last message on the slot, so a body that lands in a later silent
    //     update never reaches it (NOTIFY_AUDIT.md §N10).
    //   • `cardStatus` — the card's status now that the board has reconciled it, which is the whole
    //     reason this is read here rather than at the transition (§4.2).
    // The producer owns the deadline; a hook that hangs must cost the body, never the alert.
    private readonly beforeFire?: (alert: FiredAlert) => Promise<{ subtitle?: string | null; cardStatus?: string }>,
  ) {}

  /** Wire to `StateEngine.onTransition`. */
  onTransition(agent: AgentView, _from: AgentStatus, to: AgentStatus): void {
    // (Re)arm the debounce. A blocked→done flip lands here too, so only the latest verb survives —
    // and a resolution to a non-notifiable (or preference-disabled) state retracts instead, which is
    // `arm`'s own first branch rather than a second copy of the same rule here.
    this.arm(agent.paneId, {
      paneId: agent.paneId,
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
    });
  }

  /**
   * Arm an alert under an opaque `key` — the same debounce, slot, digest and snooze a pane
   * transition gets, for a caller that has no pane at all (bridge/board-notify.ts keys `card:<id>`).
   * A status the prefs have disabled resolves instead, exactly as a non-notifiable transition does.
   */
  arm(key: string, alert: Alert): void {
    if (!this.isNotifiable(alert.status)) {
      this.retract(key);
      return;
    }
    this.cancelPending(key);
    const handle = this.clock.schedule(() => void this.fire(key, alert), this.delayMs);
    this.pending.set(key, { handle, status: alert.status });
  }


  /** Wire to `StateEngine.onRemove` — a vanished pane is implicitly resolved. */
  onRemove(paneId: string): void {
    this.retract(paneId);
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
   * alert rather than resurrecting it); with no `beforeFire` hook nothing is ever awaited and this
   * stays as synchronous as it was.
   */
  private async fire(id: string, alert: Alert): Promise<void> {
    this.pending.delete(id);
    this.outstanding.set(id, alert);
    const learned = this.beforeFire ? await this.beforeFire(alert).catch(() => null) : null;
    // ponytail: resolved while we waited — the retraction already emitted, so just stand down. It
    // may have emitted a clear for a slot that never showed; harmless, and the window is ~ms.
    if (!this.outstanding.has(id)) return;
    if (learned?.subtitle) alert.subtitle = learned.subtitle;
    if (learned?.cardStatus) alert.cardStatus = learned.cardStatus;
    this.onFire?.(alert);
    this.emit(true);
  }

  /**
   * Drop whatever is armed or outstanding under `key`: cancel a still-debouncing timer, retract a
   * delivered alert and re-emit the shrunk summary. The other half of {@link arm} — public because a
   * caller that owns its own retraction predicate (bridge/board-notify.ts) has no transition to ride.
   */
  retract(key: string): void {
    this.cancelPending(key);
    if (this.outstanding.delete(key)) this.emit(false);
  }

  /**
   * Re-render the single herd summary from whatever's outstanding (or clear it when empty).
   *
   * ponytail: ONE MESSAGE PER ALERT, even when a whole batch expires together. Timers that come due
   * in the same tick still run as separate callbacks with the microtask queue drained between them,
   * so each `fire()` renders before the next one is even invoked: a restarted herdr, which orphans
   * every card in a single `reconcile()` (NOTIFY_AUDIT.md §6.3), sends a growing digest per card —
   * one notification on the device, since they share the slot, but N messages and N `renotify`s to
   * get there. Upstream has always done this for a herd that finishes together; the board only makes
   * it easier to hit. Collapsing it needs the render deferred past the whole timer batch (one
   * macrotask), which changes when every existing caller sees a render — worth doing only once the
   * duplicate buzz has actually been observed on a device.
   */
  private emit(renotify: boolean): void {
    if (this.outstanding.size === 0) {
      this.sink.clear();
      return;
    }
    this.sink.render(this.summarize(renotify));
  }

  private summarize(renotify: boolean): HerdSummary {
    const entries = [...this.outstanding.values()];
    if (entries.length === 1) {
      const a = entries[0]!;
      // One outstanding agent → deep-link straight to its pane on tap, unless the alert is about a
      // card to read, in which case the tap follows the sentence to the card (§4.1). Both come from
      // notify-content.ts, shared with the copilot's later update to this same slot — which is why
      // an already-filled `subtitle` survives every re-render of the summary.
      const cardId = notifyCardId(a);
      return {
        ...notifyContent(a, a.subtitle ?? null),
        ...(a.paneId ? { paneId: a.paneId } : {}),
        renotify,
        ...(cardId ? { cardId } : {}),
      };
    }
    const alerts = entries;
    // The subjects, not the workers: `claude, claude, claude` named three panes with the one word
    // herdr reports for all of them (NOTIFY_AUDIT.md §2.1). Same subject rule as a single alert —
    // the card, else its repo — so a digest reads like the notifications it collapsed.
    const subjects = [...new Set(alerts.map((a) => a.cardTitle || repoOf(a.cwd)))];
    return { title: digestTitle(alerts), body: subjects.join(" · "), renotify };
  }

  private cancelPending(id: string): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.clock.cancel(p.handle);
    this.pending.delete(id);
  }
}
