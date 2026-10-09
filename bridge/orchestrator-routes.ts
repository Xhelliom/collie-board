// `/api/orchestrator` — the project tab's planner (ADR 0021). GET reads whether the repo's
// orchestrator lives; POST starts (or adopts) it. Only that POST ever starts one: its cost is the
// operator's quota, so nothing starts it on its own.

import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import type { BoardContext } from "./board-routes.ts";
import { findOrchestrator, startOrchestrator } from "./orchestrator.ts";

export const ORCHESTRATOR_ROUTE = "/api/orchestrator";

/** The root of a repository — the same bar as `/api/repos/gate/suggest`: the path lands in a prompt. */
const isRepoRoot = (p: unknown): p is string => typeof p === "string" && isAbsolute(p) && existsSync(join(p, ".git"));

export async function handleOrchestratorRoute(pathname: string, req: Request, ctx: BoardContext): Promise<Response | null> {
  if (pathname !== ORCHESTRATOR_ROUTE) return null;

  if (req.method === "GET") {
    const denied = ctx.guard("read");
    if (denied) return denied;
    const repo = new URL(req.url).searchParams.get("repo");
    if (!isRepoRoot(repo)) return ctx.text("repo must be the root of a repository", 400);
    const paneId = findOrchestrator(ctx.engine.current(), repo);
    return ctx.json({ paneId, running: paneId !== null });
  }

  if (req.method !== "POST") return ctx.text("method not allowed", 405);
  const denied = ctx.guard("write");
  if (denied) return denied;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return ctx.text("bad body", 400);
  }
  const { repoPath } = (body ?? {}) as { repoPath?: unknown };
  if (!isRepoRoot(repoPath)) return ctx.text("repoPath must be the root of a repository", 400);
  try {
    const r = await startOrchestrator({ herdr: ctx.herdr, cfg: ctx.cfg, snapshot: () => ctx.engine.current() }, repoPath);
    ctx.audit.record({ action: "orchestrator.start", session: ctx.session, device: ctx.device, detail: { repoPath, started: r.started } });
    return ctx.json({ ok: true, paneId: r.paneId, started: r.started });
  } catch (err) {
    return ctx.json({ ok: false, error: (err as Error).message, kind: "herdr" }, 502);
  }
}
