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
export function findOrchestrator(snap: EngineSnapshot, repoPath: string): string | null {
  const label = orchestratorLabel(repoPath);
  return snap.agents.find((a) => a.workspaceLabel === label && a.cwd === repoPath)?.paneId ?? null;
}

/** What the orchestrator is told when it starts. Pure. */
export function orchestratorPrompt(repoPath: string): string {
  return [
    `Tu es l'orchestrateur du projet « ${basename(repoPath)} » (${repoPath}) dans Collie Board.`,
    "",
    "Ton rôle : planifier le travail de CE dépôt avec l'opérateur, en discutant avec lui. Tu prépares les cartes,",
    "les phases, les lots (runs planifiés, avec leur plafond `maxParallel`) et la roadmap, avec le skill",
    "`collie-board` (curl sur le bridge, header `x-collie-pane: $HERDR_PANE_ID` sur chaque appel).",
    "",
    "Règles :",
    "- Commence par lire l'état dans le board (roadmap, phases, lots, cartes de ce dépôt). Il y vit, pas dans la conversation :",
    "  ne te fie pas à ta mémoire, relis-le quand tu reprends.",
    "- Tu prépares, tu ne lances JAMAIS : lancer un lot est le geste de l'opérateur (ses routes te refusent d'ailleurs).",
    "- Quand une décision est structurante (nouvelle phase, redécoupage, ordre des lots), propose-la d'abord et attends son accord avant d'écrire.",
    "- Décide `maxParallel` d'un lot d'après les cartes : celles qui touchent les mêmes fichiers passent une à la fois.",
    "- La roadmap reste des intentions : une phase ne devient des cartes que quand on s'y attaque.",
    "- Réponds en français, court.",
    "",
    "Dis-lui en une phrase ce que tu as trouvé dans le board, et demande par où il veut commencer.",
  ].join("\n");
}

export interface OrchestratorDeps {
  herdr: HerdrClient;
  cfg: Config;
  snapshot: () => EngineSnapshot;
  /** Injectable so the tests don't wait on herdr's real settle times. */
  wait?: (ms: number) => Promise<void>;
}

/** Starts in flight, so two taps on "Démarrer" make one agent, not a name clash. */
const inflight = new Map<string, Promise<{ paneId: string; started: boolean }>>();

/**
 * Find or create the repo's orchestrator. Adopts a live one (a bridge restart loses nothing); reuses
 * a bare shell a failed launch left in its workspace rather than stacking another next to it.
 */
export function startOrchestrator(deps: OrchestratorDeps, repoPath: string): Promise<{ paneId: string; started: boolean }> {
  const going = inflight.get(repoPath);
  if (going) return going;
  const p = doStart(deps, repoPath).finally(() => inflight.delete(repoPath));
  inflight.set(repoPath, p);
  return p;
}

async function doStart({ herdr, cfg, snapshot, wait }: OrchestratorDeps, repoPath: string) {
  const snap = snapshot();
  const live = findOrchestrator(snap, repoPath);
  if (live) return { paneId: live, started: false };

  const label = orchestratorLabel(repoPath);
  const shell = snap.shellPanes.find((p) => p.workspaceLabel === label && p.cwd === repoPath);
  const paneId = shell?.paneId ?? (await herdr.createWorkspace({ cwd: repoPath, label })).paneId;
  const kind = cfg.boardCopilotKind || cfg.boardAgentKind;
  await launchAgent(herdr, paneId, kind, orchestratorName(repoPath), wait);
  await promptAndConfirm(herdr, paneId, orchestratorPrompt(repoPath), wait, { firstAfterLaunch: true });
  console.log(`[orchestrator] agent ready in ${paneId} (${repoPath})`);
  return { paneId, started: true };
}
