import { Fragment, useRef, useState } from "react";
import { useLoaderData, useNavigate, useRevalidator, useRouteLoaderData } from "react-router";
import { Plus } from "lucide-react";

import { AppHeader, SettingsGear } from "@/components/app-header";
import { SectionLabel } from "@/components/ui/section-label";
import { Button } from "@/components/ui/button";
import { CardGroup } from "@/components/card-group";
import { CardTile } from "@/components/card-tile";
import { NewCardSheet } from "@/components/new-card-sheet";
import { boardEntries, dependencyInfo, entryKey, entryStatus } from "@/lib/board-groups";
import { StatusArea } from "@/components/status-area";
import { useLoadingStalled } from "@/hooks/use-loading-stalled";
import { useIsDesktop } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import {
  BOARD_COLUMNS,
  BOARD_LANES,
  CARD_STATUS_LABEL,
  MANUAL_STATUSES,
  canDropCard,
  cardPath,
  createCard,
  patchCard,
  positionFor,
  type CardInput,
  type CardStatus,
  type CardView,
} from "@/lib/board";
import type { BoardData } from "@/lib/board-loaders";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { homePath } from "@/lib/nav";
import { setStatus } from "@/lib/status";

// The board: every card, grouped by column, urgency first.
//
// On a PHONE, deliberately a single vertical scroll of labelled sections rather than side-by-side
// Kanban columns: a phone has one column of usable width, and horizontal panning to find the card
// that needs you is exactly the interaction this whole project exists to avoid.
//
// From `lg` up that argument stops applying — the screen HAS the columns — so the same sections lay
// out as four lanes (BOARD_LANES), left to right in the order work moves through them. Same DOM
// either way: each lane is `display: contents` below the breakpoint, which drops it out of the
// layout entirely and leaves the phone's flat list of sections exactly as it was, and `order-*`
// keeps that list in BOARD_COLUMNS order — urgency first, which is the right axis when only one
// column fits on screen.
//
// DRAGGING is the desktop's, and only in the columns a human owns anyway (`canDropCard`). Cards move
// between the live columns on their own — the bridge reconciles them against the herd every poll —
// so dragging one there would write a status the next poll undoes. It rides the PLATFORM's drag:
// `draggable` + dragover/drop, no library, because the whole feature is "read a slot off a drop and
// PATCH one card".
//
// Both moves are the same drop: BETWEEN columns changes `status`, WITHIN one changes only
// `position`, and a fractional rank (`positionFor`) means either is one PATCH on one card with no
// neighbours to renumber.
// Phone order, restored by hand: written as literals because Tailwind only ever sees the source
// text, and indexed by BOARD_COLUMNS so the two can't drift.
const MOBILE_ORDER = [
  "order-1",
  "order-2",
  "order-3",
  "order-4",
  "order-5",
  "order-6",
  "order-7",
  "order-8",
];

export function BoardRoute() {
  const data = useLoaderData() as BoardData;
  // The root loader is still the connection source of truth — the board rides its poll.
  const root = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData | undefined;
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const stalled = useLoadingStalled();
  const desktop = useIsDesktop();
  const [newOpen, setNewOpen] = useState(false);
  // The card in hand, and the SLOT under the pointer — which column, and at which index inside it.
  // View state, both of it, and both die with the drop; nothing about a drag is worth persisting.
  const [held, setHeld] = useState<{ id: string; from: CardStatus } | null>(null);
  const [over, setOver] = useState<{ status: CardStatus; index: number } | null>(null);
  // "A drop is in flight, don't tear the drag state down yet." A ref rather than state because
  // `dragend` fires in the same tick as the drop and would read a stale render's value.
  const landing = useRef(false);

  // Cards first become ENTRIES, then get bucketed by column. On a phone a container and its
  // sub-tasks are ONE entry in the container's derived column; from `lg` up the sub-tasks scatter
  // into their own columns and the container stays behind as a summary tile — a column is a status,
  // so folding fifteen finished sub-tasks under a working parent left "Done" reading zero.
  const entries = boardEntries(data.cards, desktop);
  const byStatus = new Map(
    BOARD_COLUMNS.map((s) => [s, entries.filter((e) => entryStatus(e) === s)]),
  );
  const byId = new Map(data.cards.map((c) => [c.id, c]));
  const empty = data.cards.length === 0;
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

  /** A column's positions in board order, WITHOUT the dragged card — the slots it can land between. */
  function neighbours(status: CardStatus, dragged: string): number[] {
    return (byStatus.get(status) ?? [])
      .filter((e) => entryKey(e) !== dragged)
      .map((e) => (e.kind === "group" ? e.container.position : e.card.position));
  }

  /** Columns a card in hand may land in — its own included, where the landing is a reorder. */
  const dropTarget = (status: CardStatus) => held !== null && canDropCard(held.from, status);
  /** The card being dragged, for the ghost that previews where it lands. */
  const heldCard = held ? byId.get(held.id) : undefined;

  // THE LANDING SPOT: the card itself, faded, in the exact slot it will occupy, pushing whatever is
  // below it down as it moves. Showing the real tile rather than a dashed rectangle answers "what am
  // I about to do" instead of "something will happen here", and it costs nothing — the tile is
  // already a pure function of a card. `inert` keeps it out of the tab order and out of every
  // pointer event, so it can never eat the drop it is advertising.
  const ghost = (card: CardView) => (
    <div inert className="opacity-50">
      <CardTile card={card} onClick={() => {}} dependency={dependencyInfo(card, byId)} />
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
        bridge={root?.bridge}
        error={root?.error ?? data.error}
        stalled={stalled}
        onHome={() => navigate(homePath(root?.session))}
        rightLead={<SectionLabel className="pr-1">Board</SectionLabel>}
        rightTrail={<SettingsGear session={root?.session} />}
      />

      {/* One scroller on a phone (the whole board), FOUR on a wide screen (one per lane) — the
          outer one is switched off at `lg` and each lane takes over. Without this, seventeen cards
          in "In progress" make you scroll a very long page past three empty columns, which is the
          one thing a board laid out in columns is supposed to spare you. Note the lanes stretch
          now (no `items-start`): a lane has to fill the row before `h-full` means anything. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
        <main className="flex flex-1 flex-col pb-24 lg:grid lg:min-h-0 lg:grid-cols-4 lg:gap-x-3 lg:px-3 lg:pb-0">
          {/* The screen's one h1 — the header already says "Board", but as a SectionLabel span. */}
          <h1 className="sr-only">Board</h1>
          {empty ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground lg:col-span-4">
              <p>No cards yet.</p>
              <p className="mt-1">A card is a task that outlives the pane working on it.</p>
            </div>
          ) : (
            BOARD_LANES.map((lane) => {
              const total = lane.statuses.reduce((n, s) => n + (byStatus.get(s)?.length ?? 0), 0);
              return (
                <div
                  key={lane.label}
                  className="contents lg:block lg:h-full lg:min-w-0 lg:overflow-y-auto lg:pb-24"
                >
                  {/* The lane's own heading exists only once there are lanes. An EMPTY lane still
                      renders it: four columns that keep their places are what makes a board
                      scannable, and a column that disappears when it empties moves the other three.
                      Sticky, now that the lane scrolls under it — a column whose name scrolls away
                      leaves you reading cards with no idea which pile they are in. */}
                  <div className="hidden items-baseline gap-2 pb-2 pt-4 lg:flex lg:sticky lg:top-0 lg:z-10 lg:bg-background">
                    <SectionLabel>{lane.label}</SectionLabel>
                    <span className="text-xs text-muted-foreground/70">{total}</span>
                  </div>
                  {lane.statuses.map((status, i) => {
                    const column = byStatus.get(status) ?? [];
                    const target = dropTarget(status);
                    // An empty column is hidden — except while it is somewhere a card in hand could
                    // GO. Without this, moving the last card out of Ready makes Ready disappear, and
                    // with it any way to drag one back.
                    if (column.length === 0 && !target) return null;
                    // The dragged card stays IN the list and is hidden with `display:none` rather
                    // than filtered out of it. Removing it from the tree unmounts its DOM node, and
                    // an unmounted node never receives `dragend` — so an Escape or a drop in the
                    // margin would leave the board stuck in drag state forever. Hidden, the node
                    // lives, the layout behaves as if it were gone, and its slot still counts (see
                    // `heldSlot`, which is what keeps the index arithmetic honest).
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
                                // ENTERING the column, not moving inside it. The tiles own the slot
                                // once the pointer is in here (each stops the event, see below), so
                                // this only ever answers "you arrived somewhere that isn't a tile"
                                // — the padding, the gap between two cards, or the ghost itself,
                                // which is `inert` and lets every event fall through to here.
                                //
                                // It MUST NOT overwrite a slot this column already has: the ghost
                                // sits under the pointer by definition, so recomputing on every
                                // dragover made the slot flip between "where you are" and "at the
                                // end" a few times a second — the flicker.
                                setOver((o) => (o?.status === status ? o : { status, index: column.length }));
                              }
                            : undefined
                        }
                        onDragLeave={
                          target
                            ? (e) => {
                                // `dragleave` fires on every hop between children too, and clearing
                                // the highlight there makes it strobe as the pointer crosses the
                                // cards inside the column. Only a leave that actually exits counts.
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
                          "px-3 pt-4 lg:order-none lg:px-0 lg:pt-3",
                          MOBILE_ORDER[BOARD_COLUMNS.indexOf(status)],
                          // `-outline-offset-2` draws the outline INSIDE the box. An outline is
                          // painted outside by default, and now that each lane is its own
                          // `overflow-y-auto` scroller, outside means clipped on both edges.
                          // The min-height is just enough to aim at when the column is empty; the
                          // ghost below is what gives it real volume once you're over it.
                          // `p-2` on all four sides, not `px`: the section's own padding is `pt-3`
                          // with nothing at the bottom, which is invisible until a frame is drawn
                          // around it — then the top breathes and the last card sits on the line.
                          // Symmetric padding is what makes the outline read as a box holding the
                          // cards rather than as a box that ends slightly wrong.
                          target &&
                            "rounded-xl outline-1 -outline-offset-2 outline-dashed outline-border transition-colors lg:min-h-16 lg:p-2",
                          // Thickness, not tint: `accent` sits 3% off `background`, which is not a
                          // signal — the ring colour on a doubled outline is.
                          over?.status === status && "bg-accent outline-2 outline-ring",
                        )}
                      >
                        {/* Hidden only when it is the lane's FIRST column and repeats its name
                            ("Done" under Done) — dropping a heading further down would leave the
                            cards above it unlabelled. Everywhere else it stays, which is what keeps
                            `starting` legible as its own thing inside "Doing". */}
                        <div
                          className={cn(
                            "flex items-baseline gap-2 pb-2",
                            i === 0 && CARD_STATUS_LABEL[status] === lane.label && "lg:hidden",
                          )}
                        >
                          <SectionLabel>{CARD_STATUS_LABEL[status]}</SectionLabel>
                          <span className="text-xs text-muted-foreground/70">{column.length}</span>
                        </div>
                        <div className="flex flex-col gap-2">
                          {column.length === 0 && ghostAt < 0 && (
                            <p className="py-3 text-center text-xs text-muted-foreground">
                              Drop here to move to {CARD_STATUS_LABEL[status].toLowerCase()}
                            </p>
                          )}
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
                                  />
                                ) : (
                                  <CardTile
                                    card={entry.card}
                                    onClick={() => navigate(cardPath(entry.card.id))}
                                    dependency={dependencyInfo(entry.card, byId)}
                                    // Only while scattered — under a container on a phone, the tile
                                    // is already sitting inside the thing this would name.
                                    parent={
                                      desktop && entry.card.parentId
                                        ? byId.get(entry.card.parentId)?.title
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
                                            onStart: () => {
                                              setHeld({ id: entry.card.id, from: status });
                                              // Start the ghost exactly where the card already is,
                                              // so lifting it changes nothing on screen until you
                                              // actually move — the card fades, the layout holds.
                                              setOver({ status, index: slot });
                                            },
                                            // Cancels only. A `dragend` that follows a real drop
                                            // must leave the state alone — the drop owns it until
                                            // the new data lands.
                                            onEnd: () => {
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
                        </div>
                      </section>
                    );
                  })}
                </div>
              );
            })
          )}
        </main>
      </div>

      {/* New-card FAB, above the status line. One tap from anywhere on the board. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-screen-sm px-3 pb-[calc(env(safe-area-inset-bottom)_+_0.75rem)] lg:max-w-none">
        <div className="pointer-events-auto flex justify-end pb-2">
          <Button onClick={() => setNewOpen(true)} className="h-12 gap-2 rounded-full px-5 shadow-lg">
            <Plus className="size-4" />
            New card
          </Button>
        </div>
        <StatusArea />
      </div>

      <NewCardSheet open={newOpen} onClose={() => setNewOpen(false)} onCreate={create} />
    </div>
  );
}

