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
  agent: string;
  workspaceLabel: string;
  cwd: string;
  status: "blocked" | "done";
  /** The pane that pinged — the bell deep-links to it. */
  paneId: string;
  /** Registry name of the pane's session; absent for the primary (same convention as the push payload). */
  session?: string;
  /** Rename ingredients + the card title — same fields `paneDisplayName` resolves for the in-app
   *  toast, so the bell can name this entry exactly like the toast did when it fired. */
  paneLabel?: string;
  sessionName?: string;
  kind?: "agent" | "shell";
  cardTitle?: string;
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
}
