// `/api/panes/migrate-hc?pane=<id>` — « Migrer vers herdr-core » for ANY Claude pane under herdr 0.9:
// an orchestrator, an agent opened by hand, a card's (the card page's own route does the same from the
// card). GET says whether it is offered, POST does it. The operator's gesture only: it closes a terminal.

import { PANE_HEADER, type BoardContext } from "./board-routes.ts";
import { adapterFor, BUILTIN_ADAPTERS } from "./adapters.ts";
import { MIGRATE_BLOCK_FR, migrateBlock, migrateToHc, migrationIdentity } from "./migrate-hc.ts";
import { Hc } from "./mux/hc.ts";
import { hcSocketPath } from "./config.ts";
import { isLeadPane } from "./run.ts";

export const MIGRATE_HC_ROUTE = "/api/panes/migrate-hc";

export async function handleMigrateHcRoute(pathname: string, req: Request, ctx: BoardContext): Promise<Response | null> {
  if (pathname !== MIGRATE_HC_ROUTE) return null;
  const get = req.method === "GET";
  if (!get && req.method !== "POST") return ctx.text("method not allowed", 405);
  if (!get && req.headers.get(PANE_HEADER)?.trim()) return ctx.text("migrating a pane is the operator's gesture — an agent pane may not", 403);
  const denied = ctx.guard(get ? "read" : "write");
  if (denied) return denied;
  const paneId = new URL(req.url).searchParams.get("pane") ?? "";
  const snap = ctx.engine.current();
  const pane = snap.bridge === "disconnected" ? undefined : snap.agents.find((a) => a.paneId === paneId);
  // The lead and the copilot are found again by the pane id the bridge holds: moved, they would be lost to it.
  const boardPane = isLeadPane(paneId) || paneId === ctx.copilot.paneId;
  const hc = ctx.hc ?? new Hc(hcSocketPath(), ctx.cfg.dialMode);
  // The hc probe only once the cheap reasons have passed: a socket dial per pane view otherwise.
  const pre = boardPane ? "board-pane" : migrateBlock({ pane, adapter: pane && adapterFor(ctx.adapters ?? BUILTIN_ADAPTERS, pane.agent), hcUp: true });
  const block = pre ?? ((await hc.ping()) ? null : "hc-down");
  if (get) return ctx.json({ available: block === null, ...(block ? { reason: block } : {}) });
  if (block) return ctx.json({ ok: false, error: MIGRATE_BLOCK_FR[block], kind: block }, 409);

  const session = ctx.db.openSessionByPane(paneId);
  const card = session ? ctx.db.getCard(session.cardId) : null;
  const result = await migrateToHc({ db: ctx.db, herdr: ctx.herdr, hc, ...(session ? { sessionId: session.id } : {}), pane: pane!, ...migrationIdentity(pane!, card) });
  ctx.audit.record({
    action: "pane.migrate-hc",
    paneId,
    session: ctx.session,
    device: ctx.device,
    detail: { ok: result.ok, ...(card ? { cardId: card.id } : {}), ...(result.ok ? { to: result.paneId } : { kind: result.kind, error: result.message }) },
  });
  if (!result.ok) return ctx.json({ ok: false, error: result.message, kind: result.kind }, 502);
  return ctx.json({ ok: true, paneId: result.paneId });
}
