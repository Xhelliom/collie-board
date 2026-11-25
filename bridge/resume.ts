// ADR 0055: under autonomy or an active objective, the repo's orchestrator may resume a lot halted for a mechanical reason.
// Which halts are mechanical is read off the halt itself, pure; anything not recognised stays the operator's.

import type { BoardDb, BoardEvent, Run } from "./db.ts";
import { openGoalOf } from "./goal-mode.ts";
import { EXTERNAL_BLOCK } from "./lead.ts";
import { findOrchestrator } from "./orchestrator.ts";
import { heldHalts } from "./run.ts";
import type { EngineSnapshot } from "./state-engine.ts";

/** Autonomous resumes per lot; past it, the operator's gesture again. */
export const MAX_AUTO_RESUMES = 3;

/** A decision halt: the lead's rounds ran out, it called finished a branch with no commit, or a branch rule refused. Checked first — it quotes the worker. */
const DECISION = /rounds without the lead|yet the branch has no commit|protected branch/i;
const MECHANICAL = [
  /^PR not merged: .*(not up to date|out of date|is behind)/is, // PR not up to date with its base
  /^(PR|merge direct|lot merge): .*(pre-push|failed to push|hook declined)/is, // a red pre-push hook
  // GitHub's own server failing (5xx, `[remote rejected] … (failed)`): passing. A refusal that is a decision (protected branch, review) names its rule instead.
  /^(PR|merge direct|lot merge): .*(HTTP 5\d\d|\b5\d\d (Bad Gateway|Service Unavailable|Gateway Time-?out)|Internal Server Error|\[remote rejected\][^\n]*\(failed\))/is,
  /uncommitted work/, // the checkout had work not committed
  /^start failed: /, // the start failed
  /^no agent ever came up in this pane/, // cards.ts NO_AGENT_REASON: a start that never got its agent
  /^gate could not run: /, // run.ts: the gate gave no verdict (timed out, queued too long, spawn error) — a red gate is a round, never this
];

/** Is this halt one the orchestrator may lift? Pure over its payload. */
export function mechanicalHalt(p: { reason?: unknown; leadSilent?: unknown }): boolean {
  const reason = typeof p.reason === "string" ? p.reason : "";
  // The lead's `blocked` verdict: lifted once the operator says the outside cause is dealt with. Before DECISION — the prefix is the board's, not a quote.
  if (reason.startsWith(EXTERNAL_BLOCK)) return true;
  if (DECISION.test(reason)) return false;
  return p.leadSilent === true || MECHANICAL.some((re) => re.test(reason));
}

/** How many autonomous resume gestures this lot has had: one `at` per gesture, shared by the cards it lifted. */
export function autoResumes(db: BoardDb, run: Run): number {
  const at = new Set<number>();
  for (const c of db.runMembers(run.id))
    for (const e of db.listEvents(c.id, 200)) {
      const p = e.payload as { runId?: string; auto?: number } | null;
      if (e.type === "run.resumed" && p?.runId === run.id && typeof p.auto === "number") at.add(p.auto);
    }
  return at.size;
}

/** Why `pane` may not resume `run`, or null when it may. The owner check (another pair's lot) stays the route's. */
export function autoResumeRefusal(db: BoardDb, run: Run, pane: string, snap: EngineSnapshot): string | null {
  const operator = "resuming is the operator's gesture — an agent pane cannot resume a lot";
  // An active objective (ADR 0056) lets the orchestrator launch without autonomy; it resumes the same way.
  const allowed = db.autonomyOf(run.repoPath).enabled || openGoalOf(db, run.repoPath)?.status === "active";
  if (!allowed || snap.bridge === "disconnected" || findOrchestrator(snap, run.repoPath) !== pane) return operator;
  const held: BoardEvent[] = heldHalts(db, run);
  if (held.some((h) => !mechanicalHalt(h.payload as { reason?: unknown })))
    return "this halt is a decision (the lead's rounds, an empty branch, a verdict) — the operator's to resume";
  if (autoResumes(db, run) >= MAX_AUTO_RESUMES) return `${MAX_AUTO_RESUMES} resumes without the operator on this lot — the bound is reached, theirs now`;
  return null;
}
