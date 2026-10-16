// Collie Board as an MCP server (ADR 0039): stdio, launched by the client on the bridge's machine,
// a thin translator over the bridge's own loopback HTTP API — no second path to the database, and
// every guard of the API (launch, phase validation, x-collie-pane, device gate) applies unchanged.
// Hand-rolled JSON-RPC (initialize / tools/list / tools/call): three methods, no dependency. The tools
// themselves are the catalog the orchestrator's buttons share (web/src/lib/board-tools.ts, ADR 0042).
//
// Run: `bun run bridge/mcp.ts`. Env: COLLIE_BOARD_URL | COLLIE_BOARD_PORT, COLLIE_BOARD_DEVICE_HEADER
// + COLLIE_BOARD_DEVICE, HERDR_PANE_ID (relayed as x-collie-pane: an agent stays an agent).

import { boardApi, createTools, oneLine, Refusal, type Json } from "../web/src/lib/board-tools.ts";

export interface McpEnv {
  COLLIE_BOARD_URL?: string;
  COLLIE_BOARD_PORT?: string;
  COLLIE_BOARD_DEVICE_HEADER?: string;
  COLLIE_BOARD_DEVICE?: string;
  HERDR_PANE_ID?: string;
}

interface Req { jsonrpc: "2.0"; id?: number | string; method: string; params?: Json }
type Out = { text: string; isError?: boolean };

export function createMcp(env: McpEnv, fetchFn: typeof fetch = fetch) {
  const base = (env.COLLIE_BOARD_URL || `http://127.0.0.1:${env.COLLIE_BOARD_PORT || 8788}`).replace(/\/+$/, "");
  const pane = env.HERDR_PANE_ID?.trim();
  const dev = env.COLLIE_BOARD_DEVICE_HEADER?.trim();
  const headers: Record<string, string> = {};
  // A convention, not an authentication (ADR 0039): it is what keeps an agent that plugged this server in an agent.
  if (pane) headers["x-collie-pane"] = pane;
  if (dev && env.COLLIE_BOARD_DEVICE) headers[dev] = env.COLLIE_BOARD_DEVICE;
  const all = createTools(boardApi(fetchFn, base, headers));

  // ponytail: notify needs a pane (the bridge refuses otherwise), so a paneless client never sees it.
  const tools = all.filter((t) => t.name !== "notify" || pane);

  async function handle(req: Req): Promise<Json | null> {
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id: req.id, result });
    switch (req.method) {
      case "initialize":
        return reply({ protocolVersion: req.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "collie-board", version: "1" } });
      case "ping": return reply({});
      case "tools/list":
        return reply({ tools: tools.map((t) => ({
          name: t.name, description: t.description,
          inputSchema: { type: "object", properties: t.props, required: t.required ?? [] },
          annotations: { readOnlyHint: t.readOnly, ...(t.readOnly ? {} : { destructiveHint: !!t.destructive }), openWorldHint: false },
        })) });
      case "tools/call": {
        const t = tools.find((x) => x.name === req.params?.name);
        if (!t) return { jsonrpc: "2.0", id: req.id, error: { code: -32602, message: `outil inconnu : ${req.params?.name}` } };
        const out: Out = await t.run(req.params?.arguments ?? {}).then(
          (text) => ({ text }),
          (e) => ({ text: e instanceof Refusal ? e.message : `Erreur : ${oneLine(e?.message)}`, isError: true }),
        );
        return reply({ content: [{ type: "text", text: out.text }], ...(out.isError ? { isError: true } : {}) });
      }
      default:
        // Notifications (no id) get no answer; an unknown request does.
        return req.id === undefined ? null : { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `méthode inconnue : ${req.method}` } };
    }
  }
  return { handle };
}

if (import.meta.main) {
  const mcp = createMcp(process.env as McpEnv);
  const rl = (await import("node:readline")).createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let res: Json | null;
    try { res = await mcp.handle(JSON.parse(line)); } catch { res = { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }; }
    if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
  }
}
