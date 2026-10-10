// The orchestrator's autonomy (ADR 0030). Off by default; the operator alone sets it and its bounds.
// What this file decides is only "may the orchestrator launch the next lot after this one?" — the
// answer is armed at the end-of-lot wake (orchestrator-nudge.ts) and spent by one launch.

import type { BoardDb, Run } from "./db.ts";

export const MAX_CHAIN_LIMIT = 1000;

/** `maxChain` as the operator may set it: a whole number from 1, or null for unlimited. */
export const isMaxChain = (v: unknown): v is number | null =>
  v === null || (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_CHAIN_LIMIT);

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

export type Verdict = { go: true; next: Run } | { go: false; why: string | null };

/**
 * At the end of `run`: arm one launch of the next planned lot, or say which bound stops the chain.
 * `why: null` means autonomy is simply off or nothing is planned — nothing to tell the operator.
 */
export function endOfLot(db: BoardDb, run: Run): Verdict {
  const a = db.autonomyOf(run.repoPath);
  if (!a.enabled) return { go: false, why: null };
  const next = db.listRuns(run.repoPath).find((r) => r.launchedAt === null);
  if (!next) return { go: false, why: null };
  if (a.stopOnRed && redCards(db, run).length) return { go: false, why: "un gate ou une CI est rouge" };
  if (a.maxChain !== null && a.chained >= a.maxChain) return { go: false, why: `${a.chained} lot(s) enchaîné(s) sans toi — la borne est atteinte` };
  return { go: true, next };
}
