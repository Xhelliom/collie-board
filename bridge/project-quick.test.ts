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

  it("filters in SQL: launched lots with members, unfinished or moved within the week", () => {
    const db = new BoardDb(":memory:");
    const day = 24 * 3600 * 1000;
    const lot = (repo: string, status = "done") => {
      const c = db.createCard({ title: repo, repoPath: repo, status: status as never });
      const r = db.createRun({ repoPath: repo, cardIds: [c.id], foldInCap: 0, name: repo });
      db.launchRun(r.id);
      return r.id;
    };
    lot("/open", "in_progress");
    db.recordRunEvent(null, "run.finished", { runId: lot("/event") }); // finished by the local event
    (db as unknown as { db: { query(s: string): { run(...a: unknown[]): void } } }).db
      .query("UPDATE run SET finished_at = 1 WHERE id = ?")
      .run(lot("/shared")); // finished by another pair's `finished_at` only
    db.launchRun(db.createRun({ repoPath: "/empty", cardIds: [], foldInCap: 0 }).id);
    const later = Date.now() + 8 * day;
    // Lots made in the same ms tie on (position, created_at): the filter is checked, not the order.
    expect(db.quickRuns(0).map((r) => [r.run.repoPath, r.finished]).sort()).toEqual([
      ["/event", true],
      ["/open", false],
      ["/shared", true],
    ]);
    expect(db.quickRuns(later - 7 * day).map((r) => r.run.repoPath)).toEqual(["/open"]);
  });
});
