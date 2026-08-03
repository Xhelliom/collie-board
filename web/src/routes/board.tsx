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
import { cn } from "@/lib/utils";
import {
  BOARD_COLUMNS,
  BOARD_LANES,
  CARD_STATUS_LABEL,
  cardPath,
  createCard,
  type CardInput,
} from "@/lib/board";
import type { BoardData } from "@/lib/board-loaders";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { homePath } from "@/lib/nav";

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
// Still no drag-and-drop, on a mouse either: cards move between sections on their own (the bridge
// reconciles them against the herd every poll), only four statuses are ever set by hand, and the
// card page already has "Move to". Dragging is a comfort to arbitrate on its own, with its own
// dependency.
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
  const [newOpen, setNewOpen] = useState(false);

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
                    if (column.length === 0) return null;
                    return (
                      <section
                        key={status}
                        className={cn(
                          "px-3 pt-4 lg:order-none lg:px-0 lg:pt-3",
                          MOBILE_ORDER[BOARD_COLUMNS.indexOf(status)],
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
                          {column.map((entry) =>
                            entry.kind === "group" ? (
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

