import { useState } from "react";
import { Rocket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { boardErrorMessage, launchLot, type CardView } from "@/lib/board";
import type { ProjectLot } from "@/lib/project";
import { setStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

// A phase's lots (ADR 0021). A PLANNED lot holds its cards and drives nothing; "Launch this lot" is
// the operator's consent (ADR 0017) — given once, for exactly the cards listed in the sheet, in the
// order they will start. Nothing here can be reached by the planning agent: the bridge refuses the
// launch to any caller carrying a pane header.

function LaunchSheet({
  lot,
  byId,
  onClose,
  onLaunched,
}: {
  lot: ProjectLot;
  byId: Map<string, CardView>;
  onClose: () => void;
  onLaunched: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try {
      await launchLot(lot.lot.id);
      setStatus(`Lot “${lot.lot.name ?? "lot"}” launched.`, "success");
      onLaunched();
      onClose();
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={`Launch “${lot.lot.name ?? "lot"}”`}
      footer={
        <div className="flex w-full gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="brand" className="flex-1" disabled={busy || lot.cards.length === 0} onClick={() => void go()}>
            {busy ? "Launching…" : `Launch ${lot.cards.length} card${lot.cards.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          The board starts exactly these cards, by itself, until the lot ends or a card needs you. Workers, the lead
          and the reviews spend quota meanwhile. Nothing outside this list moves.
        </p>
        <ol className="flex flex-col gap-1.5">
          {lot.cards.map((c, i) => {
            const after = c.dependsOn ? byId.get(c.dependsOn) : undefined;
            return (
              <li key={c.id} className="flex gap-2 text-sm">
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{i + 1}.</span>
                <span className="min-w-0">
                  <b className="font-semibold">{c.title}</b>
                  {after && <span className="text-muted-foreground"> — after {after.title}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </BottomSheet>
  );
}

/**
 * A phase's body: each lot as a GROUP that holds its own steps (an indented rail under its header),
 * then the steps no lot has taken. A lot drawn as a box above a flat list read as attached to nothing.
 */
export function PhaseLots({
  lots,
  steps,
  byId,
  onLaunched,
  renderStep,
}: {
  lots: ProjectLot[];
  /** The steps to show (the filter already applied). */
  steps: CardView[];
  byId: Map<string, CardView>;
  onLaunched: () => void;
  renderStep: (card: CardView, inLot: boolean) => React.ReactNode;
}) {
  const [launching, setLaunching] = useState<ProjectLot | null>(null);
  const shown = new Set(steps.map((s) => s.id));
  const taken = new Set(lots.flatMap((pl) => pl.lot.cardIds));
  const loose = steps.filter((s) => !taken.has(s.id));
  const groups = lots.map((pl) => ({ pl, own: pl.cards.filter((c) => shown.has(c.id)) }));
  // A lot with nothing to show under the current filter would be an empty box.
  const visible = groups.filter((g) => g.own.length > 0);
  return (
    <>
      <div className="flex flex-col gap-3">
        {visible.map(({ pl, own }) => {
          const planned = pl.lot.launchedAt === null;
          const finished = pl.cards.length > 0 && pl.done === pl.cards.length;
          const pct = pl.cards.length ? (100 * pl.done) / pl.cards.length : 0;
          return (
            <section
              key={pl.lot.id}
              aria-label={`Lot ${pl.lot.name ?? ""}`}
              className={cn("flex flex-col gap-2 rounded-2xl border p-2.5", planned ? "border-dashed" : "bg-card/30")}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-1">
                <span className="min-w-0 flex-1 text-sm font-semibold leading-snug">{pl.lot.name ?? "Lot"}</span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    planned ? "bg-muted text-muted-foreground" : finished ? "bg-status-done/15 text-status-done" : "bg-status-working/15 text-status-working",
                  )}
                >
                  {planned ? "planned" : finished ? "finished" : "running"}
                </span>
                {pl.lot.maxParallel ? (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {pl.lot.maxParallel === 1 ? "one at a time" : `${pl.lot.maxParallel} at a time`}
                  </span>
                ) : null}
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {pl.done} / {pl.cards.length}
                </span>
                {planned && (
                  <Button
                    variant="brand"
                    className="h-8 gap-1.5 rounded-[10px] px-3 text-sm font-semibold"
                    disabled={pl.cards.length === 0}
                    onClick={() => setLaunching(pl)}
                  >
                    <Rocket className="size-4" />
                    Launch this lot
                  </Button>
                )}
              </div>
              {!planned && (
                <div className="mx-1 h-[5px] overflow-hidden rounded-[3px] bg-border" aria-hidden="true">
                  <i className="block h-full bg-status-done transition-[width] duration-700" style={{ width: `${pct}%` }} />
                </div>
              )}
              <ul className="ml-2 flex flex-col gap-2 border-l-2 pl-3">{own.map((c) => renderStep(c, true))}</ul>
            </section>
          );
        })}
        {loose.length > 0 && (
          <div className="flex flex-col gap-2">
            {visible.length > 0 && (
              <span className="px-1 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Not in a lot · {loose.length}
              </span>
            )}
            <ul className="flex flex-col gap-2">{loose.map((c) => renderStep(c, false))}</ul>
          </div>
        )}
      </div>
      {launching && <LaunchSheet lot={launching} byId={byId} onClose={() => setLaunching(null)} onLaunched={onLaunched} />}
    </>
  );
}
