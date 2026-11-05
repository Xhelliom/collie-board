import type { AgentStatus } from "./types.ts";

// Herdr's `done` already means "finished and not seen": the desktop TUI turns it into `idle` the
// moment you focus the pane. Opening the pane in the app never focused it (every herdr call here
// passes `focus:false`, so the phone never yanks the desk), so a finished agent you had read on the
// phone stayed green, kept its lock-screen alert, and kept counting.
//
// This is the app's half of that same rule: a pane opened through the app reads `idle` until herdr
// stops reporting it `done`. The engine then sees an ordinary done→idle transition, the one herdr's
// own focus produces, and everything downstream already handles it — the alert retracts through
// `NotificationCoordinator.arm` (ADR 0011: it retracts when the pane leaves `done`), the dot and the
// list follow the status. Ephemeral and per engine (CLAUDE.md: `session` ephemeral).

/** Header the web app sets on its own pane reads — the only thing that marks a pane seen. A
 *  no-cors cross-site `<img src=/api/pane/…>` cannot set a custom header, so a page visited on the
 *  tailnet cannot silently clear the operator's finished agents (upstream's SEEN_HEADER, same why). */
export const SEEN_HEADER = "x-collie-seen";

export class SeenPanes {
  private readonly seen = new Set<string>();

  mark(paneId: string): void {
    this.seen.add(paneId);
  }

  /** Herdr's status for `paneId`, with a seen `done` read as `idle`. Any other status ends the mark,
   *  so the agent's NEXT finish shows (and notifies) again. shortcut: a mark set while the pane works
   *  survives until the next poll sees it — one poll's window, and you were looking at the pane. */
  status(paneId: string, raw: AgentStatus): AgentStatus {
    if (raw !== "done") {
      this.seen.delete(paneId);
      return raw;
    }
    return this.seen.has(paneId) ? "idle" : raw;
  }

  forget(paneId: string): void {
    this.seen.delete(paneId);
  }
}
