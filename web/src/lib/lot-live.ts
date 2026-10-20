import type { CardView, Lot } from "@/lib/board";
import type { CardFacts } from "@/lib/project-facts";

// The lot in progress, read for the project page's banner: each card's state now, from the cards and the
// journal's facts the page already loaded. Nothing stored — a poll redraws it.

/** "queued": in the lot, not started yet — none of the five others would be true of it. */
export type LiveState = "queued" | "working" | "review" | "pr" | "merged" | "blocked";

export interface LiveCard {
  card: CardView;
  state: LiveState;
  paneId: string | null;
  prUrl: string | null;
}

export interface LiveLot {
  lot: Lot;
  cards: LiveCard[];
  merged: number;
}

/** Pure. */
export function liveState(card: CardView, lot: Lot, facts?: CardFacts): LiveState {
  const pr = facts?.pr?.state;
  // A one-PR lot (ADR 0041) folds a finished card into its branch: it is merged when THE PR is.
  const single = lot.integration === "lot";
  if (card.status === "blocked" || card.status === "orphaned") return "blocked";
  if (pr === "merged" || (card.status === "done" && !single)) return "merged";
  if (pr === "open" || (single && lot.prUrl && (card.status === "done" || card.status === "review"))) return "pr";
  if (card.status === "review" || card.status === "done") return "review";
  if (card.status === "backlog" || card.status === "ready") return "queued";
  return "working";
}

/** The launched lots not over yet, in their order, each card with its state. Pure. */
export function liveLots(lots: readonly Lot[], byId: ReadonlyMap<string, CardView>, facts?: Record<string, CardFacts>): LiveLot[] {
  return lots
    .filter((l) => l.launchedAt !== null && !l.finished)
    .sort((a, b) => a.position - b.position)
    .map((lot) => {
      const cards = lot.cardIds
        .map((id) => byId.get(id))
        .filter((c): c is CardView => !!c)
        .map((card) => {
          const f = facts?.[card.id];
          return {
            card,
            state: liveState(card, lot, f),
            paneId: card.runtime?.paneId ?? null,
            prUrl: f?.pr?.url ?? (lot.integration === "lot" ? (lot.prUrl ?? null) : null),
          };
        });
      return { lot, cards, merged: cards.filter((c) => c.state === "merged").length };
    })
    // ponytail: an older bridge without `finished` — every card merged means the lot is over.
    .filter((l) => l.cards.length > 0 && l.merged < l.cards.length);
}
