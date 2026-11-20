// The board's own agents (lead, copilot): the operator's restart. Closing the pane is the whole
// gesture — the next request relaunches a fresh agent through ensurePane, on its current model.
import type { BoardContext } from "./board-routes.ts";
import type { Copilot } from "./copilot.ts";
import { boardLead } from "./run.ts";

export const BOARD_AGENTS_RESTART_ROUTE = "/api/board/agents/restart";

/** Pure, for the test: which agent a role names. */
export function agentFor(role: unknown, lead: Copilot | null, copilot: Copilot): Copilot | null {
  return role === "lead" ? lead : role === "copilot" ? copilot : null;
}

export async function handleBoardAgentsRoute(pathname: string, req: Request, ctx: BoardContext): Promise<Response | null> {
  if (pathname !== BOARD_AGENTS_RESTART_ROUTE) return null;
  if (req.method !== "POST") return ctx.text("method not allowed", 405);
  if (req.headers.get("x-collie-pane")?.trim()) return ctx.text("restarting the board's own agents is the operator's gesture — refused to an agent pane", 403);
  const denied = ctx.guard("write");
  if (denied) return denied;
  const { role } = ((await req.json().catch(() => null)) ?? {}) as { role?: unknown };
  const agent = agentFor(role, boardLead(), ctx.copilot.agent);
  if (!agent) return ctx.text("role must be lead or copilot", 400);
  const paneId = agent.paneId;
  const closed = await agent.restart().catch((err: Error) => err);
  if (closed instanceof Error) return ctx.text(`herdr refused to close the pane: ${closed.message}`, 502);
  if (!closed) return ctx.text(`the ${role} has no pane to restart — it starts at its next request`, 409);
  ctx.audit.record({ action: "pane.close", paneId: paneId ?? undefined, session: ctx.session, device: ctx.device, detail: { restart: role } });
  return ctx.json({ ok: true });
}
