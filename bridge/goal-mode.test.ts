import { describe, expect, it } from "bun:test";

import { BoardNotifier } from "./board-notify.ts";
import { handleBoardRoute } from "./board-routes.ts";
import { BoardDb } from "./db.ts";
import { budgetUsed, dueCheckpoints, GOAL_WATCH_EVERY_MS, GoalWatch } from "./goal-mode.ts";
import { DEFAULT_BUDGET, goalView } from "./goal-routes.ts";
import { lotHoldsPush } from "./lot-push.ts";
import { NotifyLog } from "./notify-log.ts";
import type { Alert } from "./notifications.ts";
import { orchestratorLabel } from "./orchestrator.ts";

const snap = (agents: { paneId: string; cwd: string; workspaceLabel: string; status?: string }[] = []) =>
  ({ bridge: "connected", agents: agents.map((a) => ({ status: "idle", ...a })), shellPanes: [] }) as never;

const NEW = { repoPath: "/r", text: "Ship v1", criteria: ["CI green"], budget: DEFAULT_BUDGET };

function lot(db: BoardDb, done = true) {
  const card = db.createCard({ title: "step", repoPath: "/r" });
  const run = db.createRun({ repoPath: "/r", cardIds: [card.id], foldInCap: 1, planned: true });
  db.launchRun(run.id);
  if (done) db.patchCard(card.id, { status: "done" });
  return { card, run };
}

describe("goal mode: thresholds", () => {
  const v = (lots: number, quota: number | null, deadline: number | null = null) => ({ budget: { maxLots: 10, quotaPct: 80, deadline }, spent: { lots, lotIds: [], cardIds: [], phaseIds: [], quotaPct: quota } });

  it("the budget is the larger of lots and quota, all spent once the deadline passed", () => {
    expect(budgetUsed(v(2, 20), 0)).toBe(0.25);
    expect(budgetUsed(v(5, null), 0)).toBe(0.5);
    expect(budgetUsed(v(1, 80), 0)).toBe(1);
    expect(budgetUsed(v(0, 0, 100), 100)).toBe(1);
  });

  it("raises half, then spent, then claimed — each keyed so a raised budget can ring again", () => {
    const db = new BoardDb(":memory:");
    const g = db.createGoal(NEW)!;
    expect(dueCheckpoints(goalView(db, g, 10), 0)).toEqual([]);
    expect(dueCheckpoints(goalView(db, g, 40), 0)).toEqual([{ reason: "half", key: "half:10:80:" }]);
    expect(dueCheckpoints(goalView(db, g, 80), 0)).toEqual([{ reason: "spent", key: "spent:10:80:" }]);
    db.setGoalStatus(g.id, ["active"], "claimed");
    expect(dueCheckpoints(goalView(db, db.getGoal(g.id)!, 80), 0)[0]!.reason).toBe("claimed");
    db.setGoalStatus(g.id, ["claimed"], "paused");
    expect(dueCheckpoints(goalView(db, db.getGoal(g.id)!, 80), 0)).toEqual([]);
  });
});

describe("goal mode: the watch and the phone", () => {
  it("journals each checkpoint once, and the tailer rings it until the operator acts on the objective", () => {
    let now = 1_000;
    const db = new BoardDb(":memory:", () => now);
    const g = db.createGoal(NEW)!;
    now = 2_000;
    lot(db);
    const armed: [string, Alert][] = [];
    const retracted: string[] = [];
    const notifier = new BoardNotifier(db, new NotifyLog(() => now), { arm: (k, a) => armed.push([k, a]), retract: (k) => retracted.push(k) }, () => now);
    let quota = 50;
    const watch = new GoalWatch(db, () => quota, () => now);
    watch.update(snap());
    now += GOAL_WATCH_EVERY_MS;
    watch.update(snap()); // same threshold: not twice
    notifier.update(snap());
    expect(db.goalJournal(g.id).map((e) => (e.payload as { reason: string }).reason)).toEqual(["half"]);
    expect(armed).toHaveLength(1);
    expect(armed[0]![0]).toBe(`goal:${g.id}`);
    expect(armed[0]![1].subtitle).toContain("1/10 lots (0 finis)");
    expect(armed[0]![1].subtitle).toContain("1 cartes mergées");
    // The operator raises the quota: the checkpoint retracts.
    now += 1;
    db.editGoal(g.id, { budget: { ...DEFAULT_BUDGET, quotaPct: 90 } });
    notifier.update(snap());
    expect(retracted).toEqual([`goal:${g.id}`]);
    quota = 95;
    now += GOAL_WATCH_EVERY_MS;
    watch.update(snap());
    notifier.update(snap());
    expect(armed.at(-1)![1].status).toBe("blocked");
  });

  it("holds a lot's end while an objective is open, whatever the setting", () => {
    const db = new BoardDb(":memory:");
    const { card } = lot(db, false);
    const deps = (open: boolean) => ({ enabled: () => false, db, orchestratorAlive: () => false, goalOpen: () => open });
    expect(lotHoldsPush("run:x", { cwd: "/r", status: "done", cardId: card.id }, deps(true))).toBe(true);
    expect(lotHoldsPush("run:x", { cwd: "/r", status: "done", cardId: card.id }, deps(false))).toBe(false);
    expect(lotHoldsPush("%1", { cwd: "/r", status: "blocked", cardId: card.id }, deps(true))).toBe(false); // a blocked worker still rings
  });
});

describe("goal mode: the orchestrator's notes", () => {
  const orch = { paneId: "o1", cwd: "/r", workspaceLabel: orchestratorLabel("/r") };
  const post = (db: BoardDb, body: unknown) =>
    handleBoardRoute(
      "/api/board/notify",
      new Request("http://x/api/board/notify", { method: "POST", headers: { "x-collie-pane": "o1" }, body: JSON.stringify(body) }),
      {
        db,
        engine: { current: () => snap([orch]) },
        audit: { record: () => {} },
        session: "default",
        guard: () => null,
        device: null,
        json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
        text: (b: string, status: number) => new Response(b, { status }),
      } as never,
    );
  const types = (db: BoardDb) => db.eventsAfter(0).map((e) => e.type);

  it("a lot's bilan goes to the objective's journal, not the phone; a question rings and leaves a checkpoint", async () => {
    const db = new BoardDb(":memory:");
    const g = db.createGoal(NEW)!;
    const r = await post(db, { kind: "done", message: "lot A mergé" });
    expect(r!.status).toBe(202);
    expect(types(db)).toEqual(["goal.journal"]);
    await post(db, { kind: "question", message: "on garde l'API v1 ?" });
    expect(types(db)).toEqual(["goal.journal", "goal.checkpoint", "agent.notify"]);
    expect(goalView(db, db.getGoal(g.id)!, null).journal.map((j) => [j.type, j.reason, j.message])).toEqual([
      ["goal.checkpoint", "decision", "on garde l'API v1 ?"],
      ["goal.journal", null, "lot A mergé"],
    ]);
  });

  it("without an open objective, the bilan rings as before", async () => {
    const db = new BoardDb(":memory:");
    await post(db, { kind: "done", message: "lot A mergé" });
    expect(types(db)).toEqual(["agent.notify"]);
  });
});
