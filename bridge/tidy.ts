// « Ménage » — the panes that no longer serve, proposed for closing in one gesture. Derived on every
// read from the snapshot and the cards; nothing here is stored. Closing is the operator's gesture:
// the route refuses an agent pane, and re-derives the list so a pane that went back to work since the
// screen was drawn is not closed. Worktrees are untouched — their cleanup stays the card's.

import type { BoardContext } from "./board-routes.ts";
import { PANE_HEADER } from "./board-routes.ts";
import type { Card, CardSession, Run } from "./db.ts";
import { isOrchestratorAgent } from "./orchestrator.ts";
import { isLeadPane } from "./run.ts";
import type { EngineSnapshot } from "./state-engine.ts";

export const TIDY_ROUTE = "/api/tidy";
const CLOSE_ROUTE = `${TIDY_ROUTE}/close`;
export const DEFAULT_IDLE_HOURS = 2;

/** Why a pane is proposed — in the order a pane is classed: the first that holds wins. */
export type TidyReason = "card-done" | "agent-done" | "idle" | "shell";

export interface TidyCandidate {
  paneId: string;
  reason: TidyReason;
  /** Since when the reason holds (epoch ms), or null when the bridge never saw it start. */
  since: number | null;
  agent: string;
  workspaceLabel: string;
  label: string | null;
  cwd: string;
  cardId?: string;
  cardTitle?: string;
}

export interface TidyDeps {
  sessionOfPane: (paneId: string) => CardSession | null;
  getCard: (id: string) => Card | null;
  getRun: (id: string) => Run | null;
  runFinished: (id: string) => boolean;
  /** The board's own panes (lead, copilot): never proposed. */
  isBoardPane: (paneId: string, workspaceLabel: string) => boolean;
}

const filed = (c: Card | null): boolean => c?.status === "done" || c?.status === "archived";

/** The candidates, grouped by `reason` in that order. Pure over its arguments. */
export function tidyCandidates(snap: EngineSnapshot, deps: TidyDeps, idleMs: number, now = Date.now()): TidyCandidate[] {
  if (snap.bridge === "disconnected") return [];
  const out: TidyCandidate[] = [];
  for (const p of [...snap.agents, ...snap.shellPanes]) {
    if (p.status === "working" || p.status === "blocked") continue;
    if (isOrchestratorAgent(p) || deps.isBoardPane(p.paneId, p.workspaceLabel)) continue;
    // ponytail: a pane pinned by the operator is never proposed — no pin exists yet (card « Épingler des sessions »); exclude it here when it lands.
    const session = deps.sessionOfPane(p.paneId);
    const card = session ? deps.getCard(session.cardId) : null;
    // A card of a lot in flight is the lead's to drive, whatever its column says.
    const run = card?.runId ? deps.getRun(card.runId) : null;
    if (run && run.launchedAt !== null && !deps.runFinished(run.id)) continue;
    // A card still in progress keeps its pane — only an open session says so (an ended one is history).
    const live = card && session && session.endedAt === null && !filed(card);

    let reason: TidyReason | null = null;
    let since: number | null = p.statusSince ?? null;
    if (filed(card)) {
      reason = "card-done";
      since = card!.updatedAt;
    } else if (live) {
      continue;
    } else if (p.kind === "shell" || snap.shellPanes.includes(p)) {
      reason = "shell";
      since = null;
    } else if (p.status === "done") {
      reason = "agent-done";
    } else if (p.status === "idle" && p.statusSince !== undefined && now - p.statusSince >= idleMs) {
      // ponytail: an idle pane the bridge never saw settle (first seen idle after a restart) has no age — left out rather than guessed.
      reason = "idle";
    }
    if (!reason) continue;
    out.push({
      paneId: p.paneId,
      reason,
      since,
      agent: p.agent,
      workspaceLabel: p.workspaceLabel,
      label: p.paneLabel ?? p.sessionName ?? null,
      cwd: p.cwd,
      ...(card ? { cardId: card.id, cardTitle: card.title } : {}),
    });
  }
  const order: TidyReason[] = ["card-done", "agent-done", "idle", "shell"];
  return out.sort((a, b) => order.indexOf(a.reason) - order.indexOf(b.reason) || (a.since ?? Infinity) - (b.since ?? Infinity));
}

/** `idleHours` from a query or a body: a positive number, else the default. */
export function idleMsOf(v: unknown): number {
  const h = typeof v === "string" ? Number(v) : v;
  return (typeof h === "number" && Number.isFinite(h) && h > 0 ? h : DEFAULT_IDLE_HOURS) * 3600_000;
}

const depsOf = (ctx: BoardContext): TidyDeps => ({
  sessionOfPane: (id) => ctx.db.openSessionByPane(id) ?? ctx.db.lastSessionByPane(id),
  getCard: (id) => ctx.db.getCard(id),
  getRun: (id) => ctx.db.getRun(id),
  runFinished: (id) => ctx.db.runFinished(id),
  isBoardPane: (id, ws) => isLeadPane(id) || id === ctx.copilot.paneId || ws === ctx.cfg.boardCopilotWorkspace,
});

/** `GET /api/tidy?idleHours=2` — the candidates; `POST /api/tidy/close` `{ paneIds, idleHours }` — close them. */
export async function handleTidyRoute(pathname: string, req: Request, ctx: BoardContext): Promise<Response | null> {
  if (pathname !== TIDY_ROUTE && pathname !== CLOSE_ROUTE) return null;
  if (pathname === TIDY_ROUTE) {
    if (req.method !== "GET") return ctx.text("method not allowed", 405);
    const denied = ctx.guard("read");
    if (denied) return denied;
    const snap = ctx.engine.current();
    if (snap.bridge === "disconnected") return ctx.text("herdr is not connected", 503);
    const idleMs = idleMsOf(new URL(req.url).searchParams.get("idleHours"));
    return ctx.json({ candidates: tidyCandidates(snap, depsOf(ctx), idleMs), idleHours: idleMs / 3600_000 });
  }
  if (req.method !== "POST") return ctx.text("method not allowed", 405);
  if (req.headers.get(PANE_HEADER)?.trim()) return ctx.text("tidying is the operator's gesture — an agent pane may not close panes", 403);
  const denied = ctx.guard("write");
  if (denied) return denied;
  let body: { paneIds?: unknown; idleHours?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return ctx.text("bad body", 400);
  }
  if (!Array.isArray(body.paneIds) || !body.paneIds.every((id) => typeof id === "string")) return ctx.text("paneIds must be a list of pane ids", 400);
  const snap = ctx.engine.current();
  if (snap.bridge === "disconnected") return ctx.text("herdr is not connected", 503);
  // Only what is STILL a candidate: a pane that went back to work since the screen was drawn stays.
  const now = new Map(tidyCandidates(snap, depsOf(ctx), idleMsOf(body.idleHours)).map((c) => [c.paneId, c]));
  const closed: string[] = [];
  const skipped: string[] = [];
  const failed: { paneId: string; error: string }[] = [];
  for (const paneId of new Set(body.paneIds as string[])) {
    const c = now.get(paneId);
    if (!c) {
      skipped.push(paneId);
      continue;
    }
    try {
      await ctx.herdr.closePane(paneId);
      closed.push(paneId);
      ctx.audit.record({ action: "pane.close", paneId, session: ctx.session, device: ctx.device, detail: { via: "tidy", reason: c.reason, ...(c.cardId ? { cardId: c.cardId } : {}) } });
    } catch (err) {
      failed.push({ paneId, error: (err as Error).message });
    }
  }
  return ctx.json({ ok: failed.length === 0, closed, skipped, failed });
}
