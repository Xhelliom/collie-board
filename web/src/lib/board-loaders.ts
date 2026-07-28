// Route loaders for the board, same shape and same rules as lib/loaders.ts: keep-previous-data so a
// transient failure shows stale-but-flagged content instead of an empty screen, and rethrow
// AbortError so a superseded revalidation is dropped rather than mistaken for an outage.
//
// Polling comes for free: these are React Router loaders under the same root, and the root's
// `useRevalidator` tick re-runs every active loader (see hooks/use-polling.ts). There is no
// board-specific poll loop.

import { isApiErrorStatus } from "./api";
import { fetchCard, fetchCards, type CardDetail, type CardView } from "./board";

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
