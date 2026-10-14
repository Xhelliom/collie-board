// Collie Board as an MCP server (ADR 0039): stdio, launched by the client on the bridge's machine,
// a thin translator over the bridge's own loopback HTTP API — no second path to the database, and
// every guard of the API (launch, phase validation, x-collie-pane, device gate) applies unchanged.
// Hand-rolled JSON-RPC (initialize / tools/list / tools/call): three methods, no dependency.
//
// Run: `bun run bridge/mcp.ts`. Env: COLLIE_BOARD_URL | COLLIE_BOARD_PORT, COLLIE_BOARD_DEVICE_HEADER
// + COLLIE_BOARD_DEVICE, HERDR_PANE_ID (relayed as x-collie-pane: an agent stays an agent).

export interface McpEnv {
  COLLIE_BOARD_URL?: string;
  COLLIE_BOARD_PORT?: string;
  COLLIE_BOARD_DEVICE_HEADER?: string;
  COLLIE_BOARD_DEVICE?: string;
  HERDR_PANE_ID?: string;
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Req { jsonrpc: "2.0"; id?: number | string; method: string; params?: Json }
type Out = { text: string; isError?: boolean };

/** A bridge answer that is not a success, in one sentence a voice can read. */
class Refusal extends Error {}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const oneLine = (s: unknown, n = 140) => clip(String(s ?? "").replace(/\s+/g, " ").trim(), n);

function refusal(status: number, action: string, body: string): Refusal {
  const why = oneLine(body, 100);
  if (status === 403) {
    return new Refusal(/launch|validat|phase/i.test(`${action} ${body}`) && /launch|operator/i.test(body)
      ? "Le lancement de lot est réservé à l'opérateur : refusé pour un agent."
      : `Action refusée par le board (${why || "droits insuffisants"}).`);
  }
  if (status === 409) return new Refusal(`Conflit : ${why || "l'état de la ressource ne le permet pas"} (déjà fait ou pas le moment).`);
  if (status === 404) return new Refusal(`Introuvable : ${action}.`);
  if (status === 400) return new Refusal(`Requête refusée : ${why}.`);
  return new Refusal(`Le board a répondu ${status} (${why}).`);
}

export function createMcp(env: McpEnv, fetchFn: typeof fetch = fetch) {
  const base = (env.COLLIE_BOARD_URL || `http://127.0.0.1:${env.COLLIE_BOARD_PORT || 8788}`).replace(/\/+$/, "");
  const pane = env.HERDR_PANE_ID?.trim();
  const dev = env.COLLIE_BOARD_DEVICE_HEADER?.trim();

  async function api(method: string, path: string, body?: unknown): Promise<Json> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    // A convention, not an authentication (ADR 0039): it is what keeps an agent that plugged this server in an agent.
    if (pane) headers["x-collie-pane"] = pane;
    if (dev && env.COLLIE_BOARD_DEVICE) headers[dev] = env.COLLIE_BOARD_DEVICE;
    let res: Response;
    try {
      res = await fetchFn(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new Refusal("Le board est injoignable : le service collie-board est-il démarré ?");
    }
    const text = await res.text();
    if (!res.ok) throw refusal(res.status, `${method} ${path.split("?")[0]}`, text);
    try { return text ? JSON.parse(text) : {}; } catch { return {}; }
  }
  const q = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]).toString();
    return p ? `?${p}` : "";
  };
  const id = (s: string) => encodeURIComponent(s);

  const repoOf = (s: string) => s.replace(/\/+$/, "");

  const tools: { name: string; description: string; readOnly: boolean; destructive?: boolean; props: Json; required?: string[]; run: (a: Json) => Promise<string> }[] = [
    {
      name: "list_projects", readOnly: true,
      description: "Liste les projets (dépôts) connus du board, avec leur chemin.",
      props: {},
      run: async () => {
        const { repos = [] } = await api("GET", "/api/repos");
        return repos.map((r: Json) => `${r.name} — ${r.path}`).join("\n") || "Aucun projet.";
      },
    },
    {
      name: "project_status", readOnly: true,
      description: "État d'un projet : phases, lots, cartes en cours, PR ouvertes, cartes bloquées et pourquoi.",
      props: { repoPath: { type: "string", description: "Chemin absolu du dépôt (voir list_projects)" } }, required: ["repoPath"],
      run: async (a) => {
        const repo = repoOf(a.repoPath);
        const [ph, runs, cards, prs, facts] = await Promise.all([
          api("GET", `/api/phases${q({ repo })}`), api("GET", `/api/runs${q({ repo })}`),
          api("GET", `/api/cards${q({ view: "summary" })}`), api("GET", "/api/board/prs"), api("GET", `/api/project/facts${q({ repo })}`),
        ]);
        const mine: Json[] = (cards.cards ?? []).filter((c: Json) => repoOf(c.repoPath ?? "") === repo);
        const factOf = new Map<string, Json>((facts.facts ?? []).map((f: Json) => [f.cardId, f]));
        const lines: string[] = [];
        for (const p of ph.phases ?? []) {
          const lots = (runs.runs ?? []).filter((r: Json) => r.phaseId === p.id)
            .map((r: Json) => `${r.name ?? "lot"} (${r.launchedAt ? "lancé" : "planifié"}, ${r.cardIds?.length ?? 0} cartes)`);
          lines.push(`Phase « ${p.name} » ${p.closedAt ? "validée" : "en cours"}${lots.length ? ` — lots : ${lots.join(", ")}` : ""}`);
        }
        for (const c of mine.filter((c) => ["working", "review", "blocked"].includes(c.status))) {
          const f = factOf.get(c.id);
          const why = c.status === "blocked" ? oneLine(f?.lead?.reason || (f?.gate && !f.gate.ok ? `gate rouge : ${f.gate.command}` : "") || "raison inconnue", 120) : "";
          lines.push(`${c.status === "blocked" ? "BLOQUÉE" : c.status} : ${oneLine(c.title, 80)}${why ? ` — ${why}` : ""}`);
        }
        for (const p of (prs.prs ?? []).filter((p: Json) => repoOf(p.card?.repoPath ?? "") === repo)) lines.push(`PR ouverte : ${oneLine(p.card.title, 80)} — ${p.url}`);
        return lines.join("\n") || "Rien de actif sur ce projet.";
      },
    },
    {
      name: "get_card", readOnly: true,
      description: "Une carte : statut, spec, critères et les derniers événements du journal.",
      props: { cardId: { type: "string" } }, required: ["cardId"],
      run: async (a) => {
        const { card, events = [] } = await api("GET", `/api/cards/${id(a.cardId)}`);
        const out = [`${card.title} — ${card.status}`, `Spec : ${clip(String(card.spec ?? "(vide)"), 800)}`];
        if (card.acceptance?.length) out.push(`Critères : ${card.acceptance.map((x: string) => oneLine(x, 100)).join(" ; ")}`);
        for (const e of events.slice(-8)) out.push(`· ${e.type} ${oneLine(JSON.stringify(e.payload ?? {}), 90)}`);
        return out.join("\n");
      },
    },
    {
      name: "whats_blocking", readOnly: true,
      description: "Ce qui bloque maintenant : les agents qui attendent une réponse, avec la fin de leur sortie.",
      props: {},
      run: async () => {
        const { agents = [] } = await api("GET", "/api/snapshot");
        const waiting: Json[] = agents.filter((x: Json) => x.status === "blocked");
        if (!waiting.length) return "Rien ne bloque : aucun agent n'attend de réponse.";
        const outs = await Promise.all(waiting.map((w) => api("GET", `/api/pane/${id(w.paneId)}`).catch(() => ({ text: "" }))));
        return waiting.map((w, i) => {
          const tail = String(outs[i]!.text ?? "").replace(ANSI, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-6).join(" / ");
          return `${w.paneId} (${w.workspaceLabel ?? w.cwd}) attend : ${clip(tail, 400)}`;
        }).join("\n");
      },
    },
    {
      name: "recent_notifications", readOnly: true,
      description: "Les dernières notifications du board (plus récentes en premier).",
      props: { limit: { type: "number", description: "Défaut 5" } },
      run: async (a) => {
        const { entries = [] } = await api("GET", "/api/notifications/log");
        const n = Math.min(Math.max(Number(a.limit) || 5, 1), 20);
        return [...entries].sort((x: Json, y: Json) => y.id - x.id).slice(0, n)
          .map((e: Json) => `${e.cardTitle ?? e.cwd ?? "?"} — ${e.status}${e.subtitle ? ` : ${oneLine(e.subtitle, 100)}` : ""}`).join("\n") || "Aucune notification.";
      },
    },
    {
      name: "reply_to_agent", readOnly: false, destructive: false,
      description: "Répond à un agent qui attend : tape le texte dans son terminal et valide. À n'utiliser que pour une décision déjà prise par l'opérateur.",
      props: { paneId: { type: "string", description: "Voir whats_blocking" }, text: { type: "string" } }, required: ["paneId", "text"],
      run: async (a) => { await api("POST", `/api/pane/${id(a.paneId)}/reply`, { text: a.text }); return `Réponse envoyée à ${a.paneId}.`; },
    },
    {
      name: "create_card", readOnly: false, destructive: false,
      description: "Crée une carte (backlog) dans un projet ; elle ne démarre pas toute seule.",
      props: { repoPath: { type: "string" }, title: { type: "string" }, spec: { type: "string" }, phaseId: { type: "string", description: "Optionnel" } }, required: ["repoPath", "title"],
      run: async (a) => {
        const body: Json = { repoPath: a.repoPath, title: a.title };
        for (const k of ["spec", "phaseId"]) if (a[k]) body[k] = a[k];
        const { card } = await api("POST", "/api/cards", body);
        return `Carte créée : ${card?.title ?? a.title} (${card?.id}).`;
      },
    },
    {
      name: "launch_lot", readOnly: false, destructive: true,
      description: "Lance un lot planifié : démarre de vrais agents (consomme du quota). Sans runId, lance le prochain lot planifié du projet.",
      props: { runId: { type: "string" }, repoPath: { type: "string", description: "Sans runId : le projet dont lancer le prochain lot" } },
      run: async (a) => {
        let runId: string | undefined = a.runId;
        if (!runId) {
          if (!a.repoPath) throw new Refusal("Il faut un runId ou un repoPath.");
          const { runs = [] } = await api("GET", `/api/runs${q({ repo: repoOf(a.repoPath) })}`);
          const next = runs.filter((r: Json) => r.launchedAt === null).sort((x: Json, y: Json) => x.position - y.position)[0];
          if (!next) throw new Refusal("Aucun lot planifié sur ce projet.");
          runId = next.id as string;
        }
        await api("POST", `/api/runs/${id(runId!)}/launch`, {});
        return `Lot ${runId} lancé.`;
      },
    },
    {
      name: "notify", readOnly: false, destructive: false,
      description: "Envoie une notification à l'opérateur (une ligne). Réservé à un agent du board : le bridge exige un pane.",
      props: { message: { type: "string" } }, required: ["message"],
      run: async (a) => { await api("POST", "/api/board/notify", { message: a.message }); return "Notification envoyée."; },
    },
  ];

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
