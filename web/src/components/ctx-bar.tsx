import { cn } from "@/lib/utils";

/** The ctx-tone threshold ContextGauge already used, pulled out so every mini bar in the redesign
 *  (a board card, Herd's loud card, a session in the card page's timeline) picks the same colour at
 *  the same percentage instead of re-deriving it. */
export function ctxTone(pct: number): string {
  return pct >= 85 ? "bg-status-blocked" : pct >= 70 ? "bg-status-working" : "bg-status-done";
}

/**
 * A tiny fixed-width fill bar for ctx%, for the places a full {@link ContextGauge} (with its own
 * label row) is too heavy — a card tile, a triage row, one session in a timeline. 30px wide by
 * default (the board card's size); override with `className` (e.g. `w-9` for Herd's 36px).
 */
export function CtxBar({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className={cn("h-1 w-[30px] shrink-0 overflow-hidden rounded-full bg-muted", className)}>
      <div
        className={cn("h-full rounded-full", ctxTone(pct))}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
}
