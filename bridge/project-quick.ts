// The sidebar's quick access (desktop, every screen): the projects with a lot in flight, then those
// whose lot finished lately, and the cards the orchestrator waits on the operator about. One read,
// derived on every call from the board itself — the root loader carries no card, so this is the one
// request the sidebar makes, riding the root poll (no loop of its own).

import type { BoardContext } from "./board-routes.ts";
import type { Decision } from "./db.ts";
import { awaitingOn } from "./roadmap.ts";

/** How long a finished lot keeps its project in the list. */
const RECENT = 7 * 24 * 3600 * 1000;

export interface QuickProject {
  repoPath: string;
  lot: { id: string; name: string | null; done: number; total: number; blocked: boolean; finished: boolean };
  /** When it last moved: the order inside each half of the list. */
  ts: number;
}

export interface QuickAccess {
  projects: QuickProject[];
  waiting: { cardId: string; title: string; repoPath: string; text: string }[];
}

type QuickDb = Pick<BoardContext["db"], "listRuns" | "runMembers" | "runFinished" | "listCards" | "getRoadmap" | "getPhase">;

export function quickAccess(db: QuickDb, now = Date.now()): QuickAccess {
  const best = new Map<string, QuickProject>();
  for (const run of db.listRuns()) {
    if (run.launchedAt === null) continue;
    const members = db.runMembers(run.id);
    if (members.length === 0) continue;
    const finished = db.runFinished(run.id);
    // ponytail: a finished lot's time is its members' last move, not the `run.finished` event's — read the event if that ever misleads.
    const ts = Math.max(run.launchedAt, ...members.map((c) => c.updatedAt));
    if (finished && now - ts > RECENT) continue;
    const row: QuickProject = {
      repoPath: run.repoPath,
      lot: {
        id: run.id,
        name: run.name ?? (run.phaseId ? (db.getPhase(run.phaseId)?.name ?? null) : null),
        done: members.filter((c) => c.status === "done" || c.status === "archived").length,
        total: members.length,
        blocked: members.some((c) => c.status === "blocked"),
        finished,
      },
      ts,
    };
    // One row per project: its running lot over a finished one, then the newest.
    const prev = best.get(run.repoPath);
    if (!prev || Number(prev.lot.finished) - Number(finished) > 0 || (prev.lot.finished === finished && ts > prev.ts))
      best.set(run.repoPath, row);
  }
  const projects = [...best.values()].sort((a, b) => Number(a.lot.finished) - Number(b.lot.finished) || b.ts - a.ts);

  const decisions = new Map<string, Decision[] | undefined>();
  const waiting: QuickAccess["waiting"] = [];
  for (const c of db.listCards()) {
    if (!c.repoPath || c.status === "done" || c.status === "archived") continue;
    if (!decisions.has(c.repoPath)) decisions.set(c.repoPath, db.getRoadmap(c.repoPath)?.decisions);
    const wait = awaitingOn(decisions.get(c.repoPath), c.id);
    if (wait) waiting.push({ cardId: c.id, title: c.title, repoPath: c.repoPath, text: wait.text });
  }
  return { projects, waiting };
}

/** `GET /api/project/quick` — the sidebar's quick access. Read-only, a conditional GET like the facts. */
export function handleQuickRoute(pathname: string, req: Request, ctx: BoardContext): Response | null {
  if (pathname !== "/api/project/quick") return null;
  if (req.method !== "GET") return ctx.text("method not allowed", 405);
  const denied = ctx.guard("read");
  if (denied) return denied;
  return ctx.json(quickAccess(ctx.db));
}
