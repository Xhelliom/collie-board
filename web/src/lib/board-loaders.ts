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
import { fetchFlows, type Flow } from "./flows";
import { fetchTemplates, type TemplatesData } from "./templates";
import {
  loadRepoScope,
  fetchCard,
  fetchCards,
  fetchCardsSummary,
  fetchLots,
  fetchOpenPrs,
  fetchOrchestrator,
  fetchPhases,
  fetchOrchestratorMemory,
  fetchRoadmap,
  type CardCounts,
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
  /** What the journal knows of each card, keyed by card id — the tiles' milestone dots. Garnish: undefined when it can't be read. */
  facts?: Record<string, CardFacts>;
  /** Set when `cards` is the summary view: the counts over every finished card, most of which it leaves out. */
  counts?: CardCounts;
}

/** Last-good list per view, so a failed refresh never hands one screen the other view's cards. */
const lastBoard: { full?: BoardData; summary?: BoardData } = {};

/** The full list, with facts — what the project page reads (the spec of an unfolded step, the closed phases' steps). */
export const boardLoader = ({ request }: { request?: Request } = {}) => loadBoard(request, true, false);

export interface HomeBoardData {
  /** A promise only on a cold start: there the triage renders from the snapshot alone, the card blocks under a skeleton. */
  board: BoardData | Promise<BoardData>;
}

/** The home screen's cards, without the facts: it never reads them, and they are its heaviest poll (audit perf #1).
 *  Cold start: the cards are not awaited, so the triage shows at the snapshot's pace (audit perf #3). Once a list
 *  is known, they are — a poll that handed `<Await>` a fresh promise every tick would flash the skeletons. */
export async function homeLoader({ request }: { request?: Request } = {}): Promise<HomeBoardData> {
  const board = loadBoard(request, false, true);
  if (lastBoard.summary) return { board: await board };
  // No last-good list to fall back on: an error is the block's to show, not zeros dressed as figures.
  const first = board.then((b) => (b.error ? Promise.reject(new Error("cards unavailable")) : b));
  first.catch(() => {}); // <Await> renders the rejection; this only keeps it from being reported as unhandled
  return { board: first };
}

async function loadBoard(request: Request | undefined, withFacts: boolean, summary: boolean): Promise<BoardData> {
  const view = summary ? "summary" : "full";
  try {
    const [{ cards, counts }, facts] = await Promise.all([
      summary ? fetchCardsSummary(request?.signal) : fetchCards(request?.signal).then((r) => ({ ...r, counts: undefined })),
      withFacts
        ? fetchFacts(undefined, request?.signal).then((r) => Object.fromEntries(r.facts.map((f) => [f.cardId, f])), () => undefined)
        : undefined,
    ]);
    const data = { cards, error: false, authError: false, facts, counts };
    lastBoard[view] = data;
    return data;
  } catch (e) {
    if (isAbortError(e)) throw e;
    const last = lastBoard[view];
    return { cards: last?.cards ?? [], counts: last?.counts, error: true, authError: isAuthError(e) };
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
  /** The agent templates, for the phase selector and the chips (ADR 0026). Null: none, or an older bridge. */
  templates?: TemplatesData | null;
  /** The flows (ADR 0032), for the phase's flow select. Null: none, or an older bridge. */
  flows?: Flow[] | null;
}

export type BoardRouteData = BoardData & Pick<ProjectData, "phases" | "templates">;

/** The Board's filters that need every finished card: a filtered Done column, or all of it unfolded (`?done=all`). */
const FULL_LIST_PARAMS = ["tag", "origin", "phase", "done"];

/** The Board's own loader: cards, facts, phases, templates — what BoardRoute reads, nothing of the project page's (audit perf #2).
 *  The summary view unless a filter needs the finished cards it leaves out (audit perf #4). */
export async function boardRouteLoader({ request }: { request?: Request } = {}): Promise<BoardRouteData> {
  const params = request ? new URL(request.url).searchParams : null;
  const repo = params?.get("repo") ?? loadRepoScope();
  const summary = !FULL_LIST_PARAMS.some((k) => params?.has(k));
  const [base, phases, templates] = await Promise.all([
    loadBoard(request, true, summary),
    repo ? fetchPhases(repo, request?.signal).then((r) => r.phases, () => []) : [],
    repo ? fetchTemplates(request?.signal).catch(() => null) : undefined,
  ]);
  return { ...base, phases, templates };
}

/** The board's cards plus one repo's project layer. A failed project fetch degrades to "none", not an error page. */
export async function projectLoader({ request }: { request?: Request } = {}): Promise<ProjectData> {
  const repo = (request ? new URL(request.url).searchParams.get("repo") : null) ?? loadRepoScope();
  if (!repo) return { ...(await boardLoader({ request })), phases: [], lots: [], roadmap: null };
  const signal = request?.signal;
  // The repo is in the URL: its layer starts with the cards, and the orchestrator's history and memory
  // start together once its pane is known — one round of waiting each, not four (audit perf #5).
  const orchestratorLayer = fetchOrchestrator(repo, signal)
    .catch(() => null)
    .then(async (orchestrator) => {
      if (!orchestrator?.paneId) return { orchestrator, orchestratorEntries: [], orchestratorMemory: null };
      const [orchestratorEntries, orchestratorMemory] = await Promise.all([
        fetchHistory(orchestrator.paneId, { limit: ORCHESTRATOR_TURNS }, undefined, signal).then(
          (r) => (r.available ? r.entries : []),
          () => [],
        ),
        fetchOrchestratorMemory(repo, signal).then((r) => r.memory, () => null),
      ]);
      return { orchestrator, orchestratorEntries, orchestratorMemory };
    });
  const [base, phases, lots, roadmap, orch, templates, flows] = await Promise.all([
    boardLoader({ request }),
    fetchPhases(repo, signal).then((r) => r.phases, () => []),
    fetchLots(repo, signal).then((r) => r.runs, () => []),
    fetchRoadmap(repo, signal).then((r) => r.roadmap, () => null),
    orchestratorLayer,
    fetchTemplates(signal).catch(() => null),
    fetchFlows(signal).then((r) => r.flows).catch(() => null),
  ]);
  return { ...base, phases, lots, roadmap, ...orch, templates, flows };
}
