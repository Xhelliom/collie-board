// The orchestrator's autonomy (ADR 0030). Off by default; the operator alone sets it and its bounds.
// What this file decides is only "may the orchestrator launch the next lot after this one?" — the
// answer is armed at the end-of-lot wake (orchestrator-nudge.ts) and spent by one launch — or, with
// `startWhenIdle` (ADR 0047), read at the launch request when no lot of the repo is running.

import { doneOutsideLot, MAX_ROUNDS_LIMIT, type BoardDb, type Run } from "./db.ts";
import { goalBound, openGoal } from "./goal-routes.ts";

export const MAX_CHAIN_LIMIT = 1000;

/** `maxChain` as the operator may set it: a whole number from 1, or null for unlimited. */
export const isMaxChain = (v: unknown): v is number | null =>
  v === null || (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_CHAIN_LIMIT);

/** The lead's send-backs before the operator, as the operator may set them. */
export const isMaxRounds = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_ROUNDS_LIMIT;

/** The cards of a finished lot whose last gate or CI verdict is red and that never got filed. Pure over the journal. */
export function redCards(db: BoardDb, run: Run): string[] {
  const out: string[] = [];
  for (const c of db.runMembers(run.id)) {
    if (c.status === "done" || c.status === "archived") continue;
    // newest first: the first gate/merge verdict of THIS run decides.
    const last = db
      .listEvents(c.id, 200)
      .find((e) => (e.type === "run.gate" || e.type === "run.merge") && (e.payload as { runId?: string } | null)?.runId === run.id);
    const p = (last?.payload ?? {}) as { ok?: boolean; merged?: boolean; ci?: unknown };
    if (last && (p.ok === false || (p.merged === false && p.ci !== undefined))) out.push(c.id);
  }
  return out;
}

/**
 * `goal` is set when the repo has an objective that decides (ADR 0056): `plan` — nothing planned, wake
 * the orchestrator to plan the rest; `claimed` — the objective waits on the operator, no wake at all;
 * `pause` — a bound is reached, the objective goes to paused and the operator hears it once.
 */
export type Verdict = { go: true; next: Run; goalId?: string } | { go: false; why: string | null; goal?: { id: string; stop: "plan" | "claimed" | "pause" } };

/**
 * At the end of `run`: arm one launch of the next planned lot, or say which bound stops the chain.
 * `why: null` means autonomy is simply off or nothing is planned — nothing to tell the operator.
 * An active objective replaces `enabled` and `maxChain` with its own budget; a claimed one stops all.
 * `quotaPct`: the week's gauge as last read (null: no reading).
 */
export function endOfLot(db: BoardDb, run: Run, quotaPct: number | null = null, now = Date.now()): Verdict {
  const a = db.autonomyOf(run.repoPath);
  const g = openGoal(db, run.repoPath);
  if (g?.status === "claimed") return { go: false, why: null, goal: { id: g.id, stop: "claimed" } };
  const active = g?.status === "active" ? g : null;
  if (!a.enabled && !active) return { go: false, why: null };
  const planned = db.listRuns(run.repoPath).filter((r) => r.launchedAt === null && !doneOutsideLot(r, db.runMembers(r.id)));
  // ADR 0048 §7: only the pair that created a lot launches it — never offer another pair's.
  const next = planned.find((r) => db.ownsRun(r));
  if (!next) {
    const other = planned[0];
    if (!other && active) {
      const bound = goalBound(db, active, quotaPct, now) ?? (a.stopOnRed && redCards(db, run).length ? "un gate ou une CI est rouge" : null);
      return bound ? { go: false, why: bound, goal: { id: active.id, stop: "pause" } } : { go: false, why: null, goal: { id: active.id, stop: "plan" } };
    }
    if (!other) return { go: false, why: null };
    return { go: false, why: `le prochain lot planifié « ${other.name ?? "sans nom"} » a été créé sur un autre poste (${other.createdBy ?? "pair"} ${other.createdPair}) — l'opérateur le lance depuis ce poste-là` };
  }
  if (active) {
    // Red here is after the lot's own resume bound (ADR 0055): the lot ended with it.
    const bound = goalBound(db, active, quotaPct, now) ?? (a.stopOnRed && redCards(db, run).length ? "un gate ou une CI est rouge" : null);
    return bound ? { go: false, why: bound, goal: { id: active.id, stop: "pause" } } : { go: true, next, goalId: active.id };
  }
  if (a.stopOnRed && redCards(db, run).length) return { go: false, why: "un gate ou une CI est rouge" };
  if (a.maxChain !== null && a.chained >= a.maxChain) return { go: false, why: `${a.chained} lot(s) enchaîné(s) sans toi — la borne est atteinte` };
  return { go: true, next };
}

/**
 * ADR 0047: may the orchestrator start `run` now, with no end-of-lot grant? Only with `startWhenIdle`,
 * when no lot of the repo is running, within the chain bound and — with `stopOnRed` — when the last
 * lot finished green. Read at the request; nothing schedules it. Null: it may; else why not.
 */
export function idleRefusal(db: BoardDb, run: Run): string | null {
  const a = db.autonomyOf(run.repoPath);
  if (!a.enabled) return "l'autonomie est coupée";
  if (!a.startWhenIdle) return "aucun lancement armé par une fin de lot";
  if (db.listOpenRuns().some((r) => r.repoPath === run.repoPath)) return "un lot du dépôt est encore ouvert";
  if (a.maxChain !== null && a.chained >= a.maxChain) return `${a.chained} lot(s) enchaîné(s) sans toi — la borne est atteinte`;
  // nothing runs, so every launched lot is finished: the latest launched is the last to have ended.
  const last = db
    .listRuns(run.repoPath)
    .filter((r) => r.launchedAt !== null)
    .reduce<Run | null>((m, r) => (m && m.launchedAt! >= r.launchedAt! ? m : r), null);
  return a.stopOnRed && last && redCards(db, last).length ? "un gate ou une CI est rouge" : null;
}

/**
 * ADR 0056: may the orchestrator launch `run` under the repo's objective? Null: it may — the objective
 * is active, under budget, and no lot of the repo is open (one lot at a time). A string: why not.
 * Undefined: no active objective, autonomy (0030/0047) decides.
 */
export function goalLaunchRefusal(db: BoardDb, run: Run, quotaPct: number | null, now = Date.now()): string | null | undefined {
  const g = openGoal(db, run.repoPath);
  if (g?.status === "claimed") return "l'objectif est déclaré atteint — rien ne se lance avant la réponse de l'opérateur";
  if (g?.status !== "active") return undefined;
  if (db.listOpenRuns().some((r) => r.repoPath === run.repoPath)) return "un lot du dépôt est encore ouvert — un lot à la fois";
  return goalBound(db, g, quotaPct, now);
}
