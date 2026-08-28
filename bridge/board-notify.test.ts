import { describe, expect, test } from "bun:test";

import { BoardNotifier, type BoardNotifySource, tell } from "./board-notify.ts";
import type { BoardEvent } from "./db.ts";
import { NotifyLog } from "./notify-log.ts";
import { notifyContent } from "./notify-content.ts";

const event = (id: number, type: string, payload: unknown = null): BoardEvent => ({
  id,
  cardId: "c1",
  type,
  payload,
  ts: 0,
});

/** A journal held in an array — the tailer only ever needs a cursor and a range. */
function source(events: BoardEvent[]) {
  return {
    events,
    lastEventId: () => events.at(-1)?.id ?? 0,
    eventsAfter: (after: number) => events.filter((e) => e.id > after),
    getCard: (id: string) =>
      id === "c1" ? { id: "c1", title: "Ship the bell", status: "review", repoPath: "/src/collie-board" } : null,
  } satisfies BoardNotifySource & { events: BoardEvent[] };
}

describe("tell", () => {
  test("keeps the three facts, with what happened in the subtitle", () => {
    expect(tell(event(1, "review.created", { verdict: "partial" }))).toEqual({
      status: "done",
      subtitle: "Copilot review: partial",
    });
    expect(tell(event(2, "card.cleanup_failed", { stage: "worktree", error: "has uncommitted changes" }))).toEqual({
      status: "blocked",
      subtitle: "worktree kept: has uncommitted changes",
    });
    expect(tell(event(3, "copilot.refine_failed", { instruction: "shorter" }))).toEqual({
      status: "blocked",
      subtitle: "Copilot refine failed — ask again",
    });
  });

  test("drops everything else — the filter is the fact, not the trigger", () => {
    for (const type of ["card.merged", "card.status", "session.opened", "wrapup.expired", "copilot.explained"]) {
      expect(tell(event(1, type))).toBeNull();
    }
  });

  test("survives a payload that isn't the shape it expects", () => {
    expect(tell(event(1, "review.created", null))?.subtitle).toBe("Copilot review is in");
    expect(tell(event(2, "card.cleanup_failed", { stage: 7 }))?.subtitle).toBe("cleanup kept");
  });
});

describe("BoardNotifier", () => {
  test("a restart replays nothing: the cursor starts at the newest id", () => {
    const log = new NotifyLog(() => 0);
    const db = source([event(1, "review.created", { verdict: "complete" })]);
    new BoardNotifier(db, log).update();
    expect(log.recent()).toHaveLength(0);
  });

  test("tails what lands after it, once, and reads the card as it stands now", () => {
    const log = new NotifyLog(() => 0);
    const db = source([event(1, "card.merged")]);
    const notifier = new BoardNotifier(db, log);

    db.events.push(event(2, "review.created", { verdict: "drift" }), event(3, "card.merged"));
    notifier.update();
    notifier.update();

    const entries = log.recent();
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    // No pane: that absence is what routes the bell's tap to the card (notification-bell.tsx).
    expect(entry?.paneId).toBeUndefined();
    expect(entry?.cardId).toBe("c1");
    // …and the bell renders it through the same composition a pane alert goes through.
    expect(notifyContent({ ...entry!, status: entry!.status }, entry?.subtitle ?? null)).toEqual({
      title: "Review · Ship the bell",
      body: "collie-board · Copilot review: drift",
    });
  });

  test("a fact it can't render still advances the cursor", () => {
    const log = new NotifyLog(() => 0);
    const db = source([]);
    const notifier = new BoardNotifier(db, log);

    // A card deleted since: nothing to say, and it must not be looked at again on the next tick.
    db.events.push({ ...event(1, "review.created", { verdict: "complete" }), cardId: "gone" });
    notifier.update();
    db.events.push(event(2, "card.cleanup_failed", { stage: "branch", error: "not merged" }));
    notifier.update();

    expect(log.recent()).toHaveLength(1);
    expect(log.recent()[0]?.subtitle).toBe("branch kept: not merged");
  });
});
