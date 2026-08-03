import { useState } from "react";
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
  type CardInput,
  type CardStatus,
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
// out as four lanes (BOARD_LANES). Same DOM either way: each lane is `display: contents` below the
// breakpoint, which drops it out of the layout entirely and leaves the phone's flat list of sections
// exactly as it was. `order-*` is what keeps that list in BOARD_COLUMNS order, since folding
// `orphaned` into the "Needs you" lane moves it earlier in the source.
//
// DRAGGING is the desktop's, and only between the columns a human owns anyway (`canDropCard`).
// Cards move between the live columns on their own — the bridge reconciles them against the herd
// every poll — so dragging one there would write a status the next poll undoes. It rides the
// PLATFORM's drag: `draggable` + dragover/drop, no library, because the whole feature is "read an
// id off a drop and PATCH one field".
//
// NOT reordering inside a column, which is a different feature wearing the same gesture. The board
// does order by `card.position` and the field is patchable, so it is possible — but `position` is an
// INTEGER and new cards take `min - 1`, so dropping BETWEEN two adjacent rows has nowhere to sit
// without renumbering their neighbours, and the API patches one card per request. That is a
// batch-move endpoint (or a fractional rank), not a drop handler.
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
  // The card in hand, and the column under the pointer. Both are view state and both die with the
  // drop — nothing about a drag is worth persisting.
  const [held, setHeld] = useState<{ id: string; from: CardStatus } | null>(null);
  const [over, setOver] = useState<CardStatus | null>(null);

  // Cards first become ENTRIES — a split container and its sub-tasks are one entry, placed in the
  // container's derived column — and only then get bucketed by column.
  const entries = boardEntries(data.cards);
  const byStatus = new Map(
    BOARD_COLUMNS.map((s) => [s, entries.filter((e) => entryStatus(e) === s)]),
  );
  const byId = new Map(data.cards.map((c) => [c.id, c]));
  const empty = data.cards.length === 0;
  async function create(input: CardInput) {
    await createCard(input);
    revalidator.revalidate();
  }

  // The drop. Same one-field PATCH the card page's "Move to" sends — including the journal entry
  // the bridge writes for it, so a card that moved says who moved it.
  //
  // No optimistic move: the poll is 1.5s and revalidate lands well inside that, and a card that
  // jumps to the new column and then jumps back on a failed request is worse than one that takes a
  // beat to arrive.
  async function drop(status: CardStatus) {
    const card = held;
    setHeld(null);
    setOver(null);
    if (!card) return;
    // Re-read the card AS IT IS NOW, not as it was when the drag started. A poll lands every 1.5s
    // and a drag lasts longer than that, so the herd can pick the card up mid-gesture — and then
    // the whole safety argument (a manual column means no live agent) would be about a column the
    // card has already left. Rare, and exactly the case the guard exists for.
    const now = byId.get(card.id);
    if (!now || !canDropCard(now.status, status)) return;
    try {
      // Land it at the TOP of the target column rather than wherever its old `position` sorts it.
      // A drop is a placement: a card that moves to Ready and appears somewhere in the middle of
      // eleven others reads as nothing having happened. Same rule new cards already follow.
      await patchCard(card.id, { status, position: topOf(status) });
    } catch (e) {
      setStatus((e as Error).message, "error", null);
    }
    revalidator.revalidate();
  }

  /** One below the topmost card of a column — where a new card would go (bridge: `min - 1`). */
  function topOf(status: CardStatus): number {
    const positions = (byStatus.get(status) ?? []).map((e) =>
      e.kind === "group" ? e.container.position : e.card.position,
    );
    return (positions.length ? Math.min(...positions) : 0) - 1;
  }

  /** Drop targets while a card is in hand: the manual columns, minus the one it came from. */
  const dropTarget = (status: CardStatus) => held !== null && canDropCard(held.from, status);

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col lg:max-w-[90rem]">
      <AppHeader
        bridge={root?.bridge}
        error={root?.error ?? data.error}
        stalled={stalled}
        onHome={() => navigate(homePath(root?.session))}
        rightLead={<SectionLabel className="pr-1">Board</SectionLabel>}
        rightTrail={<SettingsGear session={root?.session} />}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <main className="flex flex-1 flex-col pb-24 lg:grid lg:grid-cols-4 lg:items-start lg:gap-x-3 lg:px-3">
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
                <div key={lane.label} className="contents lg:block lg:min-w-0">
                  {/* The lane's own heading exists only once there are lanes. An EMPTY lane still
                      renders it: four columns that keep their places are what makes a board
                      scannable, and a column that disappears when it empties moves the other three. */}
                  <div className="hidden items-baseline gap-2 pb-2 pt-4 lg:flex">
                    <SectionLabel>{lane.label}</SectionLabel>
                    <span className="text-xs text-muted-foreground/70">{total}</span>
                  </div>
                  {lane.statuses.map((status) => {
                    const column = byStatus.get(status) ?? [];
                    const target = dropTarget(status);
                    // An empty column is hidden — except while it is somewhere a card in hand could
                    // GO. Without this, moving the last card out of Ready makes Ready disappear, and
                    // with it any way to drag one back.
                    if (column.length === 0 && !target) return null;
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
                                setOver(status);
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
                                setOver((o) => (o === status ? null : o));
                              }
                            : undefined
                        }
                        onDrop={target ? () => void drop(status) : undefined}
                        className={cn(
                          "px-3 pt-4 lg:order-none lg:px-0 lg:pt-3",
                          MOBILE_ORDER[BOARD_COLUMNS.indexOf(status)],
                          // A drop target has to be big enough to aim at: a column holding one card
                          // is 60px of surface in a lane 800px tall, and everything around it
                          // silently rejects the drop.
                          target &&
                            "rounded-xl outline-1 outline-dashed outline-border transition-colors lg:min-h-32 lg:px-2",
                          // Thickness, not tint: `accent` sits 3% off `background`, which is not a
                          // signal — the ring colour on a doubled outline is.
                          over === status && "bg-accent outline-2 outline-ring",
                        )}
                      >
                        {/* Hidden in the lane whose name it repeats ("Needs you" under Needs you),
                            shown everywhere else — that is what keeps `starting` legible as its own
                            thing inside "In progress". */}
                        <div
                          className={cn(
                            "flex items-baseline gap-2 pb-2",
                            CARD_STATUS_LABEL[status] === lane.label && "lg:hidden",
                          )}
                        >
                          <SectionLabel>{CARD_STATUS_LABEL[status]}</SectionLabel>
                          <span className="text-xs text-muted-foreground/70">{column.length}</span>
                        </div>
                        <div className="flex flex-col gap-2">
                          {column.length === 0 && (
                            <p className="py-3 text-center text-xs text-muted-foreground">
                              Drop here to move to {CARD_STATUS_LABEL[status].toLowerCase()}
                            </p>
                          )}
                          {column.map((entry) =>
                            entry.kind === "group" ? (
                              // A container is not dragged: its column is DERIVED from its
                              // sub-tasks, so moving it by hand would be a status nothing keeps.
                              <CardGroup
                                key={entryKey(entry)}
                                container={entry.container}
                                subTasks={entry.children}
                                byId={byId}
                                onOpen={(cardId) => navigate(cardPath(cardId))}
                              />
                            ) : (
                              <CardTile
                                key={entryKey(entry)}
                                card={entry.card}
                                onClick={() => navigate(cardPath(entry.card.id))}
                                dependency={dependencyInfo(entry.card, byId)}
                                // Desktop only, and only from a column a human owns. `runtime` is
                                // belt-and-braces on top of that: a card with a live pane is never
                                // in a manual column, and if one ever were, dragging it away is the
                                // one move that could send its agent home.
                                drag={
                                  desktop && !entry.card.runtime && MANUAL_STATUSES.includes(status)
                                    ? {
                                        onStart: () => setHeld({ id: entry.card.id, from: status }),
                                        onEnd: () => {
                                          setHeld(null);
                                          setOver(null);
                                        },
                                        active: held?.id === entry.card.id,
                                      }
                                    : undefined
                                }
                              />
                            ),
                          )}
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
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-screen-sm px-3 pb-[calc(env(safe-area-inset-bottom)_+_0.75rem)] lg:max-w-[90rem]">
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

