import { describe, expect, it } from "bun:test";

import type { BoardContext } from "./board-routes.ts";
import { BOARD_AGENTS_RESTART_ROUTE, handleBoardAgentsRoute } from "./board-agents.ts";
import type { Copilot } from "./copilot.ts";

function ctxWith(agent: { paneId: string | null; restart: () => Promise<boolean> }) {
  const recorded: unknown[] = [];
  const ctx = {
    copilot: { agent },
    session: "s",
    device: null,
    audit: { record: (e: unknown) => recorded.push(e) },
    guard: () => null,
    text: (body: string, status: number) => new Response(body, { status }),
    json: (data: unknown, status = 200) => Response.json(data, { status }),
  } as unknown as BoardContext;
  return { ctx, recorded };
}
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://x${BOARD_AGENTS_RESTART_ROUTE}`, { method: "POST", headers, body: JSON.stringify(body) });

describe("the board agents' restart", () => {
  it("refuses an agent pane, and closes nothing", async () => {
    let closed = 0;
    const { ctx } = ctxWith({ paneId: "p1", restart: async () => (closed++, true) });
    const res = await handleBoardAgentsRoute(BOARD_AGENTS_RESTART_ROUTE, post({ role: "copilot" }, { "x-collie-pane": "w1:p2" }), ctx);
    expect(res!.status).toBe(403);
    expect(closed).toBe(0);
  });

  it("restarts the copilot for the operator, and audits it", async () => {
    const { ctx, recorded } = ctxWith({ paneId: "p1", restart: async () => true });
    const res = await handleBoardAgentsRoute(BOARD_AGENTS_RESTART_ROUTE, post({ role: "copilot" }), ctx);
    expect(res!.status).toBe(200);
    expect(recorded).toHaveLength(1);
  });

  it("says when there is no pane, and rejects an unknown role", async () => {
    const { ctx } = ctxWith({ paneId: null, restart: async () => false });
    expect((await handleBoardAgentsRoute(BOARD_AGENTS_RESTART_ROUTE, post({ role: "copilot" }), ctx))!.status).toBe(409);
    expect((await handleBoardAgentsRoute(BOARD_AGENTS_RESTART_ROUTE, post({ role: "nope" }), ctx))!.status).toBe(400);
  });

  it("leaves other paths alone", async () => {
    const { ctx } = ctxWith({ paneId: null, restart: async () => false });
    expect(await handleBoardAgentsRoute("/api/board/pins", post({}), ctx)).toBeNull();
  });
});

// The Copilot's own restart: the closed pane is not adopted back from a stale snapshot.
describe("Copilot.restart", () => {
  it("closes the pane and forgets it", async () => {
    const { Copilot } = await import("./copilot.ts");
    const closedPanes: string[] = [];
    const herdr = { closePane: async (id: string) => void closedPanes.push(id) };
    const snap = { bridge: "connected", agents: [{ paneId: "p1", cwd: "/w" }], shellPanes: [] };
    const c: Copilot = new Copilot(herdr as never, { boardCopilot: true } as never, "/w", () => snap as never);
    c.observe(snap as never);
    expect(c.paneId).toBe("p1");
    expect(await c.restart()).toBe(true);
    expect(closedPanes).toEqual(["p1"]);
    c.observe(snap as never); // the snapshot has not caught up yet
    expect(c.paneId).toBeNull();
    expect(await c.restart()).toBe(false);
  });
});
