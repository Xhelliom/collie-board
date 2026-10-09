// `/api/orchestrator` — the project tab's planner (ADR 0021). GET reads whether the repo's
// orchestrator lives; POST starts (or adopts) it. Only that POST ever starts one: its cost is the
// operator's quota, so nothing starts it on its own.

import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import type { BoardContext } from "./board-routes.ts";
import { MEMORY_MAX_CHARS } from "./db.ts";
import { askOrchestratorNote, findOrchestrator, restartOrchestrator, startOrchestrator, type OrchestratorDeps } from "./orchestrator.ts";
import { PANE_HEADER } from "./board-routes.ts";

export const ORCHESTRATOR_ROUTE = "/api/orchestrator";
const MEMORY_ROUTE = `${ORCHESTRATOR_ROUTE}/memory`;
const RENEW_ROUTE = `${ORCHESTRATOR_ROUTE}/renew`;

/** The root of a repository — the same bar as `/api/repos/gate/suggest`: the path lands in a prompt. */
const isRepoRoot = (p: unknown): p is string => typeof p === "string" && isAbsolute(p) && existsSync(join(p, ".git"));

const depsOf = (ctx: BoardContext): OrchestratorDeps => ({
  herdr: ctx.herdr,
  cfg: ctx.cfg,
  snapshot: () => ctx.engine.current(),
  memory: (repo) => ctx.db.getMemory(repo),
});

async function bodyOf(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const v: unknown = await req.json();
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function handleOrchestratorRoute(pathname: string, req: Request, ctx: BoardContext): Promise<Response | null> {
  // ── the note it leaves its next self (ADR 0023) ──────────────────────────────
  if (pathname === MEMORY_ROUTE) {
    if (req.method === "GET") {
      const denied = ctx.guard("read");
      if (denied) return denied;
      const repo = new URL(req.url).searchParams.get("repo");
      if (!isRepoRoot(repo)) return ctx.text("repo must be the root of a repository", 400);
      return ctx.json({ memory: ctx.db.getMemory(repo) });
    }
    if (req.method !== "PUT") return ctx.text("method not allowed", 405);
    const denied = ctx.guard("write");
    if (denied) return denied;
    const b = await bodyOf(req);
    if (!b || !isRepoRoot(b.repoPath)) return ctx.text("repoPath must be the root of a repository", 400);
    if (typeof b.note !== "string" || b.note.length > MEMORY_MAX_CHARS)
      return ctx.text(`note must be text of at most ${MEMORY_MAX_CHARS} characters`, 400);
    const memory = ctx.db.putMemory(b.repoPath, b.note.trim());
    ctx.audit.record({ action: "orchestrator.memory", session: ctx.session, device: ctx.device, detail: { repoPath: b.repoPath, chars: memory.note.length } });
    return ctx.json({ memory });
  }

  // ── handing over, at the operator's tap — never on a timer (ADR 0023) ─────────
  if (pathname === RENEW_ROUTE) {
    if (req.method !== "POST") return ctx.text("method not allowed", 405);
    // The agent that would be renewed must not renew itself: this is the operator's gesture.
    if (req.headers.get(PANE_HEADER)?.trim()) return ctx.text("renewing is the operator's gesture — an agent pane may not", 403);
    const denied = ctx.guard("write");
    if (denied) return denied;
    const b = await bodyOf(req);
    if (!b || !isRepoRoot(b.repoPath)) return ctx.text("repoPath must be the root of a repository", 400);
    if (b.step !== "ask" && b.step !== "restart") return ctx.text('step must be "ask" or "restart"', 400);
    try {
      if (b.step === "ask") {
        const paneId = await askOrchestratorNote(depsOf(ctx), b.repoPath);
        if (!paneId) return ctx.json({ ok: false, error: "no orchestrator is running for this repo", kind: "no-session" }, 409);
        ctx.audit.record({ action: "orchestrator.renew_ask", session: ctx.session, device: ctx.device, detail: { repoPath: b.repoPath } });
        return ctx.json({ ok: true, paneId });
      }
      const r = await restartOrchestrator(depsOf(ctx), b.repoPath);
      ctx.audit.record({ action: "orchestrator.renew_restart", session: ctx.session, device: ctx.device, detail: { repoPath: b.repoPath } });
      return ctx.json({ ok: true, paneId: r.paneId, started: r.started });
    } catch (err) {
      return ctx.json({ ok: false, error: (err as Error).message, kind: "herdr" }, 502);
    }
  }

  if (pathname !== ORCHESTRATOR_ROUTE) return null;

  if (req.method === "GET") {
    const denied = ctx.guard("read");
    if (denied) return denied;
    const repo = new URL(req.url).searchParams.get("repo");
    if (!isRepoRoot(repo)) return ctx.text("repo must be the root of a repository", 400);
    const paneId = findOrchestrator(ctx.engine.current(), repo);
    return ctx.json({
      paneId,
      running: paneId !== null,
      ctxPct: paneId ? (ctx.paneContext?.(paneId) ?? null) : null,
      memoryUpdatedAt: ctx.db.getMemory(repo)?.updatedAt ?? null,
    });
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
    const r = await startOrchestrator(depsOf(ctx), repoPath);
    ctx.audit.record({ action: "orchestrator.start", session: ctx.session, device: ctx.device, detail: { repoPath, started: r.started } });
    return ctx.json({ ok: true, paneId: r.paneId, started: r.started });
  } catch (err) {
    return ctx.json({ ok: false, error: (err as Error).message, kind: "herdr" }, 502);
  }
}
