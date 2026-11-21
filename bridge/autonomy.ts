// The orchestrator's autonomy (ADR 0030). Off by default; the operator alone sets it and its bounds.
// What this file decides is only "may the orchestrator launch the next lot after this one?" — the
// answer is armed at the end-of-lot wake (orchestrator-nudge.ts) and spent by one launch — or, with
// `startWhenIdle` (ADR 0047), read at the launch request when no lot of the repo is running.

import { doneOutsideLot, MAX_ROUNDS_LIMIT, type BoardDb, type Run } from "./db.ts";
import { goalBound } from "./goal-routes.ts";
import { openGoalOf } from "./goal-mode.ts";
import { sharedFile } from "./lot-overlap.ts";

export const MAX_CHAIN_LIMIT = 1000;

/** `maxChain` as the operator may set it: a whole number from 1, or null for unlimited. */
export const isMaxChain = (v: unknown): v is number | null =>
  v === null || (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_CHAIN_LIMIT);

/** `maxLots` as the operator may set it: a whole number from 1 (ADR 0063). */
export const isMaxLots = (v: unknown): v is number => v !== null && isMaxChain(v);

/**
 * ADR 0063: may the orchestrator open `run` beside the repo's open lots? Not at the operator's
 * `maxLots`, nor when one of its cards cites a file a card of an open lot already cites — their PRs
 * would conflict. Null: it may; else why not, naming the bound or the file.
 */
export function lotsRefusal(db: BoardDb, run: Run): string | null {
  const open = db.listOpenRuns().filter((r) => r.repoPath === run.repoPath && r.id !== run.id);
  const max = db.autonomyOf(run.repoPath).maxLots;
  if (open.length >= max)
    return max === 1 ? "un lot du dépôt est encore ouvert" : `${open.length} lots du dépôt sont ouverts — la borne « Lots en parallèle » (${max}) est atteinte`;
  const f = sharedFile(db.runMembers(run.id), open.flatMap((r) => db.runMembers(r.id)));
  return f ? `le fichier ${f} est déjà cité par une carte d'un lot ouvert — lance ce lot après lui, ou laisse l'opérateur le lancer` : null;
}

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
  const g = openGoalOf(db, run.repoPath);
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
 * when fewer than `maxLots` lots of the repo are open (ADR 0063), within the chain bound and — with `stopOnRed` — when the last
 * lot finished green. Read at the request; nothing schedules it. Null: it may; else why not.
 */
export function idleRefusal(db: BoardDb, run: Run): string | null {
  const a = db.autonomyOf(run.repoPath);
  if (!a.enabled) return "l'autonomie est coupée";
  if (!a.startWhenIdle) return "aucun lancement armé par une fin de lot";
  const lots = lotsRefusal(db, run);
  if (lots) return lots;
  if (a.maxChain !== null && a.chained >= a.maxChain) return `${a.chained} lot(s) enchaîné(s) sans toi — la borne est atteinte`;
  // the latest launched lot that has ended — open ones have no verdict yet.
  const open = new Set(db.listOpenRuns().map((r) => r.id));
  const last = db
    .listRuns(run.repoPath)
    .filter((r) => r.launchedAt !== null && !open.has(r.id))
    .reduce<Run | null>((m, r) => (m && m.launchedAt! >= r.launchedAt! ? m : r), null);
  return a.stopOnRed && last && redCards(db, last).length ? "un gate ou une CI est rouge" : null;
}

/**
 * ADR 0056: may the orchestrator launch `run` under the repo's objective? Null: it may — the objective
 * is active, under budget, and fewer than `maxLots` lots of the repo are open, none citing a file of this one (ADR 0063). A string: why not.
 * Undefined: no active objective, autonomy (0030/0047) decides.
 */
export function goalLaunchRefusal(db: BoardDb, run: Run, quotaPct: number | null, now = Date.now()): string | null | undefined {
  const g = openGoalOf(db, run.repoPath);
  if (g?.status === "claimed") return "l'objectif est déclaré atteint — rien ne se lance avant la réponse de l'opérateur";
  if (g?.status !== "active") return undefined;
  return lotsRefusal(db, run) ?? goalBound(db, g, quotaPct, now);
}
