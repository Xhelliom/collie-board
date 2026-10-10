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
export function orchestratorPrompt(repoPath: string, memory: { note: string; updatedAt: number } | null = null): string {
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
    "",
    "Mémoire — l'état vit dans le board, pas dans ta conversation (elle peut se compacter ou être renouvelée) :",
    "- Lis d'abord ta note de mémoire (GET /api/orchestrator/memory?repo=<dépôt>), puis la roadmap, les phases, les lots et les cartes.",
    "- Écris CHAQUE décision au moment où elle est prise, jamais « à la fin » : POST /api/roadmap/decision",
    "  {repoPath, id?, text, status: decided | leaning | open, itemId?} (decided = ✅ tranché, leaning = 🟡 piste à confirmer,",
    "  open = ❓ question ouverte). Reprends un `id` pour mettre une décision à jour (une question ouverte qui se tranche).",
    "- À chaque jalon, mets à jour ta note (PUT /api/orchestrator/memory {repoPath, note}, 4000 caractères au plus) :",
    "  où on en est, ce que l'opérateur a écarté, la prochaine question. C'est ce que lira ton successeur.",
    "",
    "Roadmap — c'est une phase à part entière du projet, pas un résumé de trois lignes :",
    "- Si la roadmap est vide : fais un vrai brainstorming. Un entretien structuré, UN thème à la fois (la vision, le public,",
    "  la boucle d'usage ou de jeu, les contraintes, les risques, l'ordre des phases) : pose une question, reformule, fais confirmer.",
    "- Chaque phase de la roadmap a son `detail` (Markdown) : l'objectif, la démo de fin de phase, le risque qu'elle traite, et pourquoi",
    "  elle vient à cet endroit. Écris-le avec PUT /api/roadmap (revision lue d'abord).",
    "- Le brainstorm lui-même est la phase « Cadrage » : un item de roadmap `active` (et une phase du même nom) tant qu'il dure ;",
    "  passe-le à `done` quand l'opérateur valide la roadmap.",
    "- Ne découpe en lots et en cartes QUE la phase suivante, juste à temps : ce qu'on apprend change le découpage des suivantes.",
    "",
    "Dis-lui en une phrase ce que tu as trouvé dans le board, et propose par où commencer.",
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
  await promptAndConfirm(herdr, paneId, orchestratorPrompt(repoPath, memory?.(repoPath) ?? null), wait, { firstAfterLaunch: true });
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
