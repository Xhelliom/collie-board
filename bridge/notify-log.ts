// What pinged, and when. The coordinator next door collapses the herd into ONE live notification
// slot and retracts it the moment the work is handled — which is right for a lock screen and wrong
// for memory: a notification you missed on the phone leaves no trace anywhere. This is that trace.
//
// A bounded in-memory ring, written the instant an alert fires (before the sink's mute gate — an
// alert that landed in quiet hours is exactly the one you want to find later), read by the bell in
// the app header. Nothing here is persisted: it is runtime state, so it dies with the bridge.

/** One fired alert, newest first in {@link NotifyLog.recent}. */
export interface NotifyLogEntry {
  /** Monotonic within this bridge process — a stable list key, nothing more. */
  id: number;
  /** When the alert fired (epoch ms). */
  ts: number;
  /** The pane that pinged, and where it lived. Absent on a BOARD entry (board-notify.ts): a fact the
   *  board journalled has no terminal behind it. Neither is rendered anywhere — since N9 no
   *  notification names the pane — they stay because dropping a field from the log's wire shape
   *  costs more than keeping it. */
  agent?: string;
  workspaceLabel?: string;
  cwd: string;
  /** `stalled` and `ready` are the board's own (bridge/board-notify.ts): a card whose work stopped
   *  and which nothing will restart, and a card a finished predecessor has just unblocked. Same
   *  words as the push, from the same `notifyMarker`. */
  status: "blocked" | "done" | "stalled" | "ready";
  /** The pane that pinged — the bell deep-links to it. ABSENT on a board entry, which is exactly
   *  what sends its tap to the card instead (notification-bell.tsx). */
  paneId?: string;
  /** Registry name of the pane's session; absent for the primary (same convention as the push payload). */
  session?: string;
  /** Rename ingredients + the card title — same fields `paneDisplayName` resolves for the in-app
   *  toast, so the bell can name this entry exactly like the toast did when it fired. */
  paneLabel?: string;
  sessionName?: string;
  kind?: "agent" | "shell";
  cardTitle?: string;
  /** The card the pane backed and its status at the moment the alert fired — copied straight off the
   *  `Alert`, so the bell re-renders exactly the sentence and destination the push went out with. */
  cardId?: string;
  cardStatus?: string;
  /** The copilot-authored account of what actually happened, patched in after the fact once it
   *  answers (see notify-subtitle.ts) — the entry is logged plain the instant the alert fires (this
   *  history is the trace of what pinged, and quiet-hours or not is decided before enrichment could
   *  ever land), then upgraded in place if a subtitle arrives before something newer replaces it. */
  subtitle?: string;
  /** Set the moment you tap the entry — the badge counts what is still unread. Lives with the rest
   *  of the entry, so it survives a page reload and dies with the bridge, like everything else here. */
  read?: boolean;
}

/** Entries kept. Two screens' worth of history — past that, the ping stopped being findable anyway. */
export const NOTIFY_LOG_MAX = 50;

export class NotifyLog {
  private readonly entries: NotifyLogEntry[] = [];
  private nextId = 1;

  constructor(private readonly now: () => number = Date.now) {}

  add(alert: Omit<NotifyLogEntry, "id" | "ts">): void {
    this.entries.unshift({ id: this.nextId++, ts: this.now(), ...alert });
    // ponytail: unshift + truncate on a 50-element array; a real ring buffer if this ever grows.
    if (this.entries.length > NOTIFY_LOG_MAX) this.entries.length = NOTIFY_LOG_MAX;
  }

  /** Newest first. A copy — the caller serialises it, and must not be able to mutate ours. */
  recent(): NotifyLogEntry[] {
    return [...this.entries];
  }

  /** How many UNREAD alerts the ring holds — the bell's badge, carried on every snapshot poll. */
  count(): number {
    return this.entries.reduce((n, e) => n + (e.read ? 0 : 1), 0);
  }

  /** Mark one entry read — the bell's tap. Unknown id (already dismissed, or aged out) is a no-op. */
  markRead(id: number): void {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) entry.read = true;
  }

  /** Mark the whole ring read — the bell's "mark all read". Marks, never removes: the history is
   *  what the bell is for, and emptying the badge is not emptying the trace. */
  markAllRead(): void {
    for (const entry of this.entries) entry.read = true;
  }

  /** Forget one entry — the bell's dismiss. Unknown id (already gone, or aged out) is a no-op. */
  remove(id: number): void {
    const i = this.entries.findIndex((e) => e.id === id);
    if (i !== -1) this.entries.splice(i, 1);
  }

  /**
   * Patch the copilot-authored subtitle onto the entry it belongs to, once it answers. Matched by
   * paneId + status (not an id the caller never had) against the NEWEST such entry — the one the
   * enrichment was asked about, since a stale answer is already dropped before this is ever called
   * (see notify-subtitle.ts's own coordinator.currentSolo check). A no-op if the entry aged out of
   * the ring in the meantime — and never a match for a board entry, which has no pane whose
   * transcript the copilot could have been asked about.
   */
  enrich(paneId: string, status: NotifyLogEntry["status"], subtitle: string): void {
    const entry = this.entries.find((e) => e.paneId === paneId && e.status === status);
    if (entry) entry.subtitle = subtitle;
  }
}
