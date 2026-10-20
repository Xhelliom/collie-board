import { describe, expect, it } from "bun:test";

import { BoardDb } from "./db.ts";
import { quickAccess } from "./project-quick.ts";

describe("quickAccess (the sidebar's quick access)", () => {
  it("lists a running lot first, then a recently finished one, and the cards awaiting a decision", () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/live", status: "blocked" });
    const b = db.createCard({ title: "b", repoPath: "/live", status: "done" });
    const c = db.createCard({ title: "c", repoPath: "/over", status: "done" });
    const planned = db.createCard({ title: "p", repoPath: "/planned" });
    const live = db.createRun({ repoPath: "/live", cardIds: [a.id, b.id], foldInCap: 0, name: "Auth" });
    const over = db.createRun({ repoPath: "/over", cardIds: [c.id], foldInCap: 0, name: "Old" });
    db.createRun({ repoPath: "/planned", cardIds: [planned.id], foldInCap: 0, name: "Later", planned: true } as never);
    db.launchRun(live.id);
    db.launchRun(over.id);
    db.recordRunEvent(null, "run.finished", { runId: over.id });
    db.putRoadmap("/live", { vision: "", items: [], decisions: [{ id: "d1", text: "Which DB?", status: "open", itemId: null, cardId: a.id }] }, 0);

    const q = quickAccess(db);
    expect(q.projects.map((p) => [p.repoPath, p.lot.name, p.lot.done, p.lot.total, p.lot.blocked, p.lot.finished])).toEqual([
      ["/live", "Auth", 1, 2, true, false],
      ["/over", "Old", 1, 1, false, true],
    ]);
    expect(q.waiting).toEqual([{ cardId: a.id, title: "a", repoPath: "/live", text: "Which DB?" }]);
    // A week later the finished lot has dropped out; the running one stays.
    expect(quickAccess(db, Date.now() + 8 * 24 * 3600 * 1000).projects.map((p) => p.repoPath)).toEqual(["/live"]);
  });
});
