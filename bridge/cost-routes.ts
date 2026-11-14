// `GET /api/cost?repo=<path>[&runId=…|&phaseId=…][&period=week|all]` — what a lot, a phase or a whole
// project consumed, in tokens. Read-only, summed from the cards' sessions (cost.ts); no timer.
// The project also takes its orchestrator (found by its label, orchestrator.ts), which no card owns.
// That one is live-only (memory, since the bridge started): it joins the `all` period, not `week`.

import type { BoardContext } from "./board-routes.ts";
import { foldCost, type CostSum, type CostTracker } from "./cost.ts";

const WEEK_MS = 7 * 24 * 3600_000;

export function handleCostSumRoute(
  pathname: string,
  req: Request,
  ctx: Pick<BoardContext, "db" | "guard" | "json" | "text"> & { cost?: CostTracker },
): Response | null {
  if (pathname !== "/api/cost" || req.method !== "GET") return null;
  const denied = ctx.guard("read");
  if (denied) return denied;
  const q = new URL(req.url).searchParams;
  const repo = q.get("repo");
  const runId = q.get("runId");
  const phaseId = q.get("phaseId");
  const period = q.get("period") ?? "all";
  if (!repo) return ctx.text("repo required", 400);
  if (period !== "week" && period !== "all") return ctx.text("period must be week or all", 400);
  const cards = ctx.db.listCards({ includeArchived: true }).filter((c) => c.repoPath === repo && (runId ? c.runId === runId : phaseId ? c.phaseId === phaseId : true));
  const since = period === "week" ? Date.now() - WEEK_MS : 0;
  const sum: CostSum | undefined = ctx.cost?.forCards(cards.map((c) => c.id), since);
  if (!sum) return ctx.json({ known: false, tokens: null, byModel: [], cards: cards.length, unknownCards: cards.length, orchestrator: null, period });
  const orch = !runId && !phaseId && period === "all" ? ctx.cost!.forOrchestrator(repo) : null;
  const parts = [sum.known ? sum.byModel : null, orch?.known ? orch.byModel : null].filter((p) => p);
  const total = foldCost(parts, true);
  return ctx.json({
    known: total.known,
    tokens: total.tokens,
    byModel: total.byModel,
    cards: sum.cards,
    unknownCards: sum.unknownCards,
    orchestrator: orch && { known: orch.known, tokens: orch.tokens },
    period,
  });
}
