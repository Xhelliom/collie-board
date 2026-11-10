// A repo's objective — ADR 0056. The operator sets it, edits it, pauses, abandons and validates it;
// an agent pane may only read it and claim it reached. Its lots are derived (launched while it was
// open), never declared, and its quota is the week's gauge the dashboard already reads.

import type { BoardContext } from "./board-routes.ts";
import type { BoardDb, Goal, GoalStatus } from "./db.ts";
import { repoPathOf } from "./paths.ts";
import { usageTracker, type ClaudeUsage } from "./usage.ts";

const GOALS = "/api/goals";
const GOAL = /^\/api\/goals\/([^/]+)(?:\/(pause|resume|claim|achieve|abandon))?$/;

const MAX_TEXT = 2_000;
const MAX_CRITERION = 500;
const MAX_CRITERIA = 20;
export const DEFAULT_BUDGET: Goal["budget"] = { maxLots: 10, quotaPct: 80, deadline: null };

/** Which statuses each gesture moves from, and to. `claim` is the only one an agent pane may make. */
const MOVES: Record<string, { from: GoalStatus[]; to: GoalStatus }> = {
  pause: { from: ["active", "claimed"], to: "paused" },
  resume: { from: ["paused", "claimed"], to: "active" },
  claim: { from: ["active"], to: "claimed" },
  achieve: { from: ["active", "claimed", "paused"], to: "achieved" },
  abandon: { from: ["active", "claimed", "paused"], to: "abandoned" },
};

export interface GoalView extends Goal {
  /**
   * What the objective has spent — `lots`, the ones launched while it was open, is what the budget counts —
   * and what is attached to it: those lots plus the ones planned while it was open, their cards and the
   * cards of its phases (the repo's phases created while it was open).
   */
  spent: { lots: number; lotIds: string[]; cardIds: string[]; phaseIds: string[]; quotaPct: number | null };
}

/** The repo's open objective (active, paused or claimed), or null. */
export const openGoal = (db: BoardDb, repoPath: string): Goal | null =>
  db.listGoals(repoPath).find((g) => g.status === "active" || g.status === "paused" || g.status === "claimed") ?? null;

const within = (g: Goal, t: number) => t >= g.createdAt && (g.endedAt === null || t <= g.endedAt);

/** The week's all-models limit, as the gauge reads it — the one the budget's `quotaPct` is about. */
export function weekPercent(u: ClaudeUsage | null): number | null {
  const week = u?.limits.filter((l) => /week/i.test(l.label)) ?? [];
  return (week.find((l) => /all models/i.test(l.label)) ?? week[0])?.percent ?? null;
}

/** Pure over the db: the repo's lots launched while the objective was open are its lots. */
export function goalView(db: BoardDb, g: Goal, quotaPct: number | null): GoalView {
  const runs = db.listRuns(g.repoPath);
  const launched = runs.filter((r) => r.launchedAt !== null && within(g, r.launchedAt));
  const lots = [...launched, ...runs.filter((r) => r.launchedAt === null && within(g, r.createdAt))];
  const phaseIds = db.listPhases(g.repoPath).filter((p) => within(g, p.createdAt)).map((p) => p.id);
  const inPhases = phaseIds.length ? db.listCards().filter((c) => c.phaseId !== null && phaseIds.includes(c.phaseId)) : [];
  const cardIds = [...new Set([...lots.flatMap((r) => db.runMembers(r.id)), ...inPhases].map((c) => c.id))];
  return { ...g, spent: { lots: launched.length, lotIds: lots.map((r) => r.id), cardIds, phaseIds, quotaPct } };
}

/** The budget bound the objective has reached, or null — lots, the week's quota, the deadline. Pure. */
export function goalBound(db: BoardDb, g: Goal, quotaPct: number | null, now = Date.now()): string | null {
  const lots = goalView(db, g, quotaPct).spent.lots;
  if (lots >= g.budget.maxLots) return `budget de l'objectif atteint : ${lots} lot(s) sur ${g.budget.maxLots}`;
  if (quotaPct !== null && quotaPct >= g.budget.quotaPct) return `quota de la semaine à ${quotaPct} % (borne ${g.budget.quotaPct} %)`;
  if (g.budget.deadline !== null && now > g.budget.deadline) return "l'échéance de l'objectif est passée";
  return null;
}

/** `budget` as the operator may send it, merged over `base`; a string says what is wrong. */
export function parseBudget(v: unknown, base: Goal["budget"]): Goal["budget"] | string {
  if (v === undefined) return base;
  if (typeof v !== "object" || v === null || Array.isArray(v)) return "bad budget";
  const b = { ...base, ...(v as Partial<Goal["budget"]>) };
  if (!Number.isInteger(b.maxLots) || b.maxLots < 1 || b.maxLots > 1000) return "budget.maxLots must be a whole number from 1 to 1000";
  if (!Number.isInteger(b.quotaPct) || b.quotaPct < 1 || b.quotaPct > 100) return "budget.quotaPct must be a whole number from 1 to 100";
  if (b.deadline !== null && !(typeof b.deadline === "number" && Number.isFinite(b.deadline) && b.deadline > 0)) return "budget.deadline must be epoch ms or null";
  return { maxLots: b.maxLots, quotaPct: b.quotaPct, deadline: b.deadline };
}

const text = (v: unknown) => (typeof v === "string" && v.trim() !== "" && v.length <= MAX_TEXT ? v.trim() : null);
const criteria = (v: unknown): string[] | null => {
  if (!Array.isArray(v) || v.length > MAX_CRITERIA) return null;
  const out = v.map((c) => (typeof c === "string" && c.length <= MAX_CRITERION ? c.trim() : ""));
  return out.length > 0 && out.every(Boolean) ? out : null;
};

async function bodyOf(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const v: unknown = await req.json();
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `pane` is the caller's `x-collie-pane`. Null: not ours. */
export async function handleGoalRoute(pathname: string, req: Request, ctx: BoardContext, pane: string | null): Promise<Response | null> {
  const m = GOAL.exec(pathname);
  if (pathname !== GOALS && !m) return null;
  const { db } = ctx;
  const quota = () => weekPercent(usageTracker.peek());
  const audit = (action: string, detail: Record<string, unknown>) => ctx.audit.record({ action, session: ctx.session, device: ctx.device, detail });

  if (req.method === "GET") {
    const denied = ctx.guard("read");
    if (denied) return denied;
    if (m && m[2]) return ctx.text("method not allowed", 405);
    if (m) {
      const g = db.getGoal(m[1]!);
      return g ? ctx.json({ goal: goalView(db, g, quota()) }) : ctx.text("not found", 404);
    }
    const q = new URL(req.url).searchParams.get("repo");
    const q2 = q === null ? undefined : (repoPathOf(q) ?? q);
    const pct = quota();
    return ctx.json({ goals: db.listGoals(q2).map((g) => goalView(db, g, pct)) });
  }

  const denied = ctx.guard("write");
  if (denied) return denied;
  const move = m?.[2];
  // Setting, editing, pausing, abandoning and validating the objective are the operator's (ADR 0056).
  if (pane && move !== "claim") return ctx.text("the objective is the operator's — an agent pane may read it and claim it reached, nothing else", 403);

  if (pathname === GOALS) {
    if (req.method !== "POST") return ctx.text("method not allowed", 405);
    const b = await bodyOf(req);
    if (!b) return ctx.text("bad body", 400);
    const repoPath = repoPathOf(b.repoPath);
    if (!repoPath) return ctx.text("repoPath must be an absolute path", 400);
    const t = text(b.text);
    if (!t) return ctx.text("text required", 400);
    const c = criteria(b.criteria);
    if (!c) return ctx.text(`criteria: 1 to ${MAX_CRITERIA} non-empty strings`, 400);
    const budget = parseBudget(b.budget, DEFAULT_BUDGET);
    if (typeof budget === "string") return ctx.text(budget, 400);
    const g = db.createGoal({ repoPath, text: t, criteria: c, budget });
    if (!g) return ctx.text("this repo already has an open objective — finish, abandon or edit it", 409);
    audit("goal.create", { goalId: g.id, repoPath });
    return ctx.json({ goal: goalView(db, g, quota()) }, 201);
  }

  const g = db.getGoal(m![1]!);
  if (!g) return ctx.text("not found", 404);

  if (!move) {
    if (req.method !== "PATCH") return ctx.text("method not allowed", 405);
    if (!MOVES.abandon!.from.includes(g.status)) return ctx.text(`a ${g.status} objective is closed`, 409);
    const b = await bodyOf(req);
    if (!b) return ctx.text("bad body", 400);
    const t = b.text === undefined ? g.text : text(b.text);
    if (!t) return ctx.text("bad text", 400);
    const c = b.criteria === undefined ? g.criteria : criteria(b.criteria);
    if (!c) return ctx.text(`criteria: 1 to ${MAX_CRITERIA} non-empty strings`, 400);
    const budget = parseBudget(b.budget, g.budget);
    if (typeof budget === "string") return ctx.text(budget, 400);
    const edited = db.editGoal(g.id, { text: t, criteria: c, budget })!;
    audit("goal.edit", { goalId: g.id, repoPath: g.repoPath });
    return ctx.json({ goal: goalView(db, edited, quota()) });
  }

  if (req.method !== "POST") return ctx.text("method not allowed", 405);
  const { from, to } = MOVES[move]!;
  // Resuming a claimed objective is refusing the claim: the operator says why, and that is what wakes the orchestrator.
  const comment = move === "resume" ? text((await bodyOf(req))?.comment) : null;
  if (move === "resume" && g.status === "claimed" && !comment) return ctx.text("refusing a claimed objective needs a comment: what is still missing", 400);
  if (!db.setGoalStatus(g.id, from, to)) return ctx.text(`cannot ${move} a ${g.status} objective`, 409);
  audit(`goal.${move}`, { goalId: g.id, repoPath: g.repoPath, ...(comment ? { comment } : {}) });
  // Journaled for the orchestrator nudger (ADR 0028): nothing runs while it was stopped, so no end of lot would wake it.
  if (move === "resume") db.recordEvent(null, "goal.resumed", { goalId: g.id, from: g.status, comment });
  // The phases the orchestrator cut during the objective are not validated one by one: validating the objective closes them.
  if (move === "achieve")
    for (const id of goalView(db, g, null).spent.phaseIds)
      if (db.getPhase(id)?.closedAt === null && !db.phaseHasUnfinishedLot(id)) db.closePhase(id, { moveOpenTo: null, note: "close par la validation de l'objectif" });
  return ctx.json({ goal: goalView(db, db.getGoal(g.id)!, quota()) });
}
