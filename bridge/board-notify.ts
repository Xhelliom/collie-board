// The board tells its own story in the bell.
//
// Until now a notification could only ever be about a PANE: an agent went blocked, an agent
// finished. Everything the board itself does — the copilot rendering a review, a cleanup being
// refused, a copilot request quietly failing — happened with nobody watching, and left a trace only
// in a card's journal, which you have to already be on the card to read (NOTIFY_AUDIT.md §6).
//
// The trigger is not a new loop and not a diff of snapshots: it is the JOURNAL. `event` (db.ts) is
// append-only with an autoincrement primary key, every one of these facts is already written to it
// by the code that does them, and so tailing it with `WHERE id > ?` cannot miss a fact between two
// polls the way a state diff can — the journal is written by the ACTION, not derived from a state.
// This rides `engine.onUpdate` alongside `reconcile()` (index.ts), and its per-tick cost is one
// range scan on the primary key that returns zero rows in the normal case (§6.2).
//
// THE CURSOR IS IN MEMORY, initialised to the newest id at construction — so a bridge restart
// resumes from now and never replays the past into the bell. Same posture as `NotifyLog` itself and
// as `CopilotCoordinator.busyCards`: runtime state is never persisted (CLAUDE.md §The board).
//
// AND IT ONLY WRITES TO THE BELL. `NotifyLog.add()` is called directly, which means no push, no
// debounce, no coalescing and no retraction predicate to define — a history does not retract, and
// notifications.ts is not touched (§6.4, §6.6 step 1). Waking a phone for any of this is the NEXT
// increment, and it is the one that has to pay for the coordinator's pane-shaped assumptions.

import type { BoardEvent } from "./db.ts";
import type { NotifyLog, NotifyLogEntry } from "./notify-log.ts";

/** A push body has room for one short line, not a stack trace. Same cap as notify-subtitle.ts's. */
const oneLine = (s: string): string => {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > 140 ? `${clean.slice(0, 139)}…` : clean;
};

const str = (payload: unknown, key: string): string | null => {
  const v = (payload as Record<string, unknown> | null)?.[key];
  return typeof v === "string" && v.trim() ? v : null;
};

/**
 * What a journal entry is worth saying in the bell, or null for the thirty-odd types that are worth
 * nothing there. THE FILTER IS THE FACT, NOT THE TRIGGER: the tailer hands everything to this, and
 * a `card.merged` being dropped here is the design working, not a gap.
 *
 * Three facts, and each earns its place by the same test — nobody asked for it, nothing else says
 * it, and there is something to decide once you know (§6.3, B2/B7/B10).
 *
 * Exported for the test: it is the whole editorial judgement of this module.
 */
export function tell(e: BoardEvent): Pick<NotifyLogEntry, "status" | "subtitle"> | null {
  // B2 — the copilot has an opinion on a card you have already stopped watching. The verdict is
  // already in the payload (`complete | partial | drift`), so this costs no read.
  if (e.type === "review.created") {
    const verdict = str(e.payload, "verdict");
    return { status: "done", subtitle: verdict ? `Copilot review: ${verdict}` : "Copilot review is in" };
  }
  // B7 — the worktree or branch is still on your disk because the automatic cleanup refused to
  // touch it. Nothing else reports this: `autoCleanup` is fired by the wrapup coordinator with no
  // tap behind it, so its refusal has no HTTP response to land in (wrapup.ts, integrate.ts).
  if (e.type === "card.cleanup_failed") {
    const stage = str(e.payload, "stage") ?? "cleanup";
    const error = str(e.payload, "error");
    return { status: "blocked", subtitle: oneLine(error ? `${stage} kept: ${error}` : `${stage} kept`) };
  }
  // B10 — a tap that produced nothing. Every copilot request is asynchronous and answers into the
  // card; when it fails there is no answer, and no way to learn that except this.
  if (e.type.startsWith("copilot.") && e.type.endsWith("_failed")) {
    const what = e.type.slice("copilot.".length, -"_failed".length);
    return { status: "blocked", subtitle: `Copilot ${what} failed — ask again` };
  }
  return null;
}

/** The corner of `BoardDb` this needs — enough to keep the test from standing up a database. */
export interface BoardNotifySource {
  lastEventId(): number;
  eventsAfter(after: number): BoardEvent[];
  getCard(id: string): { id: string; title: string; status: string; repoPath: string | null } | null;
}

export class BoardNotifier {
  private cursor: number;

  constructor(
    private readonly db: BoardNotifySource,
    private readonly log: NotifyLog,
  ) {
    this.cursor = db.lastEventId();
  }

  /** One range scan. Hung off `engine.onUpdate`; no snapshot is read, so a `disconnected` one is
   *  not a case here — `onUpdate` only ever fires after a successful poll anyway. */
  update(): void {
    for (const e of this.db.eventsAfter(this.cursor)) {
      // Advanced per row and BEFORE the work, so a fact this can't render is still consumed.
      this.cursor = e.id;
      const said = tell(e);
      if (!said || !e.cardId) continue;
      // The card as it reads NOW, not as the event left it: the bell composes its sentence from the
      // same `cardTitle`/`cardStatus` a pane alert carries (notify-content.ts), and a card deleted
      // since simply has no story left to tell.
      const card = this.db.getCard(e.cardId);
      if (!card) continue;
      this.log.add({
        ...said,
        cwd: card.repoPath ?? "",
        cardId: card.id,
        cardTitle: card.title,
        cardStatus: card.status,
      });
    }
  }
}
