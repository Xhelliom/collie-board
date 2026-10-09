// Phases, lots and the roadmap — ADR 0021. The routes a planner uses (the project panel's
// orchestrator, or any session with the collie-board skill) to PREPARE a project. Nothing here
// launches: `POST /api/runs/:id/launch` is the operator's gesture, and it refuses a caller that
// identifies itself as an agent pane (ADR 0010's header), as does the old unplanned `POST /api/runs`.

import { basename } from "node:path";

import { isMaxParallel, RevisionConflict, type Run } from "./db.ts";
import type { BoardContext } from "./board-routes.ts";
import { parseDecision, parseRoadmapBody, roadmapMarkdown, stepsMarkdown } from "./roadmap.ts";

const MAX_NAME = 200;
const MAX_GOAL = 2_000;

const PHASES = "/api/phases";
const PHASE = /^\/api\/phases\/([^/]+)$/;
const RUNS = "/api/runs";
const RUN = /^\/api\/runs\/([^/]+)(?:\/(launch))?$/;
const ROADMAP = "/api/roadmap";
const DECISION = "/api/roadmap/decision";

async function bodyOf(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const v: unknown = await req.json();
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const name = (v: unknown) => (typeof v === "string" && v.trim() !== "" && v.length <= MAX_NAME ? v.trim() : null);
const goal = (v: unknown) => (typeof v === "string" && v.length <= MAX_GOAL ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A run with the ids of its cards — what a planner needs to read a lot. */
const lotView = (ctx: BoardContext, run: Run) => ({ ...run, cardIds: ctx.db.runMembers(run.id).map((c) => c.id) });

/** `pane` is the caller's `x-collie-pane`, read once by the dispatcher. Null: not ours. */
export async function handleProjectRoute(
  pathname: string,
  req: Request,
  ctx: BoardContext,
  pane: string | null,
): Promise<Response | null> {
  const { db } = ctx;
  const audit = (action: string, detail: Record<string, unknown>) =>
    ctx.audit.record({ action, session: ctx.session, device: ctx.device, detail: { ...detail, ...(pane ? { pane } : {}) } });
  const guard = (level: "read" | "write") => ctx.guard(level);

  // ── phases ─────────────────────────────────────────────────────────────────
  if (pathname === PHASES) {
    if (req.method === "GET") {
      const denied = guard("read");
      if (denied) return denied;
      return ctx.json({ phases: db.listPhases(new URL(req.url).searchParams.get("repo") ?? undefined) });
    }
    if (req.method !== "POST") return ctx.text("method not allowed", 405);
    const denied = guard("write");
    if (denied) return denied;
    const b = await bodyOf(req);
    if (!b) return ctx.text("bad body", 400);
    if (typeof b.repoPath !== "string" || !b.repoPath.startsWith("/")) return ctx.text("repoPath must be an absolute path", 400);
    const n = name(b.name);
    if (!n) return ctx.text("name required", 400);
    const g = b.goal === undefined ? "" : goal(b.goal);
    if (g === null) return ctx.text("bad goal", 400);
    if (b.position !== undefined && num(b.position) === null) return ctx.text("bad position", 400);
    if (b.roadmapItemId !== undefined && b.roadmapItemId !== null && typeof b.roadmapItemId !== "string") return ctx.text("bad roadmapItemId", 400);
    const phase = db.createPhase({
      repoPath: b.repoPath,
      name: n,
      goal: g,
      position: b.position === undefined ? undefined : (b.position as number),
      roadmapItemId: (b.roadmapItemId as string | null | undefined) ?? null,
    });
    audit("phase.create", { phaseId: phase.id, name: n });
    return ctx.json({ phase }, 201);
  }

  const phaseMatch = PHASE.exec(pathname);
  if (phaseMatch) {
    const id = phaseMatch[1]!;
    if (req.method === "PATCH") {
      const denied = guard("write");
      if (denied) return denied;
      if (!db.getPhase(id)) return ctx.text("phase not found", 404);
      const b = await bodyOf(req);
      if (!b) return ctx.text("bad body", 400);
      const patch: Parameters<typeof db.updatePhase>[1] = {};
      if ("name" in b) {
        const n = name(b.name);
        if (!n) return ctx.text("name required", 400);
        patch.name = n;
      }
      if ("goal" in b) {
        const g = goal(b.goal);
        if (g === null) return ctx.text("bad goal", 400);
        patch.goal = g;
      }
      if ("position" in b) {
        const p = num(b.position);
        if (p === null) return ctx.text("bad position", 400);
        patch.position = p;
      }
      if ("roadmapItemId" in b) {
        if (b.roadmapItemId !== null && typeof b.roadmapItemId !== "string") return ctx.text("bad roadmapItemId", 400);
        patch.roadmapItemId = b.roadmapItemId as string | null;
      }
      const phase = db.updatePhase(id, patch);
      audit("phase.patch", { phaseId: id, ...patch });
      return ctx.json({ phase });
    }
    if (req.method === "DELETE") {
      const denied = guard("write");
      if (denied) return denied;
      if (!db.deletePhase(id)) return ctx.text("phase not found", 404);
      audit("phase.delete", { phaseId: id });
      return ctx.json({ ok: true });
    }
    return ctx.text("method not allowed", 405);
  }

  // ── lots (runs) ────────────────────────────────────────────────────────────
  // POST /api/runs stays in board-routes (it is the old gesture, extended with `planned`).
  if (pathname === RUNS && req.method === "GET") {
    const denied = guard("read");
    if (denied) return denied;
    const repo = new URL(req.url).searchParams.get("repo") ?? undefined;
    return ctx.json({ runs: db.listRuns(repo).map((r) => lotView(ctx, r)) });
  }

  const runMatch = RUN.exec(pathname);
  if (runMatch) {
    const id = runMatch[1]!;
    if (runMatch[2] === "launch") {
      if (req.method !== "POST") return ctx.text("method not allowed", 405);
      const denied = guard("write");
      if (denied) return denied;
      // The planner prepares; the operator launches. A caller that names itself an agent pane is
      // refused whatever else it says — consent is not something an agent can give itself.
      if (pane) return ctx.text("launching is the operator's gesture — an agent pane cannot launch a lot", 403);
      const run = db.getRun(id);
      if (!run) return ctx.text("run not found", 404);
      if (!db.launchRun(id)) return ctx.text("already launched", 409);
      audit("run.launch", { runId: id });
      return ctx.json({ run: db.getRun(id) });
    }
    if (req.method === "PATCH") {
      const denied = guard("write");
      if (denied) return denied;
      const run = db.getRun(id);
      if (!run) return ctx.text("run not found", 404);
      if (run.launchedAt !== null) return ctx.text("a launched run is not edited", 409);
      const b = await bodyOf(req);
      if (!b) return ctx.text("bad body", 400);
      const patch: Parameters<typeof db.updateLot>[1] = {};
      if ("name" in b) {
        if (b.name !== null && !name(b.name)) return ctx.text("bad name", 400);
        patch.name = b.name === null ? null : name(b.name);
      }
      if ("position" in b) {
        const p = num(b.position);
        if (p === null) return ctx.text("bad position", 400);
        patch.position = p;
      }
      if ("maxParallel" in b) {
        if (b.maxParallel !== null && !isMaxParallel(b.maxParallel)) return ctx.text("maxParallel must be a whole number from 1 to 16, or null", 400);
        patch.maxParallel = b.maxParallel as number | null;
      }
      if ("phaseId" in b) {
        if (b.phaseId !== null && (typeof b.phaseId !== "string" || db.getPhase(b.phaseId)?.repoPath !== run.repoPath))
          return ctx.text("phaseId: no such phase in this repo", 400);
        patch.phaseId = b.phaseId as string | null;
      }
      if ("cardIds" in b) {
        if (!Array.isArray(b.cardIds) || !b.cardIds.every((c) => typeof c === "string") || new Set(b.cardIds).size !== b.cardIds.length)
          return ctx.text("cardIds must be a list of distinct card ids", 400);
        patch.cardIds = b.cardIds as string[];
      }
      try {
        db.updateLot(id, patch);
      } catch (err) {
        return ctx.text((err as Error).message, 409);
      }
      audit("run.patch", { runId: id, ...patch });
      return ctx.json({ run: lotView(ctx, db.getRun(id)!) });
    }
    if (req.method === "DELETE") {
      const denied = guard("write");
      if (denied) return denied;
      const run = db.getRun(id);
      if (!run) return ctx.text("run not found", 404);
      if (!db.deleteLot(id)) return ctx.text("a launched run is not deleted", 409);
      audit("run.delete", { runId: id });
      return ctx.json({ ok: true });
    }
    return ctx.text("method not allowed", 405);
  }

  // ── roadmap ────────────────────────────────────────────────────────────────
  // One decision, upserted as it is taken (ADR 0023): no revision to carry, so the orchestrator can
  // write mid-conversation without racing the operator's editor.
  if (pathname === DECISION) {
    if (req.method !== "POST") return ctx.text("method not allowed", 405);
    const denied = guard("write");
    if (denied) return denied;
    const b = await bodyOf(req);
    if (!b) return ctx.text("bad body", 400);
    if (typeof b.repoPath !== "string" || !b.repoPath.startsWith("/")) return ctx.text("repoPath must be an absolute path", 400);
    const d = parseDecision(b);
    if (!d.ok) return ctx.text(d.error, 400);
    if (d.value.itemId && !db.getRoadmap(b.repoPath)?.items.some((i) => i.id === d.value.itemId))
      return ctx.text("itemId: no such roadmap item", 400);
    try {
      const { roadmap, decision } = db.upsertDecision(b.repoPath, d.value);
      audit("roadmap.decision", { repoPath: b.repoPath, id: decision.id, status: decision.status });
      return ctx.json({ decision, revision: roadmap.revision });
    } catch (err) {
      return ctx.text((err as Error).message, 409);
    }
  }
  if (pathname === ROADMAP) {
    if (req.method === "GET") {
      const denied = guard("read");
      if (denied) return denied;
      const q = new URL(req.url).searchParams;
      const repo = q.get("repo");
      if (!repo || !repo.startsWith("/")) return ctx.text("repo must be an absolute path", 400);
      const roadmap = db.getRoadmap(repo) ?? { repoPath: repo, vision: "", items: [], decisions: [], revision: 0, updatedAt: 0 };
      const format = q.get("format");
      if (format === "md" || format === "steps") {
        // `md` is the authored, detailed roadmap; `steps` is rendered from the board's own phases,
        // lots and cards (ADR 0023) — the caller writes either into the repo, the bridge never does.
        const text =
          format === "md"
            ? roadmapMarkdown(basename(repo), roadmap)
            : stepsMarkdown(basename(repo), {
                phases: db.listPhases(repo),
                lots: db.listRuns(repo),
                cards: db.listCards().filter((c) => c.repoPath === repo),
              });
        return new Response(text, { headers: { "content-type": "text/markdown; charset=utf-8" } });
      }
      return ctx.json({ roadmap });
    }
    if (req.method !== "PUT") return ctx.text("method not allowed", 405);
    const denied = guard("write");
    if (denied) return denied;
    const parsed = parseRoadmapBody(await bodyOf(req));
    if (!parsed.ok) return ctx.text(parsed.error, 400);
    const { repoPath, vision, items, decisions, revision } = parsed.value;
    try {
      const roadmap = db.putRoadmap(repoPath, { vision, items, decisions }, revision);
      audit("roadmap.put", { repoPath, revision: roadmap.revision, items: items.length });
      return ctx.json({ roadmap });
    } catch (err) {
      if (err instanceof RevisionConflict) return ctx.json({ ok: false, error: err.message, kind: "revision", current: err.current }, 409);
      throw err;
    }
  }

  return null;
}
