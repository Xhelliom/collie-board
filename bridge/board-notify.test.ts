import { describe, expect, test } from "bun:test";

import { alarm, BoardNotifier, type BoardAlertSink, type BoardNotifySource, tell } from "./board-notify.ts";
import { DERIVED_REASON, paneReason } from "./cards.ts";
import type { BoardEvent } from "./db.ts";
import { NotifyLog } from "./notify-log.ts";
import { notifyCardId, notifyContent, notifyMarker } from "./notify-content.ts";
import type { Alert } from "./notifications.ts";

const event = (id: number, type: string, payload: unknown = null): BoardEvent => ({
  id,
  cardId: "c1",
  type,
  payload,
  ts: 0,
});

/** A journal held in an array, plus the two rows the retraction predicate reads — the tailer never
 *  needs more of a database than a cursor, a range, and how the card stands right now. */
function source(events: BoardEvent[], seed: Partial<Record<string, Row>> = {}) {
  const cards: Record<string, Row> = {
    c1: { title: "Ship the bell", status: "review", repoPath: "/src/collie-board", session: null, handoff: null },
    ...seed,
  };
  return {
    events,
    cards,
    lastEventId: () => events.at(-1)?.id ?? 0,
    eventsAfter: (after: number) => events.filter((e) => e.id > after),
    getCard: (id: string) => {
      const c = cards[id];
      return c ? { id, title: c.title, status: c.status, repoPath: c.repoPath } : null;
    },
    openSessionFor: (id: string) => {
      const c = cards[id];
      return c?.session ? { id: c.session, handoffRequestedAt: c.handoff } : null;
    },
  } satisfies BoardNotifySource & { events: BoardEvent[]; cards: Record<string, Row> };
}

interface Row {
  title: string;
  status: string;
  repoPath: string | null;
  session: string | null;
  handoff: number | null;
}

/** The coordinator, reduced to what the board drives it through: an opaque key and its two verbs. */
function sink() {
  const armed = new Map<string, Alert>();
  const log: string[] = [];
  return {
    armed,
    log,
    arm: (key: string, alert: Alert) => {
      armed.set(key, alert);
      log.push(`arm ${key}`);
    },
    retract: (key: string) => {
      armed.delete(key);
      log.push(`retract ${key}`);
    },
  } satisfies BoardAlertSink & { armed: Map<string, Alert>; log: string[] };
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

describe("alarm", () => {
  test("keeps the facts nothing else reports, and says what to do about them", () => {
    expect(alarm(event(1, "card.status", { to: "orphaned" }))).toEqual({
      status: "stalled",
      subtitle: "its agent's pane is gone — relaunch from the last handoff",
    });
    expect(alarm(event(2, "handoff.expired", { sessionId: "s1" }))).toEqual({
      status: "stalled",
      subtitle: "handoff never landed — the agent wrote no note",
    });
    expect(alarm(event(3, "handoff.failed", { error: "card has no workspace" }))).toEqual({
      status: "stalled",
      subtitle: "handoff failed: card has no workspace",
    });
  });

  test("B12: a card that reached `review` with no pane behind it is `done`, so it reads `Review`", () => {
    // `done` and not `stalled`: the marker is what the operator reads, and this card is one to READ,
    // not one whose work stopped (§6.3, B12 — the exact complement of N4).
    expect(alarm(event(1, "card.status", { to: "review", reason: "manual" }))).toEqual({
      status: "done",
      subtitle: "moved to review — no session finished it",
    });
  });

  test("B12 stays quiet for a column the board DERIVED — test 3 of §6.1, do not say it twice", () => {
    // The pane's own `done` transition already armed the `Review` alert N4 sends…
    expect(alarm(event(1, "card.status", { to: "review", reason: paneReason("done") }))).toBeNull();
    // …and a container following a child into `review` would be two alerts for one landing (§4.3).
    expect(alarm(event(2, "card.status", { to: "review", reason: DERIVED_REASON }))).toBeNull();
    // A reason we can't read at all falls the same way: silence beats a second buzz.
    expect(alarm(event(3, "card.status", { to: "review" }))).toBeNull();
    expect(alarm(event(4, "card.status", { to: "review", reason: 7 }))).toBeNull();
  });

  test("drops every other column move, and everything the bell already tells", () => {
    expect(alarm(event(1, "card.status", { to: "done", reason: "manual" }))).toBeNull();
    expect(alarm(event(2, "card.status", null))).toBeNull();
    expect(alarm(event(3, "handoff.completed", { to: "s2" }))).toBeNull();
    expect(alarm(event(4, "review.created", { verdict: "drift" }))).toBeNull();
    expect(alarm(event(5, "card.cleanup_failed", { stage: "worktree" }))).toBeNull();
  });
});

describe("BoardNotifier — the board's own alerts", () => {
  const orphan = (id: number) => ({ ...event(id, "card.status", { to: "orphaned" }), cardId: "c1" });

  test("an orphaned card arms a stalled alert about the CARD, not a pane", () => {
    const db = source([], { c1: { title: "Ship it", status: "orphaned", repoPath: "/src/collie-board", session: null, handoff: null } });
    const alerts = sink();
    const notifier = new BoardNotifier(db, new NotifyLog(() => 0), alerts);

    db.events.push(orphan(1));
    notifier.update();

    const alert = alerts.armed.get("card:c1");
    expect(alert).toBeDefined();
    // No pane — and that absence is what sends every surface's tap to the card.
    expect(alert?.paneId).toBeUndefined();
    expect(notifyCardId(alert!)).toBe("c1");
    expect(notifyMarker(alert!)).toBe("Stalled");
    expect(notifyContent(alert!, alert!.subtitle ?? null)).toEqual({
      title: "Stalled · Ship it",
      body: "collie-board · its agent's pane is gone — relaunch from the last handoff",
    });
  });

  test("it retracts the moment the card stops reading the way the fact left it", () => {
    const db = source([], { c1: { title: "Ship it", status: "orphaned", repoPath: null, session: null, handoff: null } });
    const alerts = sink();
    const notifier = new BoardNotifier(db, new NotifyLog(() => 0), alerts);

    db.events.push(orphan(1));
    notifier.update();
    // Still orphaned on the next tick: the alert holds, and nothing is re-sent.
    notifier.update();
    expect(alerts.log).toEqual(["arm card:c1"]);

    // Relaunched — it left `orphaned`, which is this fact's whole retraction rule.
    db.cards.c1!.status = "working";
    db.cards.c1!.session = "s2";
    notifier.update();
    expect(alerts.log).toEqual(["arm card:c1", "retract card:c1"]);
    // …and once retracted it is not swept again.
    notifier.update();
    expect(alerts.log).toHaveLength(2);
  });

  test("a failed handoff holds until a new one is asked for", () => {
    const db = source([], { c1: { title: "Long one", status: "working", repoPath: null, session: "s1", handoff: null } });
    const alerts = sink();
    const notifier = new BoardNotifier(db, new NotifyLog(() => 0), alerts);

    db.events.push({ ...event(1, "handoff.expired", { sessionId: "s1" }), cardId: "c1" });
    notifier.update();
    expect(alerts.armed.get("card:c1")?.subtitle).toBe("handoff never landed — the agent wrote no note");

    // The agent keeps working in the same pane: nobody has dealt with it, so the alert stands.
    notifier.update();
    expect(alerts.armed.has("card:c1")).toBe(true);

    // A fresh handoff request IS dealing with it.
    db.cards.c1!.handoff = 1_700_000_000_000;
    notifier.update();
    expect(alerts.armed.has("card:c1")).toBe(false);
  });

  test("a card deleted since the fact retracts too — there is nothing left to open", () => {
    const db = source([], { c1: { title: "Gone", status: "orphaned", repoPath: null, session: null, handoff: null } });
    const alerts = sink();
    const notifier = new BoardNotifier(db, new NotifyLog(() => 0), alerts);

    db.events.push(orphan(1));
    notifier.update();
    delete db.cards.c1;
    notifier.update();
    expect(alerts.log).toEqual(["arm card:c1", "retract card:c1"]);
  });

  test("a restarted herdr orphans the whole board in one tick — one alert per card, one slot", () => {
    const cards: Record<string, Row> = {};
    for (const id of ["c1", "c2", "c3", "c4"]) {
      cards[id] = { title: id, status: "orphaned", repoPath: null, session: null, handoff: null };
    }
    const db = source([], cards);
    const alerts = sink();
    const notifier = new BoardNotifier(db, new NotifyLog(() => 0), alerts);

    // What `reconcile()` writes when every pane vanishes at once.
    db.events.push(
      ...["c1", "c2", "c3", "c4"].map((cardId, i) => ({ ...event(i + 1, "card.status", { to: "orphaned" }), cardId })),
    );
    notifier.update();

    // Four alerts, four keys, and every one of them keyed by CARD — the coordinator collapses them
    // into one digest and one `collie:herd` slot (notifications.ts), which is the point of not
    // opening a second channel for the board.
    expect([...alerts.armed.keys()]).toEqual(["card:c1", "card:c2", "card:c3", "card:c4"]);
    expect(new Set([...alerts.armed.values()].map((a) => a.status))).toEqual(new Set(["stalled"]));
  });

  test("B12: a card put up for review by hand arms `Review`, and the tap goes to the card", () => {
    const db = source([], { c1: { title: "Ship the bell", status: "review", repoPath: "/src/collie-board", session: null, handoff: null } });
    const alerts = sink();
    const notifier = new BoardNotifier(db, new NotifyLog(() => 0), alerts);

    db.events.push(event(1, "card.status", { to: "review", reason: "manual" }));
    notifier.update();

    const alert = alerts.armed.get("card:c1");
    expect(alert).toBeDefined();
    // The complement of N4 renders as N4 does — same marker, same destination, no pane in sight.
    expect(alert?.paneId).toBeUndefined();
    expect(notifyMarker(alert!)).toBe("Review");
    expect(notifyCardId(alert!)).toBe("c1");
    expect(notifyContent(alert!, alert!.subtitle ?? null)).toEqual({
      title: "Review · Ship the bell",
      body: "collie-board · moved to review — no session finished it",
    });

    // It holds while the card is still sitting there unread, and goes the moment it is filed.
    notifier.update();
    expect(alerts.log).toEqual(["arm card:c1"]);
    db.cards.c1!.status = "done";
    notifier.update();
    expect(alerts.log).toEqual(["arm card:c1", "retract card:c1"]);
  });

  test("B12: a pane that finishes moves its card to `review` and the board stays out of it", () => {
    // What `reconcile()` writes when a pane reports `done` — and what the sub-task's container then
    // derives from it, in the same tick. The pane's own transition is already arming the `Review`
    // alert through `onTransition`; neither of these may arm a second one (§6.1 test 3, §4.3).
    const cards: Record<string, Row> = {
      c1: { title: "Sub-task", status: "review", repoPath: null, session: "s1", handoff: null },
      c2: { title: "Container", status: "review", repoPath: null, session: null, handoff: null },
    };
    const db = source([], cards);
    const alerts = sink();
    const notifier = new BoardNotifier(db, new NotifyLog(() => 0), alerts);

    db.events.push(
      { ...event(1, "card.status", { to: "review", reason: paneReason("done") }), cardId: "c1" },
      { ...event(2, "card.status", { to: "review", reason: DERIVED_REASON }), cardId: "c2" },
    );
    notifier.update();

    expect(alerts.log).toEqual([]);
  });

  test("without a coordinator it stays the bell-only tailer it shipped as", () => {
    const db = source([], { c1: { title: "Ship it", status: "orphaned", repoPath: null, session: null, handoff: null } });
    const log = new NotifyLog(() => 0);
    const notifier = new BoardNotifier(db, log);

    db.events.push(orphan(1), event(2, "review.created", { verdict: "complete" }));
    notifier.update();

    // The orphan produced nothing — an alarm with nowhere to go is not silently turned into a bell
    // entry, because a bell entry cannot be retracted and this fact needs to be.
    expect(log.recent()).toHaveLength(1);
    expect(log.recent()[0]?.subtitle).toBe("Copilot review: complete");
  });
});
