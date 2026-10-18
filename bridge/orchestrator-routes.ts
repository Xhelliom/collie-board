// `/api/orchestrator` — the project tab's planner (ADR 0021). GET reads whether the repo's
// orchestrator lives; POST starts (or adopts) it. Only that POST ever starts one: its cost is the
// operator's quota, so nothing starts it on its own.

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import type { BoardContext } from "./board-routes.ts";
import { MEMORY_MAX_CHARS } from "./db.ts";
import { askOrchestratorNote, findOrchestrator, restartOrchestrator, startOrchestrator, type OrchestratorDeps } from "./orchestrator.ts";
import { PANE_HEADER } from "./board-routes.ts";
import { isMaxChain } from "./autonomy.ts";
import { SINCE_EVENT_TYPES, sinceChanges } from "./since.ts";

export const ORCHESTRATOR_ROUTE = "/api/orchestrator";
const MEMORY_ROUTE = `${ORCHESTRATOR_ROUTE}/memory`;
const RENEW_ROUTE = `${ORCHESTRATOR_ROUTE}/renew`;
const AUTONOMY_ROUTE = `${ORCHESTRATOR_ROUTE}/autonomy`;
const SINCE_ROUTE = `${ORCHESTRATOR_ROUTE}/since`;

/** How much of audit.log one read looks at. ponytail: a tail, not an index — a gap longer than this many bytes of gestures loses its oldest lines. */
const AUDIT_TAIL = 512 * 1024;

function auditTail(path: string): string[] {
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch {
    return [];
  }
  const lines = buf.subarray(Math.max(0, buf.length - AUDIT_TAIL)).toString("utf8").split("\n");
  return buf.length > AUDIT_TAIL ? lines.slice(1) : lines; // the first line of a cut is partial
}

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
  // ── « quoi de neuf depuis » : read at the top of a turn, by a hook or by the agent ──────────
  // The caller is the orchestrator its pane header says it is, or nothing is answered (204): the
  // repo is derived from that pane, never named, and a hook installed for every session stays silent.
  if (pathname === SINCE_ROUTE) {
    if (req.method !== "GET") return ctx.text("method not allowed", 405);
    const denied = ctx.guard("read");
    if (denied) return denied;
    const pane = req.headers.get(PANE_HEADER)?.trim();
    const snap = ctx.engine.current();
    const me = pane && snap.bridge !== "disconnected" ? snap.agents.find((a) => a.paneId === pane) : undefined;
    if (!me?.cwd || findOrchestrator(snap, me.cwd) !== pane) return new Response(null, { status: 204 });
    const repo = me.cwd;
    const raw = new URL(req.url).searchParams.get("since");
    // No cursor yet: start from now — the start prompt already told it the past.
    if (!raw || !/^\d+$/.test(raw)) return ctx.json({ cursor: Date.now(), count: 0, summary: "" });
    const since = Number(raw);
    const { db } = ctx;
    return ctx.json(
      sinceChanges({
        auditLines: auditTail(join(ctx.cfg.stateDir, "audit.log")),
        events: db.repoEventsSince(repo, since, SINCE_EVENT_TYPES),
        repo,
        pane,
        since,
        repoOf: (d) =>
          (typeof d.cardId === "string" ? db.getCard(d.cardId)?.repoPath : undefined) ??
          (typeof d.phaseId === "string" ? db.getPhase(d.phaseId)?.repoPath : undefined) ??
          (typeof d.runId === "string" ? db.getRun(d.runId)?.repoPath : undefined) ??
          null,
        labelOf: (d) =>
          (typeof d.cardId === "string" ? db.getCard(d.cardId)?.title : undefined) ??
          (typeof d.phaseId === "string" ? db.getPhase(d.phaseId)?.name : undefined) ??
          (typeof d.runId === "string" ? db.getRun(d.runId)?.name : undefined) ??
          null,
      }),
    );
  }

  // ── how far it may go without the operator (ADR 0030) ───────────────────────
  if (pathname === AUTONOMY_ROUTE) {
    if (req.method === "GET") {
      const denied = ctx.guard("read");
      if (denied) return denied;
      const repo = new URL(req.url).searchParams.get("repo");
      if (!isRepoRoot(repo)) return ctx.text("repo must be the root of a repository", 400);
      return ctx.json({ autonomy: ctx.db.autonomyOf(repo) });
    }
    if (req.method !== "PUT") return ctx.text("method not allowed", 405);
    // An orchestrator that could write this would grant itself the autonomy: the operator's screen only.
    if (req.headers.get(PANE_HEADER)?.trim()) return ctx.text("autonomy is the operator's setting — an agent pane may not change it", 403);
    const denied = ctx.guard("write");
    if (denied) return denied;
    const b = await bodyOf(req);
    if (!b || !isRepoRoot(b.repoPath)) return ctx.text("repoPath must be the root of a repository", 400);
    const cur = ctx.db.autonomyOf(b.repoPath);
    const enabled = b.enabled ?? cur.enabled;
    const stopOnRed = b.stopOnRed ?? cur.stopOnRed;
    const maxChain = b.maxChain === undefined ? cur.maxChain : b.maxChain;
    if (typeof enabled !== "boolean" || typeof stopOnRed !== "boolean") return ctx.text("enabled and stopOnRed must be booleans", 400);
    if (!isMaxChain(maxChain)) return ctx.text("maxChain must be a whole number from 1, or null for unlimited", 400);
    const autonomy = ctx.db.setAutonomy(b.repoPath, { enabled, maxChain, stopOnRed });
    ctx.audit.record({ action: "orchestrator.autonomy", session: ctx.session, device: ctx.device, detail: { repoPath: b.repoPath, enabled, maxChain, stopOnRed } });
    return ctx.json({ autonomy });
  }

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
      // The page's poll reads the roadmap again only when this moves (audit perf #7).
      roadmapRevision: ctx.db.getRoadmap(repo)?.revision ?? null,
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
