// `GET /api/cards?view=summary` — the list screens' card list (audit perf #4).
//
// The plain `/api/cards` stays as it is: it is public API and its consumers read it (ADR 0013). This
// is a view BESIDE it, for the home and the Board, which read neither the spec, the criteria nor the
// raw input, and show only a few finished cards. Pure, so `bun test` covers it.

import type { CardView } from "./cards.ts";

/** Finished cards kept per repo — the Board's Done column shows this many before « see the others ». */
export const DONE_KEPT = 5;
const WEEK = 7 * 24 * 3600 * 1000;

/** A card without its bulky text: the spec's first line and the number of criteria stand in for it. */
export type CardSummary = Omit<CardView, "spec" | "acceptance" | "rawInput"> & {
  specLine: string | null;
  acceptanceCount: number;
};

/** What the screens count over EVERY finished card, kept in the list or not. */
export interface CardCounts {
  /** Done, updated in the last 7 days — the home KPI (containers included, as the full list counts them). */
  delivered: number;
  /** Done steps (containers excluded, as the Done column does) per repo; `""` for a card with none. */
  doneByRepo: Record<string, number>;
  /** Done steps per phase id — the phase pills' "n done". */
  doneByPhase: Record<string, number>;
}

/** The first line of a spec, without markdown marks. Same rule as web/src/lib/project-facts.tsx. */
export function specLine(spec: string | null): string | null {
  const line = (spec ?? "").split("\n").map((l) => l.replace(/^[#>*\-\s`]+/, "").trim()).find(Boolean);
  return line ? line.slice(0, 160) : null;
}

export function summarize(card: CardView): CardSummary {
  const { spec, acceptance, rawInput: _raw, ...rest } = card;
  return { ...rest, specLine: specLine(spec), acceptanceCount: acceptance.length };
}

/**
 * Which cards the summary carries, and the counts over the rest. Every unfinished card; a finished one
 * only while something on screen still needs it:
 * - the DONE_KEPT newest steps of its repo (the Done column, and the repo's place in the home's order);
 * - a step of a phase still open, or of a phase / dictation that still has work left (the progress bars
 *   draw every step of those, and a container with none of its steps listed would read as a step);
 * - the parent or the predecessor of an unfinished card (its name, and "is the dependency met").
 * A finished container kept by none of its children is dropped: without them it would read as a step.
 */
export function cardsSummary(
  cards: CardView[],
  openPhaseIds: ReadonlySet<string>,
  now = Date.now(),
): { cards: CardSummary[]; counts: CardCounts } {
  const parents = new Set(cards.map((c) => c.parentId).filter((id): id is string => !!id));
  const live = cards.filter((c) => c.status !== "done");
  const livePhases = new Set(live.map((c) => c.phaseId).filter(Boolean));
  // A dictation still open: its container is unfinished, or one of its steps is.
  const liveParents = new Set([...live.map((c) => c.id), ...live.map((c) => c.parentId)].filter(Boolean));
  const linked = new Set(live.flatMap((c) => [c.parentId, c.dependsOn]).filter(Boolean));

  const counts: CardCounts = { delivered: 0, doneByRepo: {}, doneByPhase: {} };
  const newest = new Map<string, CardView[]>();
  const keep = new Set<string>();
  for (const c of cards) {
    if (c.status !== "done") continue;
    if (now - c.updatedAt < WEEK) counts.delivered++;
    if (linked.has(c.id)) keep.add(c.id);
    if (parents.has(c.id)) continue;
    const repo = c.repoPath ?? "";
    counts.doneByRepo[repo] = (counts.doneByRepo[repo] ?? 0) + 1;
    if (c.phaseId) counts.doneByPhase[c.phaseId] = (counts.doneByPhase[c.phaseId] ?? 0) + 1;
    newest.set(repo, [...(newest.get(repo) ?? []), c]);
    if (c.phaseId && (openPhaseIds.has(c.phaseId) || livePhases.has(c.phaseId))) keep.add(c.id);
    if (c.parentId && liveParents.has(c.parentId)) keep.add(c.id);
  }
  for (const own of newest.values()) {
    for (const c of own.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, DONE_KEPT)) keep.add(c.id);
  }
  // A kept step keeps its finished container, so the step still reads as part of it.
  for (const c of cards) if (keep.has(c.id) && c.parentId) keep.add(c.parentId);

  return { cards: cards.filter((c) => c.status !== "done" || keep.has(c.id)).map(summarize), counts };
}
