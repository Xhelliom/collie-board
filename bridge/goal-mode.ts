// While a repo has an open objective (ADR 0056), the operator is no longer called at each lot's end:
// the lot's bilan goes to the objective's journal (the orchestrator's `done` note is diverted there,
// board-routes.ts; the `run:` alert is held, lot-push.ts), and the bridge raises ONE grouped
// checkpoint at the moments that matter — budget half spent, budget spent, objective claimed, a
// decision asked. Hung off `engine.onUpdate`, throttled inside; no timer.

import type { BoardDb, Goal } from "./db.ts";
import { GOAL_CHECKPOINT, goalView, weekPercent, type CheckpointReason, type GoalView } from "./goal-routes.ts";
import { findOrchestrator } from "./orchestrator.ts";
import type { EngineSnapshot } from "./state-engine.ts";
import { usageTracker } from "./usage.ts";

const OPEN = new Set<Goal["status"]>(["active", "paused", "claimed"]);
export const isOpenGoal = (g: Goal): boolean => OPEN.has(g.status);

/** The repo's open objective, or null — at most one (the db's unique index). */
export const openGoalOf = (db: Pick<BoardDb, "listGoals">, repoPath: string): Goal | null => db.listGoals(repoPath).find(isOpenGoal) ?? null;

/** The open objective whose orchestrator is this pane, or null. */
export function goalOfOrchestrator(db: Pick<BoardDb, "listGoals">, snap: EngineSnapshot, pane: string): Goal | null {
  return db.listGoals().find((g) => isOpenGoal(g) && findOrchestrator(snap, g.repoPath) === pane) ?? null;
}

/** How much of the budget is spent, 0..1+: the larger of lots and quota, 1 once the deadline passed. Pure. */
export function budgetUsed(v: Pick<GoalView, "budget" | "spent">, now: number): number {
  if (v.budget.deadline !== null && now >= v.budget.deadline) return 1;
  return Math.max(v.spent.lots / v.budget.maxLots, v.spent.quotaPct === null ? 0 : v.spent.quotaPct / v.budget.quotaPct);
}

/** The grouped checkpoint, one line: lots, merged, stuck, budget, manual tests. Pure. */
export function goalSummary(v: GoalView): string {
  const p = v.progress;
  return [
    `${v.spent.lots}/${v.budget.maxLots} lots (${p.lotsDone} finis)`,
    `${p.cardsDone} cartes mergées`,
    ...(p.cardsBlocked ? [`${p.cardsBlocked} bloquées`] : []),
    `quota ${v.spent.quotaPct ?? "?"}/${v.budget.quotaPct} %`,
    ...(p.recettes ? [`${p.recettes} recettes à tester`] : []),
  ].join(" · ");
}

/**
 * The checkpoints due now, each with its dedupe key — a key already journaled is not raised again.
 * The budget's keys carry the budget itself, so an operator who raises it hears the new thresholds. Pure.
 */
export function dueCheckpoints(v: GoalView, now: number): { reason: CheckpointReason; key: string }[] {
  if (v.status === "claimed") return [{ reason: "claimed", key: `claimed:${v.updatedAt}` }];
  if (v.status !== "active") return [];
  const used = budgetUsed(v, now);
  const b = `${v.budget.maxLots}:${v.budget.quotaPct}:${v.budget.deadline ?? ""}`;
  if (used >= 1) return [{ reason: "spent", key: `spent:${b}` }];
  if (used >= 0.5) return [{ reason: "half", key: `half:${b}` }];
  return [];
}

/** Journal a checkpoint; board-notify.ts takes it to the herd's slot. */
export function recordCheckpoint(db: BoardDb, v: GoalView, reason: CheckpointReason, key: string | null, message?: string): void {
  db.recordEvent(null, GOAL_CHECKPOINT, { goalId: v.id, repoPath: v.repoPath, reason, key, summary: goalSummary(v), ...(message ? { message } : {}) });
}

/** How often the watch reads the goals — the quota gauge itself moves on minutes, not ticks. */
export const GOAL_WATCH_EVERY_MS = 30_000;

export class GoalWatch {
  private last = 0;

  constructor(
    private readonly db: BoardDb,
    private readonly quota: () => number | null = () => weekPercent(usageTracker.peek()),
    private readonly now: () => number = Date.now,
  ) {}

  update(snap: EngineSnapshot): void {
    if (snap.bridge === "disconnected") return;
    const now = this.now();
    if (now - this.last < GOAL_WATCH_EVERY_MS) return;
    this.last = now;
    const pct = this.quota();
    for (const g of this.db.listGoals()) {
      if (g.status !== "active" && g.status !== "claimed") continue;
      const v = goalView(this.db, g, pct);
      const seen = new Set(this.db.goalJournal(g.id, 200).map((e) => (e.payload as { key?: string } | null)?.key));
      for (const c of dueCheckpoints(v, now)) if (!seen.has(c.key)) recordCheckpoint(this.db, v, c.reason, c.key);
    }
  }
}
