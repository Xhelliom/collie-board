import { describe, expect, it } from "bun:test";

import { BoardDb } from "./db.ts";
import { recordOperatorSaid } from "./operator-said.ts";
import { operatorSince } from "./run.ts";

describe("what the operator says to a worker (ADR 0017)", () => {
  it("is journaled on the pane's open card, and only there", () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/r", status: "working" });
    db.openSession({ cardId: a.id, paneId: "p1" });
    recordOperatorSaid(db, "p1", "  use the shared helper  ");
    recordOperatorSaid(db, "p1", "   ");
    recordOperatorSaid(db, "no-such-pane", "hello");
    const said = db.listEvents(a.id).filter((e) => e.type === "card.operator_said");
    expect(said.map((e) => (e.payload as { text: string }).text)).toEqual(["use the shared helper"]);
  });

  it("operatorSince hands the lead what came after its last verdict, oldest first", () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/r", status: "working" });
    db.openSession({ cardId: a.id, paneId: "p1" });
    recordOperatorSaid(db, "p1", "before");
    db.recordRunEvent(a.id, "run.decision", { runId: "r1", decision: "prompt", reason: "x" });
    recordOperatorSaid(db, "p1", "first");
    recordOperatorSaid(db, "p1", "second");
    expect(operatorSince(db.listEvents(a.id, 200), "r1")).toEqual(["first", "second"]);
    expect(operatorSince(db.listEvents(a.id, 200), "other-run")).toEqual(["before", "first", "second"]);
  });
});
