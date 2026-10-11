// `/api/flows` — flows (ADR 0032): list, create, edit, delete, reset; and `/api/repos/flow`, a repo's
// default flow. NOTHING HERE STARTS ANYTHING: a flow only says which roles a card goes through, and a
// run (or the operator's tap) is what walks them.

import { PANE_HEADER, type BoardContext } from "./board-routes.ts";
import { parseFlowBody } from "./flows.ts";

const FLOWS_ROUTE = "/api/flows";
const REPO_FLOW_ROUTE = "/api/repos/flow";
const ONE = /^\/api\/flows\/([^/]+?)(?:\/(reset))?$/;

async function bodyOf(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const v: unknown = await req.json();
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function handleFlowRoute(pathname: string, req: Request, ctx: BoardContext): Promise<Response | null> {
  const isRepo = pathname === REPO_FLOW_ROUTE;
  if (!isRepo && pathname !== FLOWS_ROUTE && !pathname.startsWith(`${FLOWS_ROUTE}/`)) return null;
  const { db } = ctx;
  const pane = req.headers.get(PANE_HEADER)?.trim();
  const audit = (action: string, detail: Record<string, unknown>) =>
    ctx.audit.record({ action, session: ctx.session, device: ctx.device, detail: { ...detail, ...(pane ? { pane } : {}) } });
  const known = (id: string) => db.getTemplate(id) !== null;

  if (isRepo) {
    if (req.method !== "POST") return ctx.text("method not allowed", 405);
    const denied = ctx.guard("write");
    if (denied) return denied;
    const b = await bodyOf(req);
    if (!b) return ctx.text("bad body", 400);
    if (typeof b.path !== "string" || b.path.trim() === "") return ctx.text("path required", 400);
    if (b.flowId !== null && (typeof b.flowId !== "string" || !db.getFlow(b.flowId))) return ctx.text("flowId: no such flow", 400);
    db.setRepoFlow(b.path.trim(), b.flowId as string | null);
    audit("repo.flow", { path: b.path.trim(), flowId: b.flowId });
    return ctx.json({ ok: true });
  }

  if (pathname === FLOWS_ROUTE) {
    if (req.method === "GET") {
      const denied = ctx.guard("read");
      if (denied) return denied;
      return ctx.json({ flows: db.listFlows() });
    }
    if (req.method !== "POST") return ctx.text("method not allowed", 405);
    const denied = ctx.guard("write");
    if (denied) return denied;
    const b = await bodyOf(req);
    if (!b) return ctx.text("bad body", 400);
    const parsed = parseFlowBody(b, true, known);
    if (!parsed.ok) return ctx.text(parsed.error, 400);
    const flow = db.createFlow({ ...parsed.value, name: parsed.value.name!, steps: parsed.value.steps! });
    audit("flow.create", { flowId: flow.id, name: flow.name });
    return ctx.json({ flow }, 201);
  }

  const m = ONE.exec(pathname);
  if (!m) return ctx.text("not found", 404);
  const id = decodeURIComponent(m[1]!);

  if (m[2] === "reset") {
    if (req.method !== "POST") return ctx.text("method not allowed", 405);
    const denied = ctx.guard("write");
    if (denied) return denied;
    if (!db.getFlow(id)) return ctx.text("flow not found", 404);
    const reset = db.resetFlow(id);
    if (!reset) return ctx.text("only a shipped flow can be reset", 409);
    audit("flow.reset", { flowId: id, key: reset.key });
    return ctx.json({ flow: reset });
  }
  if (req.method === "PATCH") {
    const denied = ctx.guard("write");
    if (denied) return denied;
    const b = await bodyOf(req);
    if (!b) return ctx.text("bad body", 400);
    const parsed = parseFlowBody(b, false, known);
    if (!parsed.ok) return ctx.text(parsed.error, 400);
    const flow = db.updateFlow(id, parsed.value);
    if (!flow) return ctx.text("flow not found", 404);
    audit("flow.update", { flowId: id });
    return ctx.json({ flow });
  }
  if (req.method === "DELETE") {
    const denied = ctx.guard("write");
    if (denied) return denied;
    const r = db.deleteFlow(id);
    if (r === "missing") return ctx.text("flow not found", 404);
    if (r === "builtin") return ctx.text("a shipped flow is reset, not deleted", 409);
    audit("flow.delete", { flowId: id });
    return ctx.json({ ok: true });
  }
  return ctx.text("method not allowed", 405);
}
