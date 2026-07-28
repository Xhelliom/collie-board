import { useState } from "react";
import { useLoaderData, useNavigate, useRevalidator, useRouteLoaderData } from "react-router";
import { Plus } from "lucide-react";

import { AppHeader, SettingsGear } from "@/components/app-header";
import { SectionLabel } from "@/components/ui/section-label";
import { Button } from "@/components/ui/button";
import { CardTile } from "@/components/card-tile";
import { NewCardSheet } from "@/components/new-card-sheet";
import { StatusArea } from "@/components/status-area";
import { useLoadingStalled } from "@/hooks/use-loading-stalled";
import { BOARD_COLUMNS, CARD_STATUS_LABEL, cardPath, createCard, type CardInput } from "@/lib/board";
import type { BoardData } from "@/lib/board-loaders";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { homePath } from "@/lib/nav";

// The board: every card, grouped by column, urgency first.
//
// Deliberately a single vertical scroll of labelled sections rather than side-by-side Kanban
// columns. A phone has one column of usable width, and horizontal panning to find the card that
// needs you is exactly the interaction this whole project exists to avoid. Cards move between
// sections on their own (the bridge reconciles them against the herd every poll), so dragging is
// not the primary verb here — opening a card is.
export function BoardRoute() {
  const data = useLoaderData() as BoardData;
  // The root loader is still the connection source of truth — the board rides its poll.
  const root = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData | undefined;
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const stalled = useLoadingStalled();
  const [newOpen, setNewOpen] = useState(false);

  const byStatus = new Map(BOARD_COLUMNS.map((s) => [s, data.cards.filter((c) => c.status === s)]));
  const empty = data.cards.length === 0;
  // Pre-fill the next card's repo with the one you last used — on a phone, typing a path twice is
  // two times too many.
  const lastRepo = data.cards.find((c) => c.repoPath)?.repoPath ?? undefined;

  async function create(input: CardInput) {
    await createCard(input);
    revalidator.revalidate();
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col">
      <AppHeader
        bridge={root?.bridge}
        error={root?.error ?? data.error}
        stalled={stalled}
        onHome={() => navigate(homePath(root?.session))}
        rightLead={<SectionLabel className="pr-1">Board</SectionLabel>}
        rightTrail={<SettingsGear session={root?.session} />}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <main className="flex-1 pb-24">
          {empty ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              <p>No cards yet.</p>
              <p className="mt-1">A card is a task that outlives the pane working on it.</p>
            </div>
          ) : (
            BOARD_COLUMNS.map((status) => {
              const cards = byStatus.get(status) ?? [];
              if (cards.length === 0) return null;
              return (
                <section key={status} className="px-3 pt-4">
                  <div className="flex items-baseline gap-2 pb-2">
                    <SectionLabel>{CARD_STATUS_LABEL[status]}</SectionLabel>
                    <span className="text-[11px] text-muted-foreground/70">{cards.length}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {cards.map((card) => (
                      <CardTile key={card.id} card={card} onClick={() => navigate(cardPath(card.id))} />
                    ))}
                  </div>
                </section>
              );
            })
          )}
        </main>
      </div>

      {/* New-card FAB, above the status line. One tap from anywhere on the board. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-screen-sm px-3 pb-[calc(env(safe-area-inset-bottom)_+_0.75rem)]">
        <div className="pointer-events-auto flex justify-end pb-2">
          <Button onClick={() => setNewOpen(true)} className="h-12 gap-2 rounded-full px-5 shadow-lg">
            <Plus className="size-4" />
            New card
          </Button>
        </div>
        <StatusArea />
      </div>

      <NewCardSheet
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreate={create}
        defaultRepoPath={lastRepo}
      />
    </div>
  );
}
