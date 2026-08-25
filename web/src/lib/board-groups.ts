import type { BoardEvent, CardStatus, CardView, PrStatus } from "./board";
import { timeAgo } from "./format";

// Turning the flat card list into what the board renders.
//
// A dictated note that named three tasks becomes a CONTAINER card plus its children (see
// ARCHITECTURE.md → "Splitting one dump into several cards"). The board groups by STATUS, and a
// container's children can sit in different columns from it — so something has to give.
//
// WHICH thing gives depends on how many columns are on screen, and it is the same argument as the
// board layout itself:
//
// - ONE column (a phone): the children's individual placement gives. The group is atomic and lands
//   in the container's derived column, which is exactly what that derivation is for ("does anything
//   under here need me"). Seventeen children of one dictation, strung out in a single vertical list
//   between unrelated cards, is the mess grouping exists to prevent.
// - FOUR columns (a wide screen): the grouping gives. A column IS a status, so folding children into
//   their parent's column removes them from the only sort the board performs — and it lies: fifteen
//   finished sub-tasks left "Done" reading zero. The container stays, collapsed to its title and its
//   per-status chips, as the way back to the dictation it came from.
//
// Nothing here is stored: the shape is read off the flat list on every render.

export type BoardEntry =
  | { kind: "card"; card: CardView }
  | { kind: "group"; container: CardView; children: CardView[] };

/**
 * Group the board's cards into top-level entries, preserving the server's order.
 *
 * A child is folded into its container and does NOT appear at top level — unless its container is
 * missing from the list (archived, or filtered out), in which case it stands alone rather than
 * vanishing. A card that has no children and no visible parent is an ordinary tile, which is the
 * overwhelming majority: grouping is an exception in the layout, not a new default.
 *
 * `scatter` is the wide-screen reading (see the note at the top of this file): children ALSO come
 * back as top-level entries, so each one lands in its own status column. The group entry stays —
 * the caller renders it collapsed, as a summary — so a container never becomes unreachable and its
 * derived status still has somewhere to show.
 */
export function boardEntries(cards: CardView[], scatter = false): BoardEntry[] {
  const present = new Set(cards.map((c) => c.id));
  const childrenOf = new Map<string, CardView[]>();
  for (const card of cards) {
    if (!card.parentId || !present.has(card.parentId)) continue;
    const list = childrenOf.get(card.parentId);
    if (list) list.push(card);
    else childrenOf.set(card.parentId, [card]);
  }

  const entries: BoardEntry[] = [];
  for (const card of cards) {
    const children = childrenOf.get(card.id);
    if (children) {
      entries.push({ kind: "group", container: card, children });
      continue;
    }
    // Folded into its container above — skip it here so it isn't rendered twice. Unless we're
    // scattering, where the fold is exactly what we don't want.
    if (!scatter && card.parentId && childrenOf.has(card.parentId)) continue;
    entries.push({ kind: "card", card });
  }
  return entries;
}

/** The column an entry belongs to: a group follows its container's derived status. */
export function entryStatus(entry: BoardEntry): CardStatus {
  return entry.kind === "group" ? entry.container.status : entry.card.status;
}

/** A stable key for React — the container's id identifies the group. */
export function entryKey(entry: BoardEntry): string {
  return entry.kind === "group" ? entry.container.id : entry.card.id;
}

/**
 * Columns where a group opens by itself.
 *
 * The collapse state follows the COLUMN'S JOB, and that is not a matter of taste. Backlog and Done
 * are for triage and for filing: one row per dictation is what you want, and five rows for one
 * thought is the mess this whole feature exists to clean up. The live columns are for acting, and
 * hiding a blocked sub-task behind a chevron would put an extra tap on the single most urgent thing
 * on the board — the exact opposite of what this app is for.
 */
const OPEN_BY_DEFAULT: readonly CardStatus[] = [
  "starting",
  "working",
  "blocked",
  "review",
  "orphaned",
];

export function groupOpenByDefault(status: CardStatus): boolean {
  return OPEN_BY_DEFAULT.includes(status);
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
  const out: IntegrationHistory = { merged: null, pr: null, cleanedUp: null, discarded: null };
  // Oldest first in the journal, so a later event simply overwrites — the last merge is the one.
  for (const e of events) {
    const p = (e.payload ?? {}) as { base?: string; url?: string | null; commits?: number };
    if (e.type === "card.merged") out.merged = { base: p.base ?? "the base", ts: e.ts };
    else if (e.type === "card.pr_opened") out.pr = { url: p.url ?? null, ts: e.ts };
    else if (e.type === "card.cleaned_up") out.cleanedUp = e.ts;
    else if (e.type === "card.discarded") out.discarded = { commits: p.commits ?? 0, ts: e.ts };
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
  // Open, or unknown: both are honestly described by when it was opened.
  return `PR opened ${timeAgo(openedTs)}`;
}

/**
 * Name the PR link's button. Falls back to the generic wording rather than showing a bare url on a
 * phone: the number is nice, the link working is what matters. Pure + exported for the test.
 */
export function prLabel(url: string): string {
  const n = /\/pull\/(\d+)/.exec(url)?.[1];
  return n ? `View PR #${n}` : "View the PR";
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
