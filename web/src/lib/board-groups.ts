import type { BoardEvent, CardStatus, CardView, PrStatus } from "./board";
import { timeAgo } from "./format";

// Turning the flat card list into what the board renders — ADR 0022.
//
// The board is the STATUS axis: one tile per card, in the column its status names, on every screen.
// A dictation that was split into sub-tasks leaves a CONTAINER card behind; it holds the dictation
// and no work of its own, so it takes no tile — each sub-task names it instead, and the card page
// links to it. Grouping the work (phases, lots, progress) is the project view's job, not the
// board's: folding children under a parent hid them from the only sort this screen performs.
//
// Nothing here is stored: the shape is read off the flat list on every render.

/**
 * The ids of cards that are containers: some other card names them as its parent. Read off the FULL
 * list, so a filter that hides every child doesn't turn the container into a startable-looking tile.
 */
export function containerIds(cards: CardView[]): Set<string> {
  const present = new Set(cards.map((c) => c.id));
  return new Set(cards.map((c) => c.parentId).filter((id): id is string => !!id && present.has(id)));
}

/** One phase's progress for the board's pill: its steps (containers are not steps) and how many are filed. */
export function phaseProgress(
  cards: CardView[],
  phases: { id: string; name: string }[],
): Map<string, { name: string; done: number; total: number }> {
  const containers = containerIds(cards);
  const out = new Map(phases.map((p) => [p.id, { name: p.name, done: 0, total: 0 }]));
  for (const c of cards) {
    const p = c.phaseId ? out.get(c.phaseId) : undefined;
    if (!p || containers.has(c.id) || c.status === "archived") continue;
    p.total++;
    if (c.status === "done") p.done++;
  }
  return out;
}

/** What the journal remembers about a card's branch, once the branch itself is gone. */
export interface IntegrationHistory {
  /** When it was merged, and into what — from the board's own merge, not from git. */
  merged: { base: string; ts: number } | null;
  pr: { url: string | null; ts: number } | null;
  /** Cleaned up. Worth showing on its own: cleanup is REFUSED unless nothing was left to integrate,
   *  so it is second-hand evidence that the work landed even when the merge happened outside. */
  cleanedUp: number | null;
  discarded: { commits: number; ts: number } | null;
  /** The closing report was never even ASKED for — the agent behind the card was gone by the time the
   *  card was filed (a restart, a crash). It matters on the card because that same failure is what
   *  skips the automatic worktree cleanup: `WrapupCoordinator` only ever tidies up a wrapup it is
   *  waiting on, so a request that never landed leaves the checkout behind in silence. Cleared by a
   *  later wrapup that did get through. */
  wrapupUnasked: number | null;
  /** Brought back from done to settle a conflict its PR met after it was opened (ADR 0014). */
  reopened: number | null;
}

/**
 * Read a card's integration history out of its journal.
 *
 * The journal is append-only and durable, so this survives the branch, the worktree and the pane —
 * which is the whole point. A card whose work is merged and cleaned up has nothing left for `git` to
 * answer questions about, and "done" alone doesn't say whether the code ever landed.
 *
 * Nothing is polled and nothing is stored twice: the events were written when the actions happened.
 * A PR's *state* is deliberately absent — GitHub owns that, and a copy of it here would be a second
 * truth free to go stale. The link is what gets kept.
 *
 * Pure + exported for the test.
 */
export function integrationHistory(events: readonly BoardEvent[]): IntegrationHistory {
  const out: IntegrationHistory = {
    merged: null,
    pr: null,
    cleanedUp: null,
    discarded: null,
    wrapupUnasked: null,
    reopened: null,
  };
  // Oldest first in the journal, so a later event simply overwrites — the last merge is the one.
  for (const e of events) {
    const p = (e.payload ?? {}) as { base?: string; url?: string | null; commits?: number };
    if (e.type === "card.merged") out.merged = { base: p.base ?? "the base", ts: e.ts };
    else if (e.type === "card.pr_opened") out.pr = { url: p.url ?? null, ts: e.ts };
    else if (e.type === "card.cleaned_up") out.cleanedUp = e.ts;
    else if (e.type === "card.reopened") out.reopened = e.ts;
    else if (e.type === "card.discarded") out.discarded = { commits: p.commits ?? 0, ts: e.ts };
    else if (e.type === "wrapup.unasked") out.wrapupUnasked = e.ts;
    // A wrapup that WAS asked for clears it: the coordinator is on the case, so the silent-leftover
    // story this flag tells is no longer the one that happened. `wrapup.failed` — the OTHER failure,
    // where the note could not be read back — is deliberately not here: it clears the pending marker
    // and the automatic cleanup runs, so there is nothing left for the operator to finish.
    else if (e.type === "wrapup.requested") out.wrapupUnasked = null;
  }
  return out;
}

/**
 * The PR line's sentence: what the pull request IS, not the instant it was opened.
 *
 * `status` is null whenever GitHub could not be asked — no `gh`, no auth, no GitHub remote, offline —
 * and that case falls back to the one thing the journal can prove, which is when the PR was opened.
 * Degrading to the old wording is the point: a card that says "opened 4m ago" about a PR merged
 * hours ago is the bug this exists to kill, and an invented state would be the same bug again.
 *
 * Pure + exported for the test.
 */
export function prSentence(status: PrStatus | null, openedTs: number): string {
  if (status?.state === "merged") return `PR merged · ${timeAgo(status.mergedAt ?? openedTs)}`;
  if (status?.state === "closed") return `PR closed without merging · opened ${timeAgo(openedTs)}`;
  // ADR 0014: clean when opened, it can conflict later — after the card was filed and cleaned up.
  if (status?.conflicting) return `PR conflicts with its base · opened ${timeAgo(openedTs)}`;
  // Open, or unknown: both are honestly described by when it was opened.
  return `PR opened ${timeAgo(openedTs)}`;
}

/**
 * Name the PR link's button. Falls back to the generic wording rather than showing a bare url on a
 * phone: the number is nice, the link working is what matters. Pure + exported for the test.
 */
export function prLabel(url: string, verb = "View"): string {
  const n = /\/pull\/(\d+)/.exec(url)?.[1];
  return n ? `${verb} PR #${n}` : `${verb} the PR`;
}

/**
 * Does this card's declared predecessor still hold it back?
 *
 * MUST mirror `startCard`'s gate in `bridge/cards.ts` — `done` and `archived` release it, anything
 * else holds. A client that disagrees either greys out a button the server would have honoured, or
 * offers one that answers 409.
 *
 * `undefined` means the predecessor isn't on the board (deleted, archived out of the list): the
 * server clears `depends_on` when a predecessor is deleted, so nothing is waiting on a ghost.
 */
export function dependencyMet(predecessor: { status: CardStatus } | null | undefined): boolean {
  if (!predecessor) return true;
  return predecessor.status === "done" || predecessor.status === "archived";
}

export interface DependencyInfo {
  title: string;
  met: boolean;
}

/**
 * The predecessor a card declares, with whether it still holds the card back — i.e. exactly what a
 * tile needs to render its "after …" line, whether or not that dependency is still blocking. `undefined`
 * only when there is no predecessor to show at all (none declared, or it's gone from the board).
 *
 * Lives here rather than in either component because BOTH need it: a dependency can be set on any
 * card, so a top-level tile wants it as much as one nested in a group.
 */
export function dependencyInfo(card: CardView, byId: Map<string, CardView>): DependencyInfo | undefined {
  if (!card.dependsOn) return undefined;
  const predecessor = byId.get(card.dependsOn);
  if (!predecessor) return undefined;
  return { title: predecessor.title, met: dependencyMet(predecessor) };
}
