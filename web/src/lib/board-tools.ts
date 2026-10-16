// The board's tools — ONE catalog for two callers (ADR 0042): `bridge/mcp.ts` lists and runs them for
// an MCP client, and the orchestrator's `collie-buttons` (components/action-buttons.tsx) run the very
// same `run` from the browser. Each tool is a thin translator over the bridge's loopback HTTP API, so
// every guard of the API (launch, phase validation, x-collie-pane, device gate) applies unchanged, and
// a tool added here is a button the orchestrator can offer with no other work.
//
// Shared code: no Bun, no DOM beyond `fetch`, and no TS-only syntax (web's erasableSyntaxOnly).

export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type BoardApi = (method: string, path: string, body?: unknown) => Promise<Json>;

/** A bridge answer that is not a success, in one sentence a voice (or a button) can read. */
export class Refusal extends Error {
  body: string;
  constructor(message: string, body = "") {
    super(message);
    this.body = body;
  }
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const oneLine = (s: unknown, n = 140) => clip(String(s ?? "").replace(/\s+/g, " ").trim(), n);

function refusal(status: number, action: string, body: string): Refusal {
  const why = oneLine(body, 100);
  if (status === 403) {
    return new Refusal(/launch|validat|phase/i.test(`${action} ${body}`) && /launch|operator/i.test(body)
      ? "Le lancement de lot est réservé à l'opérateur : refusé pour un agent."
      : `Action refusée par le board (${why || "droits insuffisants"}).`, body);
  }
  if (status === 409) return new Refusal(`Conflit : ${why || "l'état de la ressource ne le permet pas"} (déjà fait ou pas le moment).`, body);
  if (status === 404) return new Refusal(`Introuvable : ${action}.`, body);
  if (status === 400) return new Refusal(`Requête refusée : ${why}.`, body);
  return new Refusal(`Le board a répondu ${status} (${why}).`, body);
}

/** The HTTP side of every tool: `base` "" in the browser (same origin), the loopback URL in mcp.ts. */
export function boardApi(fetchFn: typeof fetch, base: string, headers: Record<string, string> = {}): BoardApi {
  return async (method, path, body) => {
    const h: Record<string, string> = { ...headers };
    if (body !== undefined) h["content-type"] = "application/json";
    let res: Response;
    try {
      res = await fetchFn(`${base}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new Refusal("Le board est injoignable : le service collie-board est-il démarré ?");
    }
    const text = await res.text();
    if (!res.ok) throw refusal(res.status, `${method} ${path.split("?")[0]}`, text);
    try { return text ? JSON.parse(text) : {}; } catch { return {}; }
  };
}

export interface BoardTool {
  name: string;
  description: string;
  readOnly: boolean;
  destructive?: boolean;
  props: Json;
  required?: string[];
  /** False: never offered as a button (typing into an agent's pane stays the operator's gesture). */
  button?: false;
  /** What a button will do, in words, from its args — GETs only, and never an id on screen. */
  preview?: (a: Json) => Promise<string>;
  run: (a: Json) => Promise<string>;
}

const q = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]).toString();
  return p ? `?${p}` : "";
};
const id = (s: string) => encodeURIComponent(s);
const repoOf = (s: string) => s.replace(/\/+$/, "");
const repoName = (s: string) => repoOf(s).split("/").pop() || s;

export function createTools(api: BoardApi): BoardTool[] {
  const cardTitle = async (cardId: string) => `« ${oneLine((await api("GET", `/api/cards/${id(cardId)}`)).card?.title, 80)} »`;
  return [
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
      preview: async (a) => `Résumer l'état de ${repoName(a.repoPath)}`,
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
      preview: async (a) => `Lire la carte ${await cardTitle(a.cardId)}`,
      run: async (a) => {
        const { card, events = [] } = await api("GET", `/api/cards/${id(a.cardId)}`);
        const out = [`${card.title} — ${card.status}`, `Spec : ${clip(String(card.spec ?? "(vide)"), 800)}`];
        if (card.acceptance?.length) out.push(`Critères : ${card.acceptance.map((x: string) => oneLine(x, 100)).join(" ; ")}`);
        for (const e of events.slice(0, 8)) out.push(`· ${e.type} ${oneLine(JSON.stringify(e.payload ?? {}), 90)}`);
        return out.join("\n");
      },
    },
    {
      name: "whats_blocking", readOnly: true,
      description: "Ce qui bloque maintenant : les agents qui attendent une réponse, avec la fin de leur sortie.",
      props: {},
      run: async () => {
        const { agents = [], bridge } = await api("GET", "/api/snapshot");
        if (bridge === "disconnected") return "Le lien avec herdr est coupé, je ne peux pas dire ce qui bloque.";
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
      name: "reply_to_agent", readOnly: false, destructive: false, button: false,
      description: "Répond à un agent qui attend : tape le texte dans son terminal et valide. À n'utiliser que pour une décision déjà prise par l'opérateur.",
      props: { paneId: { type: "string", description: "Voir whats_blocking" }, text: { type: "string" } }, required: ["paneId", "text"],
      run: async (a) => { await api("POST", `/api/pane/${id(a.paneId)}/reply`, { text: a.text }); return `Réponse envoyée à ${a.paneId}.`; },
    },
    {
      name: "message_orchestrator", readOnly: false, destructive: false,
      description: "Parle à l'orchestrateur vivant d'un projet : tape le texte dans son terminal, préfixé « [vocal] », et valide. Pour « dis à l'orchestrateur de X ». Ne démarre rien s'il n'y en a pas.",
      props: { repoPath: { type: "string", description: "Chemin absolu du dépôt (voir list_projects)" }, text: { type: "string" } }, required: ["repoPath", "text"],
      preview: async (a) => `Dire « ${oneLine(a.text, 60)} » à l'orchestrateur de ${repoName(a.repoPath)}`,
      run: async (a) => {
        const { paneId } = await api("GET", `/api/orchestrator${q({ repo: repoOf(a.repoPath) })}`);
        if (!paneId) throw new Refusal("Aucun orchestrateur ne vit sur ce projet ; je n'en démarre pas.");
        await api("POST", `/api/pane/${id(paneId)}/reply`, { text: `[vocal] ${a.text}` });
        return "Message transmis à l'orchestrateur.";
      },
    },
    {
      name: "create_card", readOnly: false, destructive: false,
      description: "Crée une carte (backlog) dans un projet ; elle ne démarre pas toute seule.",
      props: { repoPath: { type: "string" }, title: { type: "string" }, spec: { type: "string" }, phaseId: { type: "string", description: "Optionnel" } }, required: ["repoPath", "title"],
      preview: async (a) => `Créer la carte « ${oneLine(a.title, 80)} » dans ${repoName(a.repoPath)}`,
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
      preview: async (a) => {
        if (!a.runId) return `Lancer le prochain lot planifié de ${repoName(String(a.repoPath ?? "?"))}`;
        const run = ((await api("GET", "/api/runs")).runs ?? []).find((r: Json) => r.id === a.runId);
        if (!run) throw new Refusal("Ce lot n'existe pas.");
        return `Lancer le lot « ${oneLine(run.name ?? "sans nom", 60)} »`;
      },
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
      // The card screen's three ways to end a card, each by the same request as its button (card.tsx:
      // IntegrationSection's merge / PR, "Classer → Terminé"): no decision here, the bridge's gate and lock apply.
      name: "finish_card", readOnly: false, destructive: true,
      description: "Termine une carte comme l'écran carte. mode « pr » (défaut) : ouvre ou met à jour la PR, la carte est classée quand la PR est fusionnée. « merge » : fusionne la branche directement dans sa base (main) et classe la carte. « done » : classe la carte sans intégrer.",
      props: { cardId: { type: "string" }, mode: { type: "string", enum: ["pr", "merge", "done"], description: "Défaut pr" } }, required: ["cardId"],
      preview: async (a) => {
        const { card } = await api("GET", `/api/cards/${id(a.cardId)}`);
        const title = `« ${oneLine(card?.title, 80)} »`;
        const mode = a.mode ?? "pr";
        if (mode === "merge") return `Fusionner ${title} dans ${card?.baseRef || "sa branche de base"}`;
        if (mode === "done") return `Classer ${title} terminée, sans intégrer`;
        return `Ouvrir la PR de ${title}`;
      },
      run: async (a) => {
        const cardId = String(a.cardId ?? a.card_id ?? "");
        const mode = a.mode ?? "pr";
        if (!["pr", "merge", "done"].includes(mode)) throw new Refusal("Mode inconnu : pr, merge ou done.");
        const { card } = await api("GET", `/api/cards/${id(cardId)}`);
        const title = `« ${oneLine(card?.title, 80)} »`;
        if (mode === "done") {
          await api("PATCH", `/api/cards/${id(cardId)}`, { status: "done" });
          return `Carte ${title} classée terminée, sans intégration.`;
        }
        // The buttons' `filing`: a card already filed gets the integration alone.
        const filing = card?.status !== "done" && card?.status !== "archived";
        let res: Json;
        try {
          res = await api("POST", `/api/cards/${id(cardId)}/integration`, { action: mode, andDone: filing });
        } catch (e) {
          let err: Json;
          try { err = JSON.parse((e as Refusal).body); } catch { throw e; }
          const why = oneLine(err.error, 160);
          throw new Refusal(
            err.kind === "in-progress" ? `Une intégration est déjà en cours sur ${title} : rien n'a été relancé.`
            : err.kind === "conflict" ? `Conflit de fusion sur ${title}, rien n'a été modifié : ${why}.`
            : err.kind === "refused" ? `Refusé pour ${title} : ${why}.`
            : `Échec (${err.kind}) sur ${title} : ${why}.`,
          );
        }
        if (mode === "pr") return filing
          ? `PR ouverte et suivie pour ${title} : ${res.url} — la carte sera classée une fois la PR fusionnée.`
          : `PR à jour pour ${title} : ${res.url}.`;
        return `${title} fusionnée dans ${res.base}${filing ? " et classée terminée" : ""}.`;
      },
    },
    {
      name: "notify", readOnly: false, destructive: false, button: false,
      description: "Envoie une notification au téléphone de l'opérateur (une ligne). Réservé à un agent du board : absent sans HERDR_PANE_ID. Pour parler à l'orchestrateur, voir message_orchestrator.",
      props: { message: { type: "string" } }, required: ["message"],
      run: async (a) => { await api("POST", "/api/board/notify", { message: a.message }); return "Notification envoyée."; },
    },
  ];
}

/** Args checked against a tool's schema: why they don't fit, or null. Nothing runs on a non-null answer. */
export function invalidArgs(tool: Pick<BoardTool, "props" | "required">, args: unknown): string | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "args doit être un objet";
  const a = args as Json;
  for (const k of tool.required ?? []) if (a[k] === undefined || a[k] === "") return `il manque « ${k} »`;
  for (const [k, v] of Object.entries(a)) {
    const p = tool.props[k];
    if (!p) return `argument inconnu « ${k} »`;
    if (typeof v !== p.type) return `« ${k} » doit être de type ${p.type}`;
    if (p.enum && !p.enum.includes(v)) return `« ${k} » vaut ${p.enum.join(", ")}`;
  }
  return null;
}
