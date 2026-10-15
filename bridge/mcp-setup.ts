// `/api/board/mcp` — how to plug the MCP server (bridge/mcp.ts, ADR 0039) into a client, for the
// Settings screen: the `claude mcp add` line with this install's real path, and the tool list read
// from the server itself so it never drifts. Read-only: it shows a command, it runs none.

import { join } from "node:path";

import type { BoardContext } from "./board-routes.ts";
import { createMcp } from "./mcp.ts";

export interface McpSetup {
  command: string;
  /** Only when the deployment gates writes on a device header: without it, writes answer 403. */
  deviceCommand: string | null;
  tools: { name: string; readOnly: boolean }[];
}

const sh = (s: string) => (/^[\w./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

export async function mcpSetup(dir: string, port: number, deviceHeader: string): Promise<McpSetup> {
  const run = `-- bun run ${sh(join(dir, "mcp.ts"))}`;
  const env = port === 8788 ? "" : ` -e COLLIE_BOARD_PORT=${port}`;
  // Every tool, `notify` included (it only shows to a client launched from a pane). tools/list makes no fetch.
  const list = await createMcp({ HERDR_PANE_ID: "settings" }).handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  return {
    command: `claude mcp add collie-board${env} ${run}`,
    // ponytail: the device id stays a placeholder — the allowlist is not handed to a read-level caller.
    deviceCommand: deviceHeader
      ? `claude mcp add collie-board${env} -e COLLIE_BOARD_DEVICE_HEADER=${sh(deviceHeader)} -e COLLIE_BOARD_DEVICE=my-laptop ${run}`
      : null,
    tools: (list?.result?.tools ?? []).map((t: { name: string; annotations: { readOnlyHint: boolean } }) => ({
      name: t.name,
      readOnly: t.annotations.readOnlyHint,
    })),
  };
}

export async function handleMcpSetupRoute(pathname: string, req: Request, ctx: BoardContext): Promise<Response | null> {
  if (pathname !== "/api/board/mcp") return null;
  if (req.method !== "GET") return ctx.text("method not allowed", 405);
  const denied = ctx.guard("read");
  if (denied) return denied;
  return ctx.json(await mcpSetup(import.meta.dir, ctx.cfg.port, ctx.cfg.deviceHeader));
}
