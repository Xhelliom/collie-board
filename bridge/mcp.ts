// Collie Board as an MCP server (ADR 0039): stdio, launched by the client on the bridge's machine,
// a thin translator over the bridge's own loopback HTTP API — no second path to the database, and
// every guard of the API (launch, phase validation, x-collie-pane, device gate) applies unchanged.
// Hand-rolled JSON-RPC (initialize / tools/list / tools/call): three methods, no dependency. The tools
// themselves are the catalog the orchestrator's buttons share (web/src/lib/board-tools.ts, ADR 0042).
//
// Run: `bun run bridge/mcp.ts`. Env: COLLIE_BOARD_URL | COLLIE_BOARD_PORT, COLLIE_BOARD_DEVICE_HEADER
// + COLLIE_BOARD_DEVICE, HERDR_PANE_ID or hc's HC_TERMINAL_ID (relayed as x-collie-pane: an agent stays an agent).

import { readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

import { boardApi, clip, createTools, oneLine, Refusal, refusal, type BoardTool, type Json } from "../web/src/lib/board-tools.ts";
import { MAX_DELIVERABLE_BYTES } from "./deliverables.ts";

export interface McpEnv {
  COLLIE_BOARD_URL?: string;
  COLLIE_BOARD_PORT?: string;
  COLLIE_BOARD_DEVICE_HEADER?: string;
  COLLIE_BOARD_DEVICE?: string;
  HERDR_PANE_ID?: string;
  /** herdr-core's pane id (ADR 0052): hc exports no HERDR_PANE_ID. */
  HC_TERMINAL_ID?: string;
}

interface Req { jsonrpc: "2.0"; id?: number | string; method: string; params?: Json }
type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type Out = { content: Content[]; isError?: boolean };
/** A tool only this server has: it reads the agent's disk, answers more than text, or reads another project's docs — never in the browser's catalog. */
type McpTool = BoardTool & { content?: (a: Json) => Promise<Content[]> };

const TEXT_EXT = new Set([".md", ".markdown", ".txt", ".csv", ".tsv", ".json", ".log", ".html", ".htm", ".yaml", ".yml"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
/** Past this an image comes back as metadata: a client refuses a picture this big anyway. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function createMcp(env: McpEnv, fetchFn: typeof fetch = fetch) {
  const base = (env.COLLIE_BOARD_URL || `http://127.0.0.1:${env.COLLIE_BOARD_PORT || 8788}`).replace(/\/+$/, "");
  const pane = env.HERDR_PANE_ID?.trim() || env.HC_TERMINAL_ID?.trim();
  const dev = env.COLLIE_BOARD_DEVICE_HEADER?.trim();
  const headers: Record<string, string> = {};
  // A convention, not an authentication (ADR 0039): it is what keeps an agent that plugged this server in an agent.
  if (pane) headers["x-collie-pane"] = pane;
  if (dev && env.COLLIE_BOARD_DEVICE) headers[dev] = env.COLLIE_BOARD_DEVICE;
  const api = boardApi(fetchFn, base, headers);
  const all: McpTool[] = [...createTools(api), ...fileTools()];

  // ponytail: notify needs a pane (the bridge refuses otherwise), so a paneless client never sees it.
  const tools = all.filter((t) => t.name !== "notify" || pane);

  /** A request whose body or answer is bytes, not JSON — the one thing boardApi does not do. */
  async function raw(method: string, path: string, body?: Blob): Promise<Response> {
    let res: Response;
    try {
      res = await fetchFn(`${base}${path}`, { method, headers, body });
    } catch {
      throw new Refusal("Le board est injoignable : le service collie-board est-il démarré ?");
    }
    if (!res.ok) throw refusal(res.status, `${method} ${path.split("?")[0]}`, await res.text());
    return res;
  }

  function fileTools(): McpTool[] {
    const dl = (cardId: string, name?: string) => `/api/cards/${encodeURIComponent(cardId)}/deliverables${name ? `/${encodeURIComponent(name)}` : ""}`;
    return [
      {
        name: "publish_file", readOnly: false, destructive: false, button: false,
        description: "Publie un fichier de ton disque comme livrable d'une carte (image, GIF/WebP/MP4 exporté, capture, rapport, tableur) : l'opérateur le voit sur la carte, et il survit au worktree. Sans cardId : la carte de ton pane. 25 Mo max, pas de SVG (publie un PNG).",
        props: { path: { type: "string", description: "Chemin du fichier, absolu ou relatif à ton répertoire" }, cardId: { type: "string", description: "Défaut : la carte liée à ton pane" }, name: { type: "string", description: "Défaut : le nom du fichier" } },
        required: ["path"],
        run: async (a) => {
          const file = resolve(String(a.path));
          let cardId = a.cardId as string | undefined;
          if (!cardId) {
            if (!pane) throw new Refusal("Pas de HERDR_PANE_ID : donne le cardId.");
            const { agents = [] } = await api("GET", "/api/snapshot");
            cardId = agents.find((x: Json) => x.paneId === pane)?.cardId;
            if (!cardId) throw new Refusal("Ton pane n'est lié à aucune carte : donne le cardId.");
          }
          const size = await stat(file).then((s) => (s.isFile() ? s.size : -1), () => -1);
          if (size < 0) throw new Refusal(`Fichier introuvable : ${file}.`);
          if (size > MAX_DELIVERABLE_BYTES) throw new Refusal("Fichier trop gros : 25 Mo au plus.");
          const name = String(a.name || basename(file));
          const res = await (await raw("POST", `${dl(cardId)}?name=${encodeURIComponent(name)}`, new Blob([await readFile(file)]))).json();
          return `Livrable publié sur la carte ${cardId} : ${res.name} (${res.mime}, ${Math.max(1, Math.round(res.size / 1024))} Ko).`;
        },
      },
      {
        name: "read_project_docs", readOnly: true, button: false,
        description: "Lit la doc d'un projet connu du board (voir list_projects), telle qu'elle est sur sa branche par défaut, en lecture seule. Sans path : la liste des documents par rubrique, puis les décisions. Avec path : le texte de ce fichier. Un dépôt inconnu du board est refusé.",
        props: {
          repoPath: { type: "string", description: "Chemin absolu du dépôt (voir list_projects)" },
          path: { type: "string", description: "Fichier .md relatif au dépôt, tel que listé ; absent : la liste" },
        },
        required: ["repoPath"],
        run: async (a) => {
          const repo = `repo=${encodeURIComponent(String(a.repoPath))}`;
          if (a.path) {
            const f = await api("GET", `/api/docs/file?${repo}&path=${encodeURIComponent(String(a.path))}`);
            return clip(String(f.text ?? ""), 100_000) + (f.truncated ? "\n\n[tronqué : fichier trop long]" : "");
          }
          const ix = await api("GET", `/api/docs?${repo}`);
          const list = (docs: Json[]) => docs.map((d) => `- ${d.path} — ${oneLine(d.title, 100)}`);
          const lines = [`Documents sur ${ix.ref} :`];
          for (const r of [...(ix.rubrics ?? []), { label: "Autres", docs: ix.other ?? [] }]) if (r.docs.length) lines.push(`\n## ${r.label}`, ...list(r.docs));
          if (ix.decisions?.length) {
            lines.push("\n## Décisions");
            for (const d of ix.decisions) lines.push(d.kind === "adr" ? `- ${d.path} — ${oneLine(d.title, 100)}${d.status ? ` (${oneLine(d.status, 30)})` : ""}` : `- roadmap : ${oneLine(d.text, 120)} (${d.status})`);
          }
          return lines.length > 1 ? lines.join("\n") : `Aucun Markdown sur ${ix.ref}.`;
        },
      },
      {
        name: "read_deliverable", readOnly: true, button: false,
        description: "Lit un livrable d'une carte (voir list_deliverables) : texte et Markdown en texte, image en image, le reste en métadonnées.",
        props: { cardId: { type: "string" }, name: { type: "string" } }, required: ["cardId", "name"],
        run: async () => "",
        content: async (a) => {
          const name = String(a.name);
          const ext = extname(name).toLowerCase();
          const meta = async (why = "") => {
            const d = ((await api("GET", dl(a.cardId))).deliverables ?? []).find((x: Json) => x.name === name);
            if (!d) throw new Refusal(`Introuvable : ${name} sur cette carte.`);
            return [{ type: "text" as const, text: `${d.name} — ${d.mime}, ${Math.max(1, Math.round(d.size / 1024))} Ko, publié ${new Date(d.publishedAt).toISOString()}${d.by ? ` par ${d.by === "agent" ? "un agent" : "l'opérateur"}` : ""}${why}` }];
          };
          if (TEXT_EXT.has(ext)) return [{ type: "text", text: clip(await (await raw("GET", dl(a.cardId, name))).text(), 100_000) }];
          if (!IMAGE_EXT.has(ext)) return meta(". Contenu non lisible ici.");
          const res = await raw("GET", dl(a.cardId, name));
          const bytes = new Uint8Array(await res.arrayBuffer());
          if (bytes.byteLength > MAX_IMAGE_BYTES) return meta(". Image trop lourde pour être montrée ici.");
          return [{ type: "image", data: Buffer.from(bytes).toString("base64"), mimeType: res.headers.get("content-type") ?? "image/png" }];
        },
      },
    ];
  }

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
        const args = req.params?.arguments ?? {};
        const out: Out = await (t.content ? t.content(args) : t.run(args).then((text): Content[] => [{ type: "text", text }])).then(
          (content) => ({ content }),
          (e) => ({ content: [{ type: "text", text: e instanceof Refusal ? e.message : `Erreur : ${oneLine(e?.message)}` }], isError: true }),
        );
        return reply({ content: out.content, ...(out.isError ? { isError: true } : {}) });
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
