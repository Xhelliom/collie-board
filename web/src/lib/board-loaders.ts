// Route loaders for the board, same shape and same rules as lib/loaders.ts: keep-previous-data so a
// transient failure shows stale-but-flagged content instead of an empty screen, and rethrow
// AbortError so a superseded revalidation is dropped rather than mistaken for an outage.
//
// Polling comes for free: these are React Router loaders under the same root, and the root's
// `useRevalidator` tick re-runs every active loader (see hooks/use-polling.ts). There is no
// board-specific poll loop.

import { fetchHistory, isApiErrorStatus } from "./api";
import type { TranscriptEntry } from "./types";
import { fetchFacts, type CardFacts } from "./project-facts";
import {
  loadRepoScope,
  fetchCard,
  fetchCards,
  fetchLots,
  fetchOpenPrs,
  fetchOrchestrator,
  fetchPhases,
  fetchOrchestratorMemory,
  fetchRoadmap,
  type CardDetail,
  type CardView,
  type Lot,
  type OpenPr,
  type OrchestratorMemory,
  type OrchestratorState,
  type Phase,
  type Roadmap,
} from "./board";

function isAbortError(e: unknown): boolean {
  return (
    typeof e === "object" && e !== null && "name" in e && (e as { name?: unknown }).name === "AbortError"
  );
}

function isAuthError(e: unknown): boolean {
  return isApiErrorStatus(e, 401) || isApiErrorStatus(e, 403);
}

export interface BoardData {
  cards: CardView[];
  /** True when this render is the last-good card list after a failed refresh. */
  error: boolean;
  authError: boolean;
}

let lastCards: CardView[] | null = null;

export async function boardLoader({ request }: { request?: Request } = {}): Promise<BoardData> {
  try {
    const { cards } = await fetchCards(request?.signal);
    lastCards = cards;
    return { cards, error: false, authError: false };
  } catch (e) {
    if (isAbortError(e)) throw e;
    return { cards: lastCards ?? [], error: true, authError: isAuthError(e) };
  }
}

export interface CardData {
  cardId: string;
  detail: CardDetail | null;
  error: boolean;
  authError: boolean;
}

// Keyed by card id so opening a second card doesn't show the first one's stale detail.
const lastDetail = new Map<string, CardDetail>();

export async function cardLoader({
  params,
  request,
}: {
  params: { cardId?: string };
  request?: Request;
}): Promise<CardData> {
  const { cardId } = params;
  if (!cardId) throw new Error("cardLoader: missing :cardId route param");
  try {
    const detail = await fetchCard(cardId, request?.signal);
    lastDetail.set(cardId, detail);
    return { cardId, detail, error: false, authError: false };
  } catch (e) {
    if (isAbortError(e)) throw e;
    return {
      cardId,
      detail: lastDetail.get(cardId) ?? null,
      error: true,
      authError: isAuthError(e),
    };
  }
}

/** The open PRs, from the journal alone — asking GitHub is the screen's Check tap (routes/prs.tsx). */
export async function prsLoader(): Promise<OpenPr[]> {
  return (await fetchOpenPrs()).prs;
}

/** How much of the orchestrator's pane the panel shows — the conversation's tail, not its scrollback. */
/** How many of the newest turns the panel keeps — a planning chat is short, and this rides the root poll. */
const ORCHESTRATOR_TURNS = 40;

export interface ProjectData extends BoardData {
  /** Empty without a `?repo=` — phases, lots and the roadmap are per repo (ADR 0021). */
  phases: Phase[];
  lots: Lot[];
  roadmap: Roadmap | null;
  /** The repo's orchestrator and the tail of its pane, so the panel rides the root poll (no loop of its own). */
  orchestrator?: OrchestratorState | null;
  /** The orchestrator's conversation, oldest first — the reading view's turns, not the terminal. */
  orchestratorEntries?: TranscriptEntry[];
  /** Its memory note, read-only in the panel. */
  orchestratorMemory?: OrchestratorMemory | null;
  /** What the journal knows of each card of the repo, keyed by card id (bridge/project-facts.ts). */
  facts?: Record<string, CardFacts>;
}

/** The board's cards plus one repo's project layer. A failed project fetch degrades to "none", not an error page. */
export async function projectLoader({ request }: { request?: Request } = {}): Promise<ProjectData> {
  const base = await boardLoader({ request });
  const repo = (request ? new URL(request.url).searchParams.get("repo") : null) ?? loadRepoScope();
  if (!repo) return { ...base, phases: [], lots: [], roadmap: null };
  const [phases, lots, roadmap, orchestrator, facts] = await Promise.all([
    fetchPhases(repo, request?.signal).then((r) => r.phases, () => []),
    fetchLots(repo, request?.signal).then((r) => r.runs, () => []),
    fetchRoadmap(repo, request?.signal).then((r) => r.roadmap, () => null),
    fetchOrchestrator(repo, request?.signal).catch(() => null),
    // Facts are garnish: without them a step is just its card.
    fetchFacts(repo, request?.signal).then((r) => Object.fromEntries(r.facts.map((f) => [f.cardId, f])), () => undefined),
  ]);
  const orchestratorEntries = orchestrator?.paneId
    ? await fetchHistory(orchestrator.paneId, { limit: ORCHESTRATOR_TURNS }, undefined, request?.signal).then(
        (r) => (r.available ? r.entries : []),
        () => [],
      )
    : [];
  const orchestratorMemory = orchestrator?.paneId
    ? await fetchOrchestratorMemory(repo, request?.signal).then((r) => r.memory, () => null)
    : null;
  return { ...base, phases, lots, roadmap, orchestrator, orchestratorEntries, orchestratorMemory, facts };
}
