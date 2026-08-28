import { Fragment, useEffect, useRef, useState } from "react";
import { useLoaderData, useNavigate, useRevalidator, useSearchParams } from "react-router";
import { ListFilter, Plus, X } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { CardGroup } from "@/components/card-group";
import { CardTile } from "@/components/card-tile";
import { NonNominalPanel } from "@/components/non-nominal-panel";
import { TagFilter } from "@/components/tag-filter";
import { RepoFilter } from "@/components/repo-filter";
import { OriginFilter } from "@/components/origin-filter";
import { NewCardSheet } from "@/components/new-card-sheet";
import { boardEntries, dependencyInfo, entryKey, entryStatus } from "@/lib/board-groups";
import { StatusArea } from "@/components/status-area";
import { useIsDesktop } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import {
  BOARD_COLUMNS,
  BOARD_LANES,
  MANUAL_STATUSES,
  canDropCard,
  cardPath,
  createCard,
  loadRepoScope,
  matchesFilters,
  patchCard,
  positionFor,
  repoName,
  reposOf,
  saveRepoScope,
  tagsOf,
  type CardInput,
  type CardStatus,
  type CardView,
} from "@/lib/board";
import type { BoardData } from "@/lib/board-loaders";
import { setStatus } from "@/lib/status";

// The board: every card, grouped by lane, flow order left to right (or top to bottom on a phone).
//
// Redesign: mobile and desktop now share ONE structure — four lanes (BOARD_LANES), each a labelled
// section holding its columns' cards with no per-column sub-heading (the card's own status row
// carries that now, see card-tile.tsx). They used to diverge: mobile flattened to eight
// BOARD_COLUMNS sections in urgency order via a CSS `order-*` trick, desktop grouped by lane. That
// divergence is gone — a phone just stacks the four lane sections instead of laying them side by
// side, same DOM (which already leads with `blocked` inside "Doing" — urgency still wins within a
// lane). The one thing the phone still overrides is the ORDER those four stack in, and it is CSS
// only: `order-*` on the lane, `lg:order-none` to hand it back (see LANE_PHONE_ORDER).
//
// DRAGGING is the desktop's, and only in the columns a human owns anyway (`canDropCard`). Cards move
// between the live columns on their own — the bridge reconciles them against the herd every poll —
// so dragging one there would write a status the next poll undoes. It rides the PLATFORM's drag:
// `draggable` + dragover/drop, no library, because the whole feature is "read a slot off a drop and
// PATCH one card".
//
// Both moves are the same drop: BETWEEN columns changes `status`, WITHIN one changes only
// `position`, and a fractional rank (`positionFor`) means either is one PATCH on one card with no
// neighbours to renumber. Each COLUMN (not lane) stays its own drop target internally — a lane like
// "Doing" holds four columns, and a card still has to land in a specific one of them — the columns
// just no longer draw a seam between themselves.

/** Lane header dot colour — the tone a lane's own cards would use if any of them were "loud". */
const LANE_TONE: Record<string, string> = {
  "To do": "bg-brand",
  Doing: "bg-status-working",
  "To review": "bg-status-done",
  Done: "bg-status-idle",
};

/**
 * PHONE ONLY: the stacking order of the four lanes, reset to DOM order at `lg` (`lg:order-none`).
 *
 * Side by side, left-to-right IS the flow and nothing is buried, so the desktop keeps BOARD_LANES
 * order. Stacked, that same order puts the whole backlog above the fold and pushes the live work —
 * "Doing" and "To review", the two lanes you open the board FOR — below a screenful of cards you
 * were not going to act on. So on a phone the live lanes lead and "To do" sinks under them; "Done"
 * stays where settled work belongs, at the bottom. Every lane still renders, only the order moves.
 */
const LANE_PHONE_ORDER: Record<string, string> = {
  Doing: "order-1",
  "To review": "order-2",
  "To do": "order-3",
  Done: "order-4",
};

export function BoardRoute() {
  const data = useLoaderData() as BoardData;
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const desktop = useIsDesktop();
  // Both filters live in the URL, not in a useState — three things come free that a component state
  // doesn't have: they survive opening a card and coming back (the board unmounts in between, which
  // is exactly when losing the filter would be most annoying), the browser's Back button undoes
  // them, and a filtered board can be sent to yourself as a link. `replace` so a run of five tags
  // doesn't bury the way out of the board under five history entries.
  const [params, setParams] = useSearchParams();
  const active = params.get("tag");
  const activeRepo = params.get("repo");
  // Provenance, the third axis: `?origin=auto` keeps only what got filed without anyone asking —
  // the copilot's follow-ups AND the cards a working session opened mid-turn (ADR 0010), which is
  // one question and so one chip. A separate key rather than a value in `?tag=` because it IS
  // separate — a card has one tag and it answers what kind of work this is (ADR 0005), so folding
  // "who wrote it" into the same filter would make the two mutually exclusive for no reason.
  const autoOnly = params.get("origin") === "auto";
  // One key at a time, the rest of the query kept: the filters compose, so setting a tag must
  // not silently drop the repo scope it is narrowing.
  const setParam = (key: "tag" | "repo" | "origin", value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === null) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  const pick = (tag: string | null) => setParam("tag", tag);
  const pickAuto = (auto: boolean) => setParam("origin", auto ? "auto" : null);
  // The repo scope is also REMEMBERED (ADR 0006) — a tag is a momentary lens, a repo is where you
  // are working today, and the card page returns to a bare `/board` with no query on it.
  const pickRepo = (repo: string | null) => {
    saveRepoScope(repo);
    setParam("repo", repo);
  };
  /** Both filters off, in ONE navigation — two `setParam` calls in a row would race on the query. */
  const clearFilters = () => {
    saveRepoScope(null);
    setParams({}, { replace: true, preventScrollReset: true });
  };

  // …which is what this restores: a board opened with nothing in its URL comes up on the scope you
  // last chose. Once, on mount, and by writing the URL rather than shadowing it — otherwise the
  // address bar and the board would disagree about what is on screen.
  useEffect(() => {
    if (params.has("repo")) return;
    const last = loadRepoScope();
    if (last) setParam("repo", last);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only: this seeds, it doesn't sync.
  }, []);
  const [newOpen, setNewOpen] = useState(false);
  // The filter sheet — RepoFilter + TagFilter moved off the always-visible strips and behind one
  // toolbar chip (redesign §2), so a common board (one repo, few tags) shows no filter chrome by
  // default. Desktop keeps a SECOND, always-visible way to scope by repo (the sidebar list,
  // app-nav.tsx) — the sheet still works there too; the two just write the same `?repo=`.
  const [filterOpen, setFilterOpen] = useState(false);
  // The card in hand, and the SLOT under the pointer — which column, and at which index inside it.
  // View state, both of it, and both die with the drop; nothing about a drag is worth persisting.
  const [held, setHeld] = useState<{ id: string; from: CardStatus } | null>(null);
  const [over, setOver] = useState<{ status: CardStatus; index: number } | null>(null);
  // "A drop is in flight, don't tear the drag state down yet." A ref rather than state because
  // `dragend` fires in the same tick as the drop and would read a stale render's value.
  const landing = useRef(false);
  // The frame `held` is waiting on — see `arm` below, and cancelled by `dragend` so a gesture that
  // dies before that frame can't arm the board after the fact and leave it dressed for a drag.
  const arming = useRef(0);

  /**
   * Take the card in hand — ONE FRAME after `dragstart`, never in it.
   *
   * Chrome CANCELS a drag whose source loses its layout box while the gesture is still starting: you
   * get `dragstart` immediately followed by `dragend`, no `dragover`, no drop. And this state is
   * exactly what takes that box away — `held` hides the source tile (`hidden`, below) so the ghost
   * can stand in for it. React flushes a dragstart update in a microtask, which lands inside that
   * window; the next frame is outside it, and by then the drag is under way and immune.
   *
   * Nothing shows a frame late: `over` starts at the card's OWN slot, so the ghost appears exactly
   * where the card already is and both changes are invisible until the pointer actually moves.
   */
  const arm = (id: string, from: CardStatus, slot: number) => {
    arming.current = requestAnimationFrame(() => {
      setHeld({ id, from });
      setOver({ status: from, index: slot });
    });
  };

  // The repos on offer come from EVERY card, scoped or not — that strip is how you leave the repo
  // you are in, so it can't be narrowed by the scope it is meant to switch. Same "keep the active
  // one" rule as the tags below, and for the same reason.
  const reposInUse = reposOf(data.cards);
  const repos =
    activeRepo && !reposInUse.some((r) => r.path === activeRepo)
      ? [{ path: activeRepo, name: repoName(activeRepo) }, ...reposInUse]
      : reposInUse;
  // Repo first, so what follows describes the board you are actually looking at.
  const scoped = activeRepo ? data.cards.filter((c) => c.repoPath === activeRepo) : data.cards;

  // The tags on offer are DERIVED from the cards already on screen — no request, and it can't
  // disagree with what is rendered. From the SCOPED list, so the two strips never offer a
  // combination that is empty: inside a repo you are shown that repo's tags, and nothing else. The
  // active one is kept in the list even after its last card stops carrying it (retagged, deleted,
  // archived while you were looking, or now in another repo): otherwise the board empties and
  // simultaneously loses the only thing on screen saying why.
  const inUse = tagsOf(scoped);
  const tags = active && !inUse.includes(active) ? [active, ...inUse] : inUse;
  // The filter is applied HERE, before anything else reads the list, so every count, every column
  // and the empty state all describe the same board. A child whose container is filtered out stands
  // alone rather than vanishing — `boardEntries` already handles a missing parent that way.
  // Offered only when there is something to offer, from the SCOPED list — same rule as the tags
  // above, so the strip never proposes a combination that comes back empty.
  const hasAuto = scoped.some((c) => c.origin !== null);
  const cards = scoped.filter((c) => matchesFilters(c, { tag: active, autoOnly }));
  // Which repo a card comes from is worth saying only in the GLOBAL view, and only once there is
  // more than one — inside a scope the strip above already answers it for every tile at once.
  const showRepo = !activeRepo && repos.length > 1;
  // Whether the toolbar's Filter chip has anything to offer — mirrors the old strips' own
  // self-hiding rule, so the chip never opens onto an empty sheet.
  const hasFilters = repos.length > 1 || tags.length > 0 || hasAuto || autoOnly;

  // Cards first become ENTRIES, then get bucketed by column. On a phone a container and its
  // sub-tasks are ONE entry in the container's derived column; from `lg` up the sub-tasks scatter
  // into their own columns and the container stays behind as a summary tile — a column is a status,
  // so folding fifteen finished sub-tasks under a working parent left "Done" reading zero.
  const entries = boardEntries(cards, desktop);
  const byStatus = new Map(
    BOARD_COLUMNS.map((s) => [s, entries.filter((e) => entryStatus(e) === s)]),
  );
  // Every card, filtered or not: this answers "what is card X" for dependencies, parent names and
  // the drop's re-read — all of which are about cards the filter may well be hiding.
  const byId = new Map(data.cards.map((c) => [c.id, c]));
  const empty = cards.length === 0;
  async function create(input: CardInput) {
    await createCard(input);
    revalidator.revalidate();
  }

  // The drop. One PATCH on one card — the column it lands in and where it sits in that column.
  //
  // The drag state is held ON PURPOSE until the new data arrives, rather than cleared on release.
  // Clearing first unhides the card in its OLD slot and removes the ghost from the new one, so for
  // the ~100ms until revalidation the board shows the move undone — you see it snap back, then land.
  // Keeping both means the ghost simply IS the optimistic state: it is already the card, already in
  // the right slot, and it just gains its opacity back when the real one takes over. No second copy
  // of the board's data to re-sort, and a failed PATCH resolves to the truth by itself.
  async function drop(status: CardStatus, index: number, heldSlot: number) {
    const card = held;
    if (!card) return;
    const clear = () => {
      landing.current = false;
      setHeld(null);
      setOver(null);
    };
    // Re-read the card AS IT IS NOW, not as it was when the drag started. A poll lands every 1.5s
    // and a drag lasts longer than that, so the herd can pick the card up mid-gesture — and then
    // the whole safety argument (a manual column means no live agent) would be about a column the
    // card has already left. Rare, and exactly the case the guard exists for.
    const now = byId.get(card.id);
    if (!now || !canDropCard(now.status, status)) return clear();
    // Set BEFORE the first await: `dragend` fires on the source tile immediately after this drop,
    // synchronously, and its handler would otherwise wipe the state this whole comment is about.
    landing.current = true;
    // `index` counts slots in the rendered column, which still contains the dragged card (hidden).
    // `neighbours` counts them without it. Dropping BELOW its old slot therefore means one fewer
    // card above the landing spot than the rendered index says — the classic reorder off-by-one,
    // and the one that makes "nudge a card down by one" silently do nothing.
    const position = positionFor(
      neighbours(status, card.id),
      heldSlot >= 0 && index > heldSlot ? index - 1 : index,
    );
    try {
      // `status` is sent ONLY when it changes. The bridge routes any status through `setStatus`,
      // which closes the card's session and journals the move — harmless-looking on a reorder, and
      // wrong: every nudge inside a column would file a "moved to backlog" event that never happened.
      await patchCard(card.id, now.status === status ? { position } : { status, position });
    } catch (e) {
      setStatus((e as Error).message, "error", null);
    }
    await revalidator.revalidate();
    clear();
  }

  /**
   * A column's positions in board order, WITHOUT the dragged card — the slots it can land between.
   *
   * ponytail: under a tag filter these are the VISIBLE neighbours only, so a card dropped between
   * two of them lands somewhere among the hidden cards that sit in the same gap — right in the
   * filtered view, arbitrary within that gap once the filter comes off. Ordering against cards you
   * can't see has no correct answer anyway; if it ever matters, drop the filter and reorder.
   */
  function neighbours(status: CardStatus, dragged: string): number[] {
    return (byStatus.get(status) ?? [])
      .filter((e) => entryKey(e) !== dragged)
      .map((e) => (e.kind === "group" ? e.container.position : e.card.position));
  }

  /** Columns a card in hand may land in — its own included, where the landing is a reorder. */
  const dropTarget = (status: CardStatus) => held !== null && canDropCard(held.from, status);
  /** The card being dragged, for the ghost that previews where it lands. */
  const heldCard = held ? byId.get(held.id) : undefined;
  /** The repo name a tile shows, or nothing — see `showRepo`. */
  const repoLabel = (card: CardView) =>
    showRepo && card.repoPath ? repoName(card.repoPath) : undefined;

  // THE LANDING SPOT: the card itself, faded, in the exact slot it will occupy, pushing whatever is
  // below it down as it moves. Showing the real tile rather than a dashed rectangle answers "what am
  // I about to do" instead of "something will happen here", and it costs nothing — the tile is
  // already a pure function of a card. `inert` keeps it out of the tab order and out of every
  // pointer event, so it can never eat the drop it is advertising.
  const ghost = (card: CardView) => (
    <div inert className="opacity-50">
      <CardTile
        card={card}
        onClick={() => {}}
        dependency={dependencyInfo(card, byId)}
        repo={repoLabel(card)}
      />
    </div>
  );

  return (
    // No ceiling above `lg`. A board is a SPATIAL surface — its job is to show where everything
    // stands at a glance, and a centred 1440px column on a 27" display just hides a quarter of it
    // behind the fold for no reason. Prose is the thing that needs a maximum line length (the card
    // page keeps one); a grid of tiles does not, and CardTile's container queries mean the tiles
    // themselves re-lay out to whatever width the lane ends up with.
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col lg:max-w-none">
      <AppHeader
        title="Board"
        subtitle={`${cards.length} card${cards.length === 1 ? "" : "s"}`}
        rightLead={
          <>
            {/* The active repo scope, as its own removable chip — otherwise a scoped board (the
                common case, ADR 0006) shows no on-screen sign it's filtered at all until it's
                empty. Repo before tag: it's the coarser, remembered filter. */}
            {activeRepo && (
              <button
                type="button"
                onClick={() => pickRepo(null)}
                className="flex shrink-0 items-center gap-1 rounded-full border border-brand/35 bg-brand/16 py-[5px] pl-2.5 pr-2 text-xs font-semibold text-brand"
              >
                {repoName(activeRepo)}
                <X className="size-3" />
              </button>
            )}
            {/* The active tag, as its own removable chip — a tag is a momentary lens (unlike the
                repo scope, which is remembered and lives in the sidebar/repo list instead). */}
            {active && (
              <button
                type="button"
                onClick={() => pick(null)}
                className="flex shrink-0 items-center gap-1 rounded-full border border-brand/35 bg-brand/16 py-[5px] pl-2.5 pr-2 text-xs font-semibold text-brand"
              >
                {active}
                <X className="size-3" />
              </button>
            )}
            {/* Same removable chip, third axis. Says "auto" rather than "copilot": the tiles use
                that word for "the copilot has this card RIGHT NOW", which is a different fact. */}
            {autoOnly && (
              <button
                type="button"
                onClick={() => pickAuto(false)}
                className="flex shrink-0 items-center gap-1 rounded-full border border-brand/35 bg-brand/16 py-[5px] pl-2.5 pr-2 text-xs font-semibold text-brand"
              >
                auto
                <X className="size-3" />
              </button>
            )}
            {hasFilters && (
              <button
                type="button"
                onClick={() => setFilterOpen(true)}
                aria-label="Filter the board"
                className="flex shrink-0 items-center gap-1 rounded-full border border-brand/35 bg-brand/16 px-2.5 py-[5px] text-xs font-semibold text-brand"
              >
                <ListFilter className="size-[13px]" />
                Filter
              </button>
            )}
          </>
        }
        rightTrail={
          <Button
            variant="brand"
            className="h-9 gap-1.5 rounded-[10px] px-3 text-sm font-semibold sm:px-3.5"
            onClick={() => setNewOpen(true)}
          >
            <Plus className="size-4" />
            <span className="hidden sm:inline">New card</span>
          </Button>
        }
      />

      {/* One scroller on a phone (the whole board), FOUR on a wide screen (one per lane) — the
          outer one is switched off at `lg` and each lane takes over. Without this, seventeen cards
          in "In progress" make you scroll a very long page past three empty columns, which is the
          one thing a board laid out in columns is supposed to spare you. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
        <main className="flex flex-1 flex-col gap-6 px-3 pb-24 pt-3 lg:grid lg:min-h-0 lg:grid-cols-4 lg:gap-4 lg:bg-muted lg:p-5 lg:pb-5 dark:lg:bg-[oklch(0.165_0.006_250)]">
          {/* The screen's one h1 — the toolbar already says "Board". */}
          <h1 className="sr-only">Board</h1>
          {empty ? (
            <div className="px-3 py-6 lg:col-span-4">
              {/* "Nothing here" and "nothing here MATCHES" are different facts, and telling a
                  filtered board from an empty one is the whole hazard of adding a filter. Both
                  filters get named — with a remembered repo scope, "no cards" can now greet you on
                  a board that opened filtered without you touching anything this session. */}
              {active || activeRepo || autoOnly ? (
                <>
                  <NonNominalPanel tone="muted" title="Aucune carte qui corresponde">
                    Aucune carte
                    {autoOnly && <> créée automatiquement</>}
                    {activeRepo && (
                      <>
                        {" "}
                        dans <span className="font-medium text-foreground">{repoName(activeRepo)}</span>
                      </>
                    )}
                    {active && (
                      <>
                        {" "}
                        taguée «&nbsp;<span className="font-medium text-foreground">{active}</span>&nbsp;»
                      </>
                    )}
                    .
                  </NonNominalPanel>
                  <Button variant="outline" className="mt-3" onClick={clearFilters}>
                    Show all cards
                  </Button>
                </>
              ) : (
                <NonNominalPanel tone="muted" title="Aucune carte">
                  A card is a task that outlives the pane working on it.
                </NonNominalPanel>
              )}
            </div>
          ) : (
            BOARD_LANES.map((lane) => {
              const total = lane.statuses.reduce((n, s) => n + (byStatus.get(s)?.length ?? 0), 0);
              return (
                <div
                  key={lane.label}
                  className={cn(
                    "flex flex-col gap-2.5 lg:order-none lg:h-full lg:min-w-0 lg:overflow-hidden lg:rounded-2xl lg:border lg:border-border/60 lg:bg-background lg:p-3",
                    LANE_PHONE_ORDER[lane.label],
                  )}
                >
                  {/* The lane's own heading exists only once there are lanes. An EMPTY lane still
                      renders it: four columns that keep their places are what makes a board
                      scannable, and a column that disappears when it empties moves the other three.
                      Shown on BOTH breakpoints now — the per-column sub-heading that used to carry
                      this on a phone is gone (each card's own status row says it instead). Sticky on
                      desktop, where the lane scrolls under it; a plain in-flow heading on mobile,
                      where the whole page is the one scroller. */}
                  <div className="flex items-center gap-2 lg:sticky lg:top-0 lg:z-10 lg:bg-background lg:pb-1">
                    <span
                      aria-hidden
                      className={cn("size-2 shrink-0 rounded-full", LANE_TONE[lane.label])}
                    />
                    <span className="text-xs font-bold uppercase tracking-[0.08em]">
                      {lane.label}
                    </span>
                    <span className="rounded-full bg-muted px-[7px] py-px text-[11px] font-semibold tabular-nums text-muted-foreground">
                      {total}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                    {lane.statuses.map((status) => {
                      const column = byStatus.get(status) ?? [];
                      const target = dropTarget(status);
                      // An empty column is hidden — except while it is somewhere a card in hand
                      // could GO. Without this, moving the last card out of Ready makes Ready
                      // disappear, and with it any way to drag one back.
                      if (column.length === 0 && !target) return null;
                      // The dragged card stays IN the list and is hidden with `display:none` rather
                      // than filtered out of it. Removing it from the tree unmounts its DOM node,
                      // and an unmounted node never receives `dragend` — so an Escape or a drop in
                      // the margin would leave the board stuck in drag state forever. Hidden, the
                      // node lives, the layout behaves as if it were gone, and its slot still counts
                      // (see `heldSlot`, which is what keeps the index arithmetic honest). Hiding it
                      // is still a box the drag's own source loses, which is why `arm` waits a frame
                      // before `held` is set at all — that wait is what keeps the drag alive.
                      const ghostAt = over?.status === status ? over.index : -1;
                      const heldSlot = held ? column.findIndex((e) => entryKey(e) === held.id) : -1;
                      return (
                        <section
                          key={status}
                          onDragOver={
                            target
                              ? (e) => {
                                  // preventDefault IS the "yes, you may drop here" — without it the
                                  // browser refuses the drop and animates the card back.
                                  e.preventDefault();
                                  e.dataTransfer.dropEffect = "move";
                                  // ENTERING the column, not moving inside it. The tiles own the
                                  // slot once the pointer is in here (each stops the event, see
                                  // below), so this only ever answers "you arrived somewhere that
                                  // isn't a tile" — the padding, the gap between two cards, or the
                                  // ghost itself, which is `inert` and lets every event fall through
                                  // to here.
                                  //
                                  // It MUST NOT overwrite a slot this column already has: the ghost
                                  // sits under the pointer by definition, so recomputing on every
                                  // dragover made the slot flip between "where you are" and "at the
                                  // end" a few times a second — the flicker.
                                  setOver((o) =>
                                    o?.status === status ? o : { status, index: column.length },
                                  );
                                }
                              : undefined
                          }
                          onDragLeave={
                            target
                              ? (e) => {
                                  // `dragleave` fires on every hop between children too, and
                                  // clearing the highlight there makes it strobe as the pointer
                                  // crosses the cards inside the column. Only a leave that actually
                                  // exits counts.
                                  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                                  setOver((o) => (o?.status === status ? null : o));
                                }
                              : undefined
                          }
                          onDrop={
                            target
                              ? () => void drop(status, ghostAt < 0 ? column.length : ghostAt, heldSlot)
                              : undefined
                          }
                          className={cn(
                            "flex flex-col gap-2",
                            // `-outline-offset-2` draws the outline INSIDE the box — an outline is
                            // painted outside by default, and a lane can be its own scroller now, so
                            // outside would mean clipped on both edges. The min-height is just
                            // enough to aim at when the column is empty; the ghost is what gives it
                            // real volume once you're over it. No text label any more (there is no
                            // sub-heading left to explain "here" by name) — the dashed outline is
                            // its own affordance, and it only ever shows while a compatible drag is
                            // in flight.
                            target &&
                              "rounded-xl p-2 outline-1 -outline-offset-2 outline-dashed outline-border transition-colors",
                            // Thickness, not tint: `accent` sits 3% off `background`, which is not a
                            // signal — the ring colour on a doubled outline is.
                            over?.status === status && "bg-accent outline-2 outline-ring",
                          )}
                        >
                          {column.length === 0 && ghostAt < 0 && <div className="h-10" />}
                          {column.map((entry, slot) => (
                            <Fragment key={entryKey(entry)}>
                              {slot === ghostAt && heldCard && ghost(heldCard)}
                              {/* The wrapper exists for one line: which HALF of a tile the pointer
                                  is on decides whether the card lands above it or below it. Without
                                  it the column only knows "somewhere in here", which is enough to
                                  move between columns and not enough to order within one. It stops
                                  the event so the section's own handler doesn't overwrite the index
                                  with "at the end" on the way up. */}
                              <div
                                className={cn(held?.id === entryKey(entry) && "hidden")}
                                onDragOver={
                                  target
                                    ? (e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        e.dataTransfer.dropEffect = "move";
                                        const r = e.currentTarget.getBoundingClientRect();
                                        const above = e.clientY < r.top + r.height / 2;
                                        setOver({ status, index: above ? slot : slot + 1 });
                                      }
                                    : undefined
                                }
                              >
                                {entry.kind === "group" ? (
                                  // A container is not dragged: its column is DERIVED from its
                                  // sub-tasks, so moving it by hand would be a status nothing keeps.
                                  <CardGroup
                                    container={entry.container}
                                    subTasks={entry.children}
                                    byId={byId}
                                    onOpen={(cardId) => navigate(cardPath(cardId))}
                                    summaryOnly={desktop}
                                    showRepo={showRepo}
                                  />
                                ) : (
                                  <CardTile
                                    card={entry.card}
                                    onClick={() => navigate(cardPath(entry.card.id))}
                                    dependency={dependencyInfo(entry.card, byId)}
                                    repo={repoLabel(entry.card)}
                                    // Only while scattered — under a container on a phone, the tile
                                    // is already sitting inside the thing this would name.
                                    parent={
                                      desktop && entry.card.parentId
                                        ? byId.get(entry.card.parentId)?.title
                                        : undefined
                                    }
                                    // Unconditional, unlike `parent`: a follow-up is never folded
                                    // under the card it came from (that link is not `parentId` —
                                    // see Card.originCardId), so nothing else on any screen says
                                    // it. A deleted source resolves to nothing and the caption
                                    // simply doesn't render.
                                    source={
                                      entry.card.originCardId
                                        ? byId.get(entry.card.originCardId)?.title
                                        : undefined
                                    }
                                    // Desktop only, and only from a column a human owns. `runtime`
                                    // is belt-and-braces on top of that: a card with a live pane is
                                    // never in a manual column, and if one ever were, dragging it
                                    // away is the one move that could send its agent home.
                                    drag={
                                      desktop &&
                                      !entry.card.runtime &&
                                      MANUAL_STATUSES.includes(status)
                                        ? {
                                            // Deferred by a frame, and that is load-bearing — see
                                            // `arm`. The ghost starts at the card's own slot, so
                                            // lifting it changes nothing on screen until you
                                            // actually move.
                                            onStart: () => arm(entry.card.id, status, slot),
                                            // Cancels only. A `dragend` that follows a real drop
                                            // must leave the state alone — the drop owns it until
                                            // the new data lands.
                                            onEnd: () => {
                                              cancelAnimationFrame(arming.current);
                                              if (landing.current) return;
                                              setHeld(null);
                                              setOver(null);
                                            },
                                          }
                                        : undefined
                                    }
                                  />
                                )}
                              </div>
                            </Fragment>
                          ))}
                          {ghostAt >= column.length && heldCard && ghost(heldCard)}
                        </section>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </main>
      </div>

      {/* Status line, above the mobile tab bar. Raised clear of it (app-nav.tsx), which now owns
          that edge below `lg`. New card moved into the toolbar as the primary action — no floating
          FAB any more. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-14 z-30 mx-auto w-full max-w-screen-sm px-3 pb-[calc(env(safe-area-inset-bottom)_+_0.75rem)] lg:bottom-0 lg:max-w-none">
        <StatusArea />
      </div>

      {/* The filter sheet: repo scope above tag, coarse then fine, same two components the board
          used to show as always-visible strips — just behind one tap now (redesign §2: "this removes
          two always-visible strips"). */}
      <BottomSheet open={filterOpen} onClose={() => setFilterOpen(false)} title="Filter">
        <div className="-mx-4 flex flex-col">
          <RepoFilter repos={repos} active={activeRepo} onPick={pickRepo} />
          <TagFilter tags={tags} active={active} onPick={pick} />
          <OriginFilter has={hasAuto} active={autoOnly} onPick={pickAuto} />
        </div>
      </BottomSheet>

      {/* The same list the filter strip offers, deliberately: what you can narrow the board to and
          what you can tag a new card with are one inventory, and deriving it twice is how they
          drift. It includes the active tag even after its last card stopped carrying it — which is
          exactly when you would be creating a card to put it back. */}
      <NewCardSheet
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreate={create}
        tags={tags}
        // Same argument one axis over: a board scoped to a repo is a statement about where you are
        // working, so the card you add from it starts there rather than in the last repo carded.
        repoPath={activeRepo}
      />
    </div>
  );
}
