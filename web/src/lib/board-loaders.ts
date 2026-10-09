// Route loaders for the board, same shape and same rules as lib/loaders.ts: keep-previous-data so a
// transient failure shows stale-but-flagged content instead of an empty screen, and rethrow
// AbortError so a superseded revalidation is dropped rather than mistaken for an outage.
//
// Polling comes for free: these are React Router loaders under the same root, and the root's
// `useRevalidator` tick re-runs every active loader (see hooks/use-polling.ts). There is no
// board-specific poll loop.

import { isApiErrorStatus } from "./api";
import {
  fetchCard,
  fetchCards,
  fetchLots,
  fetchOpenPrs,
  fetchPhases,
  fetchRoadmap,
  type CardDetail,
  type CardView,
  type Lot,
  type OpenPr,
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

export interface ProjectData extends BoardData {
  /** Empty without a `?repo=` — phases, lots and the roadmap are per repo (ADR 0021). */
  phases: Phase[];
  lots: Lot[];
  roadmap: Roadmap | null;
}

/** The board's cards plus one repo's project layer. A failed project fetch degrades to "none", not an error page. */
export async function projectLoader({ request }: { request?: Request } = {}): Promise<ProjectData> {
  const base = await boardLoader({ request });
  const repo = request ? new URL(request.url).searchParams.get("repo") : null;
  if (!repo) return { ...base, phases: [], lots: [], roadmap: null };
  const [phases, lots, roadmap] = await Promise.all([
    fetchPhases(repo, request?.signal).then((r) => r.phases, () => []),
    fetchLots(repo, request?.signal).then((r) => r.runs, () => []),
    fetchRoadmap(repo, request?.signal).then((r) => r.roadmap, () => null),
  ]);
  return { ...base, phases, lots, roadmap };
}
