// Phases, lots and the roadmap — ADR 0021. The routes a planner uses (the project panel's
// orchestrator, or any session with the collie-board skill) to PREPARE a project. Nothing here
// launches: `POST /api/runs/:id/launch` is the operator's gesture, and it refuses a caller that
// identifies itself as an agent pane (ADR 0010's header), as does the old unplanned `POST /api/runs`.

import { basename } from "node:path";

import { doneOutsideLot, isIntegration, isMaxParallel, PHASE_NOTE_MAX, RevisionConflict } from "./db.ts";
import type { BoardContext } from "./board-routes.ts";
import { goalLaunchRefusal, idleRefusal } from "./autonomy.ts";
import { weekPercent } from "./goal-routes.ts";
import { usageTracker } from "./usage.ts";
import { lotView } from "./lot.ts";
import { resumeRun } from "./run.ts";
import { autoResumeRefusal } from "./resume.ts";
import { assignedElsewhere, lotOwnerRefusal } from "./claim.ts";
import { parseDecision, parseRoadmapBody, roadmapMarkdown, stepsMarkdown } from "./roadmap.ts";
import { repoPathOf, samePath } from "./paths.ts";

const MAX_NAME = 200;
const MAX_GOAL = 2_000;

const PHASES = "/api/phases";
const PHASE = /^\/api\/phases\/([^/]+)$/;
const PHASES_SEAL = "/api/phases/seal";
const PHASE_CLOSE = /^\/api\/phases\/([^/]+)\/(close|reopen)$/;
const RUNS = "/api/runs";
const RUN = /^\/api\/runs\/([^/]+)(?:\/(launch|resume))?$/;
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
/** An optional `?repo=` filter, in the spelling the rows are stored under (`repoPathOf`); passed as-is when not absolute. */
const repoQuery = (req: Request): string | undefined => {
  const q = new URL(req.url).searchParams.get("repo");
  return q === null ? undefined : (repoPathOf(q) ?? q);
};

/** A run with the ids of its cards — what a planner needs to read a lot. */

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
      return ctx.json({ phases: db.listPhases(repoQuery(req)) });
    }
    if (req.method !== "POST") return ctx.text("method not allowed", 405);
    const denied = guard("write");
    if (denied) return denied;
    const b = await bodyOf(req);
    if (!b) return ctx.text("bad body", 400);
    const repoPath = repoPathOf(b.repoPath);
    if (!repoPath) return ctx.text("repoPath must be an absolute path", 400);
    const n = name(b.name);
    if (!n) return ctx.text("name required", 400);
    const g = b.goal === undefined ? "" : goal(b.goal);
    if (g === null) return ctx.text("bad goal", 400);
    if (b.position !== undefined && num(b.position) === null) return ctx.text("bad position", 400);
    if (b.roadmapItemId !== undefined && b.roadmapItemId !== null && typeof b.roadmapItemId !== "string") return ctx.text("bad roadmapItemId", 400);
    if (b.templateId !== undefined && b.templateId !== null && (typeof b.templateId !== "string" || !db.getTemplate(b.templateId))) return ctx.text("templateId: no such template", 400);
    const phase = db.createPhase({
      templateId: (b.templateId as string | null | undefined) ?? null,
      repoPath,
      name: n,
      goal: g,
      position: b.position === undefined ? undefined : (b.position as number),
      roadmapItemId: (b.roadmapItemId as string | null | undefined) ?? null,
    });
    audit("phase.create", { phaseId: phase.id, name: n });
    return ctx.json({ phase }, 201);
  }

  // ── milestones (ADR 0025) ──────────────────────────────────────────────────
  // Validating a phase is the operator's judgement that a stretch of work is done — the same kind of
  // gesture as launching a lot, so a caller that names itself an agent pane is refused, always.
  const milestone = pathname === PHASES_SEAL ? "seal" : PHASE_CLOSE.exec(pathname)?.[2];
  if (milestone) {
    if (req.method !== "POST") return ctx.text("method not allowed", 405);
    const denied = guard("write");
    if (denied) return denied;
    if (pane) return ctx.text("validating a phase is the operator's gesture — an agent pane may propose it, not do it", 403);
    const b = (await bodyOf(req)) ?? {};
    if (b.note !== undefined && (typeof b.note !== "string" || b.note.length > PHASE_NOTE_MAX)) return ctx.text(`note must be a string of at most ${PHASE_NOTE_MAX} characters`, 400);
    const note = typeof b.note === "string" ? b.note.trim() : "";
    // Where the open work goes: another phase of the same repo that is still open, or nowhere (null).
    const target = (repoPath: string, selfId: string | null): { ok: true; id: string | null } | { ok: false; why: string } => {
      const v = b.moveOpenTo ?? null;
      if (v === null) return { ok: true, id: null };
      if (typeof v !== "string") return { ok: false, why: "moveOpenTo must be a phase id or null" };
      const t = db.getPhase(v);
      if (!t || t.repoPath !== repoPath || t.closedAt !== null || v === selfId) return { ok: false, why: "moveOpenTo: no such open phase in this repo" };
      return { ok: true, id: v };
    };

    if (milestone === "seal") {
      const repoPath = repoPathOf(b.repoPath);
      if (!repoPath) return ctx.text("repoPath must be an absolute path", 400);
      const n = name(b.name);
      if (!n) return ctx.text("name required", 400);
      const g = b.goal === undefined ? "" : goal(b.goal);
      if (g === null) return ctx.text("bad goal", 400);
      const to = target(repoPath, null);
      if (!to.ok) return ctx.text(to.why, 400);
      if (b.cardIds !== undefined && (!Array.isArray(b.cardIds) || b.cardIds.length > 1000 || !b.cardIds.every((c) => typeof c === "string")))
        return ctx.text("cardIds must be a list of card ids", 400);
      const sealed = db.sealPhase({ repoPath, name: n, goal: g, note, moveOpenTo: to.id, cardIds: b.cardIds as string[] | undefined });
      if (!sealed.phase) return ctx.text("no finished card without a phase to file", 400);
      audit("phase.seal", { phaseId: sealed.phase.id, name: n, moved: sealed.moved });
      // Journaled for the orchestrator nudger (ADR 0028): the gesture is the operator's (agent panes are refused above).
      db.recordEvent(null, "phase.sealed", { phaseId: sealed.phase.id, moveOpenTo: to.id, moved: sealed.moved });
      return ctx.json({ phase: sealed.phase, moved: sealed.moved }, 201);
    }

    const id = PHASE_CLOSE.exec(pathname)![1]!;
    const phase = db.getPhase(id);
    if (!phase) return ctx.text("phase not found", 404);
    if (milestone === "reopen") {
      if (phase.closedAt === null) return ctx.text("phase is not validated", 409);
      audit("phase.reopen", { phaseId: id });
      const reopened = db.reopenPhase(id);
      db.recordEvent(null, "phase.reopened", { phaseId: id });
      return ctx.json({ phase: reopened });
    }
    if (phase.closedAt !== null) return ctx.text("phase is already validated", 409);
    const to = target(phase.repoPath, id);
    if (!to.ok) return ctx.text(to.why, 400);
    if (db.phaseHasUnfinishedLot(id)) return ctx.text("the phase has a lot that is not over — finish or delete it first", 409);
    const closed = db.closePhase(id, { moveOpenTo: to.id, note });
    audit("phase.close", { phaseId: id, moveOpenTo: to.id });
    db.recordEvent(null, "phase.closed", { phaseId: id, moveOpenTo: to.id });
    return ctx.json({ phase: closed });
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
      if ("templateId" in b) {
        if (b.templateId !== null && (typeof b.templateId !== "string" || !db.getTemplate(b.templateId))) return ctx.text("templateId: no such template", 400);
        patch.templateId = b.templateId as string | null;
      }
      if ("pipelineId" in b) {
        if (b.pipelineId !== null && (typeof b.pipelineId !== "string" || !db.getFlow(b.pipelineId))) return ctx.text("pipelineId: no such flow", 400);
        patch.pipelineId = b.pipelineId as string | null;
      }
      const phase = db.updatePhase(id, patch);
      audit("phase.patch", { phaseId: id, ...patch });
      return ctx.json({ phase });
    }
    if (req.method === "DELETE") {
      const denied = guard("write");
      if (denied) return denied;
      const phase = db.getPhase(id);
      if (!phase) return ctx.text("phase not found", 404);
      // Only an empty phase goes: a real grouping is never dropped by mistake.
      if (!db.phaseIsEmpty(id)) return ctx.text("phase is not empty", 409);
      db.deletePhase(id);
      audit("phase.delete", { phaseId: id, repoPath: phase.repoPath, name: phase.name });
      return ctx.json({ ok: true });
    }
    return ctx.text("method not allowed", 405);
  }

  // ── lots (runs) ────────────────────────────────────────────────────────────
  // POST /api/runs stays in board-routes (it is the old gesture, extended with `planned`).
  if (pathname === RUNS && req.method === "GET") {
    const denied = guard("read");
    if (denied) return denied;
    return ctx.json({ runs: db.listRuns(repoQuery(req)).map((r) => lotView(db, r)) });
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
      const run = db.getRun(id);
      // Unless the operator turned autonomy on for this repo and the end-of-lot wake armed one launch
      // (ADR 0030), or allowed a start when none of its lots is running (ADR 0047).
      const auto = run ? db.autonomyOf(run.repoPath) : null;
      // An objective (ADR 0056) decides before autonomy: active and under budget, it may launch one lot at a
      // time; claimed, nothing launches until the operator answers — armed or not.
      const goalWhy = pane && run ? goalLaunchRefusal(db, run, weekPercent(usageTracker.peek())) : undefined;
      const byGoal = goalWhy === null;
      const idleWhy = pane && run && !auto!.armed && goalWhy === undefined ? idleRefusal(db, run) : undefined;
      const idle = idleWhy === null;
      // An orchestrator refused leaves why in the lot's journal: what stops the chain is measured.
      const refuse = (why: string, body = "launching is the operator's gesture — an agent pane cannot launch a lot") => {
        if (pane && run) db.recordRunEvent(null, "run.chain", { runId: run.id, go: false, why, next: run.id });
        return ctx.text(body, 403);
      };
      if (goalWhy) return refuse(goalWhy, goalWhy);
      if (pane && !byGoal && !(auto?.enabled && (auto.armed || idle))) {
        if (!run) return ctx.text("launching is the operator's gesture — an agent pane cannot launch a lot", 403);
        return refuse(idleWhy ?? "l'autonomie est coupée");
      }
      if (!run) return ctx.text("run not found", 404);
      if (run.launchedAt !== null) return ctx.text("already launched", 409);
      // ADR 0048 §7: another pair's lot is seen here, never launched — and an agent never launches one holding another person's card.
      const notOurs = lotOwnerRefusal(db, run) ?? (pane ? db.runMembers(id).map((c) => assignedElsewhere(db, c)).find(Boolean) : null);
      if (notOurs) return refuse(notOurs, notOurs);
      if (doneOutsideLot(run, db.runMembers(id))) return ctx.text("every card of this lot is already done — it finished outside the lot", 409);
      if (pane && !byGoal && !db.spendAutonomy(run.repoPath, idle)) return refuse("le lancement armé est déjà dépensé");
      if (!db.launchRun(id)) return ctx.text("already launched", 409);
      if (!pane) db.resetChain(run.repoPath);
      audit("run.launch", { runId: id, ...(pane ? { autonomous: true } : {}), ...(idle ? { reason: "idle" } : {}), ...(byGoal ? { reason: "goal" } : {}) });
      return ctx.json({ run: db.getRun(id) });
    }
    if (runMatch[2] === "resume") {
      if (req.method !== "POST") return ctx.text("method not allowed", 405);
      const denied = guard("write");
      if (denied) return denied;
      // A halt hands the card to the operator; taking it back is theirs too — unless autonomy is on and
      // the halt is mechanical, then the repo's orchestrator may, a bounded number of times (ADR 0055).
      const run = db.getRun(id);
      if (pane && !run) return ctx.text("resuming is the operator's gesture — an agent pane cannot resume a lot", 403);
      if (!run) return ctx.text("run not found", 404);
      if (run.launchedAt === null) return ctx.text("a planned lot is launched, not resumed", 409);
      const notOurs = lotOwnerRefusal(db, run);
      if (notOurs) return ctx.text(notOurs, 403);
      const refused = pane ? autoResumeRefusal(db, run, pane, ctx.engine.current()) : null;
      if (refused) return ctx.text(refused, 403);
      const resumed = resumeRun(db, run, !!pane);
      if (!resumed) return ctx.text("nothing halted in this lot", 409);
      audit("run.resume", { runId: id, resumed, ...(pane ? { autonomous: true } : {}) });
      return ctx.json({ resumed });
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
      if ("integration" in b) {
        if (!isIntegration(b.integration)) return ctx.text('integration must be "card" or "lot"', 400);
        patch.integration = b.integration;
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
      return ctx.json({ run: lotView(db, db.getRun(id)!) });
    }
    if (req.method === "DELETE") {
      const denied = guard("write");
      if (denied) return denied;
      const run = db.getRun(id);
      if (!run) return ctx.text("run not found", 404);
      if (!db.deleteLot(id)) return ctx.text("a launched run is not deleted", 409);
      audit("run.delete", { runId: id, repoPath: run.repoPath, name: run.name });
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
    const repoPath = repoPathOf(b.repoPath);
    if (!repoPath) return ctx.text("repoPath must be an absolute path", 400);
    const d = parseDecision(b);
    if (!d.ok) return ctx.text(d.error, 400);
    if (d.value.itemId && !db.getRoadmap(repoPath)?.items.some((i) => i.id === d.value.itemId))
      return ctx.text("itemId: no such roadmap item", 400);
    if (d.value.cardId) {
      const card = db.getCard(d.value.cardId);
      if (!card?.repoPath || !samePath(card.repoPath, repoPath)) return ctx.text("cardId: no such card in this repo", 400);
    }
    try {
      const { roadmap, decision } = db.upsertDecision(repoPath, d.value);
      audit("roadmap.decision", { repoPath, id: decision.id, status: decision.status, ...(decision.cardId ? { cardId: decision.cardId } : {}) });
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
      const repo = repoPathOf(q.get("repo"));
      if (!repo) return ctx.text("repo must be an absolute path", 400);
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
                cards: db.listCards().filter((c) => !!c.repoPath && samePath(c.repoPath, repo)),
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
