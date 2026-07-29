import type { CardStatus, CardView } from "./board";

// Turning the flat card list into what the board renders.
//
// A dictated note that named three tasks becomes a CONTAINER card plus its children (see
// ARCHITECTURE.md → "Splitting one dump into several cards"). The board groups by STATUS, and a
// container's children can sit in different columns from it — so something has to give. What gives
// is the children's individual placement: the group is atomic and lands in the container's derived
// column, which is exactly what that derivation is for ("does anything under here need me").
//
// The alternative — children scattered into their own columns with a breadcrumb — loses the fact
// that they are one piece of work, and makes the container's derived status pointless.
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
 */
export function boardEntries(cards: CardView[]): BoardEntry[] {
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
    // Folded into its container above — skip it here so it isn't rendered twice.
    if (card.parentId && childrenOf.has(card.parentId)) continue;
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

/**
 * The predecessor's title when it still holds this card back, else undefined — i.e. exactly what a
 * tile needs to render its "after …" line, and nothing when there is nothing to say.
 *
 * Lives here rather than in either component because BOTH need it: a dependency can be set on any
 * card, so a top-level tile wants it as much as one nested in a group.
 */
export function waitingOn(card: CardView, byId: Map<string, CardView>): string | undefined {
  if (!card.dependsOn) return undefined;
  const predecessor = byId.get(card.dependsOn);
  return dependencyMet(predecessor) ? undefined : predecessor?.title;
}
