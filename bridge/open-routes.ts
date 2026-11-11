// `POST /api/project/open` — a terminal, or an agent, in a repo's folder and outside any card: what
// the Spaces tab offered under herdr 0.9, kept on the Project page now that hc has no spaces (ADR 0052).
// The operator's gesture only: an agent pane starting agents would spend his quota on its own.

import { basename } from "node:path";

import { PANE_HEADER, type BoardContext } from "./board-routes.ts";
import { agentNameFor, launchAgent, promptAndConfirm, trustFolder } from "./cards.ts";
import { boardTab } from "./mux/mux.ts";
import { repoRootOf } from "./orchestrator-routes.ts";
import { isKind, modelArgs } from "./templates.ts";

export const OPEN_ROUTE = "/api/project/open";

/** The label a pane opened here carries (`free-<repo>`): how the herd tells it from an agent's helper terminal. */
export const FREE_PREFIX = "free-";

export async function handleOpenRoute(pathname: string, req: Request, ctx: BoardContext): Promise<Response | null> {
  if (pathname !== OPEN_ROUTE) return null;
  if (req.method !== "POST") return ctx.text("method not allowed", 405);
  if (req.headers.get(PANE_HEADER)?.trim()) return ctx.text("opening a pane is the operator's gesture — an agent pane may not", 403);
  const denied = ctx.guard("write");
  if (denied) return denied;
  let b: { repoPath?: unknown; open?: unknown; agentKind?: unknown; templateId?: unknown } | null;
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return ctx.text("bad body", 400);
  }
  const repoPath = repoRootOf(b?.repoPath);
  if (!b || !repoPath) return ctx.text("repoPath must be the root of a repository", 400);
  if (b.open !== "agent" && b.open !== "terminal") return ctx.text('open must be "agent" or "terminal"', 400);
  if (b.agentKind != null && !isKind(b.agentKind)) return ctx.text("agentKind: not an agent kind", 400);
  const template = typeof b.templateId === "string" ? ctx.db.getTemplate(b.templateId) : null;
  if (b.templateId != null && !template) return ctx.text("templateId: no such template", 400);

  const agent = b.open === "agent";
  const kind = (b.agentKind as string | null | undefined) ?? template?.agentKind ?? ctx.cfg.boardAgentKind;
  const repo = basename(repoPath);
  const id = Date.now().toString(36);
  const what = agent ? kind : "terminal";
  try {
    const created = await ctx.herdr.createWorkspace({ cwd: repoPath, label: `${FREE_PREFIX}${repo}`, show: boardTab(`free-${id}`, repoPath, what) });
    ctx.audit.record({ action: "project.open", paneId: created.paneId, session: ctx.session, device: ctx.device, detail: { repoPath, open: what, ...(template ? { templateId: template.id } : {}) } });
    if (agent) {
      // A failed launch leaves its shell: it is in the herd, where the operator reads why and closes it.
      if (kind === "claude") trustFolder(repoPath);
      await launchAgent(ctx.herdr, created.paneId, kind, agentNameFor(`${kind}-${repo}-${id}`), undefined, modelArgs(kind, template?.model, ctx.adapters));
      if (template?.brief) await promptAndConfirm(ctx.herdr, created.paneId, template.brief, undefined, { firstAfterLaunch: true });
    }
    return ctx.json({
      ok: true,
      pane: { paneId: created.paneId, workspaceId: created.workspaceId, workspaceLabel: created.workspaceLabel ?? created.workspaceId, tabId: created.tabId, cwd: created.cwd },
    });
  } catch (err) {
    return ctx.json({ ok: false, error: (err as Error).message, kind: "herdr" }, 502);
  }
}
