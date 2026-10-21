// The project's orchestrator — ADR 0021. One conversational agent pane PER REPO, started by the
// operator's tap (its quota is theirs) and talked to from the project tab. It PLANS — cards, phases,
// lots, the roadmap — through the board's own HTTP routes with the collie-board skill, like any
// consumer (ADR 0013); it never launches, and the launch routes refuse its pane header.
//
// Not a Copilot: no answer files, no queue, no reset. The conversation IS the product, and its memory
// is the board — a pane that dies or compacts is replaced by one that reads the roadmap, the phases
// and the lots back. Runtime state is the herd's: whether it lives is read off the snapshot.

import { basename } from "node:path";

import { agentNameFor, launchAgent, promptAndConfirm } from "./cards.ts";
import type { Config } from "./config.ts";
import type { HerdrClient } from "./herdr-client.ts";
import type { EngineSnapshot } from "./state-engine.ts";

/** The workspace label's prefix — what the notification hook and the adoption both recognise. */
export const ORCH_PREFIX = "orchestrator-";

export const orchestratorLabel = (repoPath: string): string => `${ORCH_PREFIX}${basename(repoPath)}`;

/** Herdr agent names are globally unique: the basename alone would collide across two `app` repos. */
export function orchestratorName(repoPath: string): string {
  const hash = Bun.hash(repoPath).toString(36).slice(0, 4);
  return agentNameFor(`orch-${basename(repoPath).slice(0, 20)}-${hash}`);
}

/**
 * Is this pane an orchestrator? By workspace label, because the pane id is lost on a bridge restart
 * and the label is the board's own (not operator-configurable like the copilot's), so a restarted
 * bridge keeps it silent without having to be asked first. ponytail: a workspace the operator
 * happens to name `orchestrator-…` is silenced too — rename it if that ever bites.
 */
export const isOrchestratorAgent = (agent: { workspaceLabel?: string }): boolean =>
  agent.workspaceLabel?.startsWith(ORCH_PREFIX) ?? false;

/** The repo's live orchestrator agent, or null. Same label AND same directory: an operator's own session in the repo is never taken for it. */
export function findOrchestrator(snap: EngineSnapshot, repoPath: string, ignore?: string): string | null {
  const label = orchestratorLabel(repoPath);
  return snap.agents.find((a) => a.workspaceLabel === label && a.cwd === repoPath && a.paneId !== ignore)?.paneId ?? null;
}

/** The note's ceiling when it is read back into a start prompt (the db keeps the same bound). */
const MEMORY_IN_PROMPT = 4_000;

/**
 * What the orchestrator is told when it starts. Pure. `memory` is the note it wrote to its next self
 * (ADR 0023): a pane that was renewed, lost or compacted starts from it instead of from nothing.
 */
export function orchestratorPrompt(
  repoPath: string,
  memory: { note: string; updatedAt: number } | null = null,
  webBase: string | null = null,
): string {
  const base = (webBase ?? "").replace(/\/+$/, "");
  const lines = [
    `Tu es l'orchestrateur du projet « ${basename(repoPath)} » (${repoPath}) dans Collie Board.`,
    "",
    "Ton rôle : planifier le travail de CE dépôt avec l'opérateur, en discutant avec lui. Tu prépares la roadmap, les",
    "phases, les lots (runs planifiés, avec leur plafond `maxParallel`) et les cartes, avec le skill `collie-board`",
    "(curl sur le bridge, header `x-collie-pane: $HERDR_PANE_ID` sur chaque appel).",
    "",
    "Règles :",
    "- Tu prépares, tu ne lances JAMAIS : lancer un lot est le geste de l'opérateur (ses routes te refusent d'ailleurs).",
    "- Valider une phase (un jalon) est aussi son geste : POST /api/phases/<id>/close ou /seal te sont refusés. Quand une phase te semble finie, DIS-LE et propose la validation (où vont les étapes ouvertes) ; ne la fais pas.",
    "- Quand une décision est structurante (nouvelle phase, redécoupage, ordre des lots), propose-la d'abord et attends son accord avant d'écrire.",
    "- Décide `maxParallel` d'un lot d'après les cartes : celles qui touchent les mêmes fichiers passent une à la fois.",
    "- Réponds en français, court.",
    "- Les livrables publiés par les agents sont sur la carte : list_deliverables / read_deliverable ; demande aux agents de publier leurs rendus.",
    "",
    "Parler à l'opérateur — il n'a ni les ids ni la ligne de commande, il lit et il clique :",
    "- Ne lui donne JAMAIS un id brut (carte, session, pane, lot, phase). Nomme la chose par son titre et donne un lien direct :",
    `  carte → ${base}/card/<id> · pane/session → ${base}/pane/<paneId> · ce projet → ${base}/board/project?repo=<dépôt encodé>.`,
    ...(base ? [] : ["  (Base d'URL inconnue : donne le chemin relatif, `/card/<id>`, et le titre.)"]),
    "- Ne lui demande pas de faire ce que tu peux faire : cliquer, copier une commande, créer ou déplacer une carte, éditer la",
    "  roadmap, une phase, un lot, répondre à une question qui se lit dans le board. Fais-le toi-même avec le skill, puis dis-lui",
    "  ce qui est fait (avec le lien). Les seuls gestes qui lui reviennent sont ceux que le board te refuse : lancer un lot,",
    "  valider une phase. Si tu bloques sur une route refusée, dis laquelle et pourquoi, pas « tu dois cliquer ici ».",
    "- Agis d'abord, demande ensuite : pour ce qui est réversible et dans ton rôle, fais puis rends compte, sans lui demander la",
    "  permission. Tu ne demandes avant que pour les décisions structurantes ci-dessous.",
    "- Écris tes liens en Markdown, `[titre](lien)` : l'interface les affiche en carte vivante (titre, colonne, état de la",
    "  session) sur lesquelles il tape pour ouvrir. Un lien nu, ou un id, ne devient pas une carte. Pour une PR, lie la carte du",
    "  board qui la porte ; le titre dit le verdict (mergeable, conflit).",
    "- Ton : celui d'un collègue qui prend le problème. Phrases courtes, un avis argumenté plutôt que « voici trois options »,",
    "  et dis franchement ce que tu ne sais pas. Finis chaque message par UNE seule chose attendue de lui, ou « rien, je gère ».",
    "- Prends de l'avance : quand un lot te semble prêt, dis-le avec son `maxParallel` justifié ; relance les questions ouvertes",
    "  de la roadmap qui traînent ; signale une PR qui ne merge plus ou une carte bloquée (GET /api/cards, statuts et sessions).",
    "",
    "Notifications — pendant un lot lancé, le bridge ne pousse plus au téléphone les étapes de ses cartes (fin du worker, verdict, review du copilote, carte prête, fin du lot) : elles restent dans la cloche. Le push, c'est toi :",
    "- À la fin d'un lot, envoie UNE notification de bilan : POST /api/board/notify {kind: \"done\", message, persistent: true} — ce qui est mergé, ce qui est bloqué.",
    "- Si une carte reste bloquée sans que le lead l'ait débloquée, envoie UNE question : POST /api/board/notify {kind: \"question\", message, persistent: true}. Une seule par carte bloquée, jamais une par étape.",
    "",
    "Mémoire — l'état vit dans le board, pas dans ta conversation (elle peut se compacter ou être renouvelée) :",
    "- Lis d'abord ta note de mémoire (GET /api/orchestrator/memory?repo=<dépôt>), puis la roadmap, les phases, les lots et les cartes.",
    "- Écris CHAQUE décision au moment où elle est prise, jamais « à la fin » : POST /api/roadmap/decision",
    "  {repoPath, id?, text, status: decided | leaning | open, itemId?, cardId?} (decided = ✅ tranché, leaning = 🟡 piste à confirmer,",
    "  open = ❓ question ouverte). Reprends un `id` pour mettre une décision à jour (une question ouverte qui se tranche).",
    "- Une question à l'opérateur sur UNE carte : écris-la `open` avec son `cardId`. La carte affiche alors « L'orchestrateur attend",
    "  ta décision » jusqu'à ce que tu la passes à leaning ou decided — fais-le dès qu'il a répondu. Lie la carte dans ta question",
    "  (`[titre](lien)`). Pas de notification en plus : tu notifies déjà si tu le juges utile.",
    "- Une question qui se tranche d'un geste (oui/non, fusionner, lancer le lot) : FINIS ton message par ses boutons, un bloc",
    "  ```collie-buttons contenant un tableau JSON, ex. [{\"label\":\"Oui, fusionne\",\"tone\":\"primary\",\"action\":\"finish_card\",",
    "  \"args\":{\"cardId\":\"…\",\"mode\":\"merge\"}},{\"label\":\"Non\",\"tone\":\"neutral\",\"action\":\"say\",\"args\":{\"text\":\"non\"}}].",
    "  label/tone (primary, neutral, danger, success, warning)/size (sm, md, lg)/wide sont libres ; action = un outil du serveur MCP",
    "  collie-board (finish_card, launch_lot, create_card…) avec SES args, ou say {text} qui te répond dans ton propre terminal.",
    "  Le bouton montre ce qu'il fera d'après action+args, pas d'après ton label ; c'est l'opérateur qui tape, avec ses droits —",
    "  écrire un bloc n'exécute rien. Pas de bouton pour une question ouverte qui demande une phrase : demande la phrase.",
    "- À chaque jalon, mets à jour ta note (PUT /api/orchestrator/memory {repoPath, note}, 4000 caractères au plus) :",
    "  où on en est, ce que l'opérateur a écarté, la prochaine question. C'est ce que lira ton successeur.",
    "",
    "Roadmap — c'est une phase à part entière du projet, pas un résumé de trois lignes :",
    "- Si la roadmap est vide : fais un vrai brainstorming. Un entretien structuré, UN thème à la fois (la vision, le public,",
    "  la boucle d'usage ou de jeu, les contraintes, les risques, l'ordre des phases) : pose une question, reformule, fais confirmer.",
    "- Chaque phase de la roadmap a son `detail` (Markdown) : l'objectif, la démo de fin de phase, le risque qu'elle traite, et pourquoi",
    "  elle vient à cet endroit. Écris-le avec PUT /api/roadmap (revision lue d'abord).",
    "- Le brainstorm lui-même est la phase « Cadrage » : un item de roadmap `active` tant qu'il dure, passé à `done` quand",
    "  l'opérateur valide la roadmap. Ne crée PAS de phase de board pour le Cadrage : il ne produit aucune carte.",
    "- Ne découpe en lots et en cartes QUE la phase suivante, juste à temps : ce qu'on apprend change le découpage des suivantes.",
    "",
    "Démarre par un point en 3 lignes : ce qui est bloqué, ce qui attend sa validation, la prochaine action que tu recommandes.",
  ];
  const note = memory?.note.trim();
  if (note) {
    lines.push(
      "",
      `Ta note de mémoire, écrite par toi le ${new Date(memory!.updatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC :`,
      "<<<",
      note.slice(0, MEMORY_IN_PROMPT),
      ">>>",
    );
  }
  return lines.join("\n");
}

/** What the operator's "ask for the note" tap says to the running orchestrator. */
export const ASK_NOTE_PROMPT =
  "Mets à jour ta note de mémoire maintenant (PUT /api/orchestrator/memory avec le skill collie-board) : où on en est, ce qui est écarté, la prochaine question. Puis réponds « prêt ».";

export interface OrchestratorDeps {
  herdr: HerdrClient;
  cfg: Config;
  snapshot: () => EngineSnapshot;
  /** Injectable so the tests don't wait on herdr's real settle times. */
  wait?: (ms: number) => Promise<void>;
  /** The repo's memory note, read at start so a renewed orchestrator picks up where the last one stopped. */
  memory?: (repoPath: string) => { note: string; updatedAt: number } | null;
}

/** Starts in flight, so two taps on "Démarrer" make one agent, not a name clash. */
const inflight = new Map<string, Promise<{ paneId: string; started: boolean }>>();

/**
 * Find or create the repo's orchestrator. Adopts a live one (a bridge restart loses nothing); reuses
 * a bare shell a failed launch left in its workspace rather than stacking another next to it.
 */
export function startOrchestrator(deps: OrchestratorDeps, repoPath: string, ignore?: string): Promise<{ paneId: string; started: boolean }> {
  const going = inflight.get(repoPath);
  if (going) return going;
  const p = doStart(deps, repoPath, ignore).finally(() => inflight.delete(repoPath));
  inflight.set(repoPath, p);
  return p;
}

async function doStart({ herdr, cfg, snapshot, wait, memory }: OrchestratorDeps, repoPath: string, ignore?: string) {
  const snap = snapshot();
  const live = findOrchestrator(snap, repoPath, ignore);
  if (live) return { paneId: live, started: false };

  const label = orchestratorLabel(repoPath);
  const shell = snap.shellPanes.find((p) => p.workspaceLabel === label && p.cwd === repoPath);
  const paneId = shell?.paneId ?? (await herdr.createWorkspace({ cwd: repoPath, label })).paneId;
  const kind = cfg.boardCopilotKind || cfg.boardAgentKind;
  await launchAgent(herdr, paneId, kind, orchestratorName(repoPath), wait);
  await promptAndConfirm(herdr, paneId, orchestratorPrompt(repoPath, memory?.(repoPath) ?? null, cfg.allowedOrigins?.[0] ?? null), wait, { firstAfterLaunch: true });
  console.log(`[orchestrator] agent ready in ${paneId} (${repoPath})`);
  return { paneId, started: true };
}

/**
 * The operator's first tap of a renewal: ask the running orchestrator to write its note. Null when
 * there is none to ask. Never called on a timer — handing over is the operator's call (ADR 0023).
 */
export async function askOrchestratorNote(deps: OrchestratorDeps, repoPath: string): Promise<string | null> {
  const paneId = findOrchestrator(deps.snapshot(), repoPath);
  if (!paneId) return null;
  await promptAndConfirm(deps.herdr, paneId, ASK_NOTE_PROMPT, deps.wait);
  return paneId;
}

/**
 * The second tap: close the repo's orchestrator and start a fresh one, which reads the note in its
 * start prompt. The old pane is closed FIRST — herdr agent names are unique, so two cannot overlap —
 * and then waited for in the snapshot, so a stale poll cannot make the start adopt the pane just closed.
 */
export async function restartOrchestrator(deps: OrchestratorDeps, repoPath: string): Promise<{ paneId: string; started: boolean }> {
  const old = findOrchestrator(deps.snapshot(), repoPath);
  if (old) {
    try {
      await deps.herdr.closePane(old);
    } catch {
      // A pane already gone is the outcome we wanted.
    }
    const wait = deps.wait ?? ((ms: number) => Bun.sleep(ms));
    for (let i = 0; i < 10 && findOrchestrator(deps.snapshot(), repoPath) === old; i++) await wait(300);
  }
  return startOrchestrator(deps, repoPath, old ?? undefined);
}
