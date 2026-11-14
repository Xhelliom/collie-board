// `POST /api/update/repair` — « Faire réparer par un agent » under a failed update in Settings: an
// agent in THIS machine's plugin checkout, briefed with the failure the bridge kept whole. A peer's
// Settings are served by the peer's own bridge (never proxied), so the tap already lands there.
// The operator's gesture only: an agent pane may not start agents on his quota.

import { PANE_HEADER, type BoardContext } from "./board-routes.ts";
import { agentNameFor, launchAgent, promptAndConfirm, trustFolder } from "./cards.ts";
import { boardTab } from "./mux/mux.ts";
import { lastUpdateFailure, PLUGIN_CHECKOUT, type UpdateFailure } from "./rollback.ts";

export const UPDATE_REPAIR_ROUTE = "/api/update/repair";

/** What the agent is told. Pure. */
export function repairBrief(f: UpdateFailure, checkout: string): string {
  return [
    `La mise à jour de Collie Board a échoué sur cette machine. Tu es dans le checkout du plugin que sert le service : ${checkout}`,
    `Commande qui a échoué : ${f.command}`,
    "Sortie complète :",
    "```",
    f.output,
    "```",
    "Refais la mise à jour avec `bun scripts/ctl.ts update`, diagnostique et contourne. Ne pousse rien sur le dépôt.",
    "Si c'est un bug de Collie, dis-le et propose une carte (titre + description) sans la créer.",
  ].join("\n");
}

export async function handleUpdateRepairRoute(
  pathname: string,
  req: Request,
  ctx: BoardContext,
  deps: { failure: () => UpdateFailure | null; checkout: string } = { failure: lastUpdateFailure, checkout: PLUGIN_CHECKOUT },
): Promise<Response | null> {
  if (pathname !== UPDATE_REPAIR_ROUTE) return null;
  if (req.method !== "POST") return ctx.text("method not allowed", 405);
  if (req.headers.get(PANE_HEADER)?.trim()) return ctx.text("repairing the update is the operator's gesture — an agent pane may not", 403);
  const denied = ctx.guard("write");
  if (denied) return denied;
  const failure = deps.failure();
  if (!failure) return ctx.text("no failed update to repair since the bridge started", 409);

  const kind = ctx.cfg.boardAgentKind;
  const id = Date.now().toString(36);
  try {
    const created = await ctx.herdr.createWorkspace({ cwd: deps.checkout, label: "update-repair", show: boardTab(`update-repair-${id}`, deps.checkout, kind) });
    ctx.audit.record({ action: "update.repair", paneId: created.paneId, session: ctx.session, device: ctx.device, detail: { checkout: deps.checkout, command: failure.command } });
    if (kind === "claude") trustFolder(deps.checkout);
    await launchAgent(ctx.herdr, created.paneId, kind, agentNameFor(`${kind}-update-repair-${id}`));
    await promptAndConfirm(ctx.herdr, created.paneId, repairBrief(failure, deps.checkout), undefined, { firstAfterLaunch: true });
    return ctx.json({ ok: true, pane: { paneId: created.paneId } });
  } catch (err) {
    return ctx.json({ ok: false, error: (err as Error).message, kind: "herdr" }, 502);
  }
}
