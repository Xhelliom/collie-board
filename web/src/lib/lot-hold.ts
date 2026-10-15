import { t } from "@/i18n";
import type { CardView, Lot } from "@/lib/board";

// A card of a launched lot that is not over is the LEAD's: it reviews, opens the PR and merges on its
// own. While that holds, "review" and "merge it yourself" are wrong on the card — the views show the
// lot and its step instead, and fold the manual gestures. The lot over (`run.finished`), or the card
// out of any lot: null, and the card shows as it always did.

/** Where the lot has the card: an agent on it, the lead reading it, or its PR on the way in. */
export type LotStep = "running" | "review" | "merge";

export interface LotHold {
  lot: Lot;
  /** "Lot · <name>" — the chip every view shows. */
  label: string;
  /** Null: its own status says it better — merged (a lot of per-card PRs), or blocked/orphaned, which wait on you. */
  step: LotStep | null;
  /** One PR for the lot (ADR 0041): THE PR, not one of the card's. */
  prUrl: string | null;
}

/** `prOpen`: the card's own PR is open (its facts), when the caller knows. Pure. */
export function lotHold(card: Pick<CardView, "runId" | "status">, lots: readonly Lot[] | undefined, prOpen = false): LotHold | null {
  const lot = card.runId ? lots?.find((l) => l.id === card.runId) : undefined;
  return lot ? holdOf(card, lot, prOpen) : null;
}

/** {@link lotHold} for the lot already in hand (the card screen's `detail.lot`). Pure. */
export function holdOf(card: Pick<CardView, "status">, lot: Lot | null | undefined, prOpen = false): LotHold | null {
  if (!lot || lot.launchedAt === null || lot.finished) return null;
  const single = lot.integration === "lot";
  const prUrl = single ? (lot.prUrl ?? null) : null;
  let step: LotStep | null = "running";
  if (card.status === "done") step = single ? "merge" : null; // folded, waiting for the lot's PR
  else if (card.status === "review") step = prOpen || prUrl ? "merge" : "review";
  else if (card.status === "blocked" || card.status === "orphaned") step = null; // that one IS the operator's
  return { lot, label: t("lot.chip", { name: lot.name ?? t("lot.fallbackName") }), step, prUrl };
}
