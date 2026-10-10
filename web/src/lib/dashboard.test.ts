import { dashboardOf, herdCounts } from "./dashboard";
import type { CardView, Phase } from "./board";
import type { AgentView } from "./types";

const card = (id: string, status: string, repoPath: string | null, updatedAt = 0): CardView =>
  ({ id, status, repoPath, updatedAt, parentId: null, position: 0, createdAt: 0 }) as unknown as CardView;

describe("dashboardOf", () => {
  const now = 10 * 24 * 3600 * 1000;
  const v = dashboardOf(
    [
      card("1", "review", "/a/x", now),
      card("2", "blocked", "/a/x", now),
      card("3", "ready", "/a/y", 5),
      card("4", "done", "/a/y", now - 1000),
      card("5", "done", "/a/y", 0),
      card("6", "archived", "/a/y", now),
    ],
    now,
  );
  it("counts the board", () => {
    expect([v.review, v.stuck, v.ready, v.delivered]).toEqual([1, 1, 1, 1]);
  });
  it("tiles per repo, the one waiting on you first", () => {
    expect(v.repos.map((r) => r.name)).toEqual(["x", "y"]);
    // No phase table and no container: nothing is "current", whatever the repo holds.
    expect(v.repos[0]).toMatchObject({ current: [], waiting: 0 });
  });
  it("draws only the open phases of the phase table", () => {
    const phase = (id: string, closedAt: number | null) => ({ id, name: id, goal: "", position: id === "p1" ? 0 : 1, closedAt }) as unknown as Phase;
    const c = (id: string, status: string, phaseId: string) => ({ ...card(id, status, "/a/x", 1), phaseId }) as CardView;
    const t = dashboardOf([c("1", "done", "p1"), c("2", "done", "p1"), c("3", "working", "p2"), c("4", "review", "p2")], now, {
      "/a/x": [phase("p1", 5), phase("p2", null)],
    }).repos[0]!;
    expect(t.current.map((p) => [p.title, p.done, p.steps.length])).toEqual([["p2", 0, 2]]);
    expect([t.active, t.waiting, t.closedCount]).toEqual([1, 1, 1]);
  });
});

describe("herdCounts", () => {
  it("splits needs / working / idle", () => {
    const a = (status: string) => ({ status }) as unknown as AgentView;
    expect(herdCounts([a("blocked"), a("working"), a("working"), a("idle"), a("done")])).toEqual([1, 2, 2]);
  });
});
