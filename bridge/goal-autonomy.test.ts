// ADR 0056, the objective spent: the end-of-lot verdict and wake under an objective, and the launch it allows.
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { endOfLot } from "./autonomy.ts";
import { handleBoardRoute } from "./board-routes.ts";
import { BoardDb } from "./db.ts";
import { DEFAULT_BUDGET, goalView } from "./goal-routes.ts";
import { orchestratorLabel } from "./orchestrator.ts";
import { OrchestratorNudger } from "./orchestrator-nudge.ts";
import { NotifyLog } from "./notify-log.ts";
import type { EngineSnapshot } from "./state-engine.ts";

const PANE = { "x-collie-pane": "o1" };
const repo = mkdtempSync(join(tmpdir(), "collie-goal-auto-"));
mkdirSync(join(repo, ".git"));

const ctx = (db: BoardDb) =>
  ({
    db,
    herdr: {},
    engine: { current: () => ({ agents: [], shellPanes: [], workspaces: [], tabs: [], bridge: "connected" }) },
    cfg: {},
    audit: { record: () => {} },
    session: "default",
    guard: () => null,
    device: null,
    json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
    text: (body: string, status: number) => new Response(body, { status }),
  }) as never;

const call = async (db: BoardDb, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await handleBoardRoute(
    path.split("?")[0]!,
    new Request(`http://x${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    ctx(db),
  );
  return { status: res!.status, body: await res!.json().catch(() => null) };
};

const live = { bridge: "connected", shellPanes: [], agents: [{ paneId: "o1", workspaceLabel: orchestratorLabel(repo), cwd: repo, status: "idle" }] } as unknown as EngineSnapshot;
const flush = () => new Promise((r) => setTimeout(r, 0));

/** An objective set first, then one lot launched and finished under it. */
function world(budget = DEFAULT_BUDGET) {
  const db = new BoardDb(":memory:");
  const sent: string[] = [];
  const herdr = {
    getAgent: async () => ({ interactive_ready: true, agent_status: "idle" }),
    promptAgent: async (o: { text: string }) => void sent.push(o.text),
    sendPaneKeys: async () => {},
  } as never;
  const log = new NotifyLog();
  const nudger = new OrchestratorNudger(db, herdr, log, async () => null);
  const goal = db.createGoal({ repoPath: repo, text: "v1 livrée", criteria: ["CI verte"], budget })!;
  const card = db.createCard({ title: "a", repoPath: repo, status: "done" });
  const lot1 = db.createRun({ repoPath: repo, cardIds: [card.id], foldInCap: 0, name: "lot 1" });
  db.launchRun(lot1.id);
  const finish = async () => {
    db.recordRunEvent(null, "run.finished", { runId: lot1.id });
    nudger.update(live);
    await flush();
    await flush();
  };
  const plan = async (title: string) => {
    const c = db.createCard({ title, repoPath: repo, status: "ready" });
    return (await call(db, "POST", "/api/runs", { cardIds: [c.id], foldInCap: 0, planned: true, name: title }, PANE));
  };
  return { db, sent, log, goal, lot1, finish, plan };
}

describe("the end-of-lot verdict under an objective (ADR 0056)", () => {
  it("without an objective nothing changes: autonomy off, nothing planned, no word", () => {
    const db = new BoardDb(":memory:");
    const c = db.createCard({ title: "a", repoPath: repo, status: "done" });
    const run = db.createRun({ repoPath: repo, cardIds: [c.id], foldInCap: 0, name: "l" });
    expect(endOfLot(db, run)).toEqual({ go: false, why: null });
  });

  it("active, nothing planned: plan — autonomy off does not matter", () => {
    const w = world();
    expect(endOfLot(w.db, w.lot1)).toEqual({ go: false, why: null, goal: { id: w.goal.id, stop: "plan" } });
  });

  it("active, a lot planned: go — no maxChain, the objective's budget instead", async () => {
    const w = world();
    const next = (await w.plan("b")).body.run;
    const v = endOfLot(w.db, w.lot1);
    expect(v).toMatchObject({ go: true, next: { id: next.id }, goalId: w.goal.id });
  });

  it("each bound pauses: lots, the week's quota, the deadline", () => {
    const w = world({ maxLots: 1, quotaPct: 80, deadline: null });
    expect(endOfLot(w.db, w.lot1)).toMatchObject({ go: false, why: expect.stringContaining("1 lot(s) sur 1"), goal: { stop: "pause" } });
    const q = world();
    expect(endOfLot(q.db, q.lot1, 85)).toMatchObject({ why: expect.stringContaining("85 %"), goal: { stop: "pause" } });
    const d = world({ maxLots: 10, quotaPct: 80, deadline: 1000 });
    expect(endOfLot(d.db, d.lot1)).toMatchObject({ why: expect.stringContaining("échéance"), goal: { stop: "pause" } });
  });

  it("claimed: a full stop, autonomy armed or not", () => {
    const w = world();
    w.db.setAutonomy(repo, { enabled: true, maxChain: null, stopOnRed: true, startWhenIdle: true, maxRounds: 5 });
    w.db.setGoalStatus(w.goal.id, ["active"], "claimed");
    expect(endOfLot(w.db, w.lot1)).toEqual({ go: false, why: null, goal: { id: w.goal.id, stop: "claimed" } });
  });
});

describe("the wake and the launch under an objective", () => {
  it("nothing planned: the orchestrator is woken to plan, then launches the lot it created, one at a time", async () => {
    const w = world();
    await w.finish();
    expect(w.sent[0]).toContain("Objectif pas atteint : relis les critères, planifie et lance la suite.");
    expect(w.sent[0]).toContain(`/api/goals/${w.goal.id}/claim`);
    const b = (await w.plan("b")).body.run;
    const c = (await w.plan("c")).body.run;
    expect((await call(w.db, "POST", `/api/runs/${b.id}/launch`, undefined, PANE)).status).toBe(200);
    // b is open: c waits for it.
    expect((await call(w.db, "POST", `/api/runs/${c.id}/launch`, undefined, PANE)).status).toBe(403);
    // Attached: both lots and their cards; the budget counts the launched one.
    const v = goalView(w.db, w.db.getGoal(w.goal.id)!, null);
    expect(v.spent.lotIds).toEqual(expect.arrayContaining([b.id, c.id]));
    expect(v.spent.cardIds).toEqual(expect.arrayContaining([...w.db.runMembers(b.id), ...w.db.runMembers(c.id)].map((x) => x.id)));
    expect(v.spent.lots).toBe(2); // lot 1 and b
  });

  it("the waiting decisions are recalled, and an end of phase is not proposed for validation", async () => {
    const w = world();
    w.db.putRoadmap(repo, { vision: "", items: [], decisions: [{ id: "d1", text: "Postgres ou SQLite ?", status: "open", itemId: null }] }, 0);
    await w.finish();
    expect(w.sent[0]).toContain("Postgres ou SQLite ?");
    expect(w.sent[0]).not.toContain("propose à l'opérateur de la valider");
  });

  it("claimed: no wake, no launch, no new lot — until a refusal with a comment", async () => {
    const w = world();
    const b = (await w.plan("b")).body.run;
    w.db.setAutonomy(repo, { enabled: true, maxChain: null, stopOnRed: true, startWhenIdle: true, maxRounds: 5 });
    expect((await call(w.db, "POST", `/api/goals/${w.goal.id}/claim`, undefined, PANE)).status).toBe(200);
    await w.finish();
    expect(w.sent).toEqual([]);
    expect((await call(w.db, "POST", `/api/runs/${b.id}/launch`, undefined, PANE)).status).toBe(403);
    expect((await w.plan("c")).status).toBe(403);
    // A resume of a claim is a refusal: it says why.
    expect((await call(w.db, "POST", `/api/goals/${w.goal.id}/resume`, {})).status).toBe(400);
    expect((await call(w.db, "POST", `/api/goals/${w.goal.id}/resume`, { comment: "la doc manque" })).status).toBe(200);
    await w.finish();
    expect(w.sent.some((m) => m.includes("« la doc manque »") && m.includes("planifie et lance la suite"))).toBe(true);
    expect((await call(w.db, "POST", `/api/runs/${b.id}/launch`, undefined, PANE)).status).toBe(200);
  });

  it("a bound reached pauses the objective and tells the operator once", async () => {
    const w = world({ maxLots: 1, quotaPct: 80, deadline: null });
    await w.finish();
    expect(w.db.getGoal(w.goal.id)!.status).toBe("paused");
    expect(w.log.recent().filter((e) => e.subtitle?.includes("objectif en pause"))).toHaveLength(1);
    await w.finish();
    expect(w.log.recent().filter((e) => e.subtitle?.includes("objectif en pause"))).toHaveLength(1);
    const b = (await w.plan("b")).body.run;
    expect((await call(w.db, "POST", `/api/runs/${b.id}/launch`, undefined, PANE)).status).toBe(403);
  });

  it("validating the objective closes the phases cut during it", async () => {
    const w = world();
    const phase = w.db.createPhase({ repoPath: repo, name: "p1" });
    expect((await call(w.db, "POST", `/api/goals/${w.goal.id}/achieve`, undefined, PANE)).status).toBe(403);
    expect((await call(w.db, "POST", `/api/goals/${w.goal.id}/achieve`)).status).toBe(200);
    expect(w.db.getPhase(phase.id)!.closedAt).not.toBeNull();
  });
});
