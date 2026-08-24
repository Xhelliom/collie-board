import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { ctxTone } from "@/components/ctx-bar";
import { fetchUsage, type ClaudeUsage, type UsageLimit } from "@/lib/board";

// How much Claude Code quota is USED, on the dashboard. The bridge reads it from `claude -p /usage`
// (bridge/usage.ts) and caches it for fifteen minutes.
//
// ONE LINE, THEN THE DETAIL. Three limits are three bars, and a dashboard whose job is "which agent
// needs me" cannot spend three rows on context. Only ONE of the three decides anything at a time —
// whichever hits its wall first — so the collapsed line shows that one and the tap shows the rest.
//
// THE BAR THICKENS AS IT REDDENS. 3px while everything is green, 6px from the amber threshold on:
// the gauge grows when it has something to say, so peripheral vision catches it without reading a
// number. Past CRITICAL it opens itself and takes a card — it stops waiting for the tap.
//
// USED, NOT LEFT. It first rendered the remainder — a fuel gauge that empties. That reads fine on
// its own and wrong in place: ContextGauge and CtxBar, inches away on the same screen, fill with
// what's CONSUMED, and `/usage` itself talks in "% used". Two bars side by side that mean opposite
// things is how a correct 94% gets read as a wrong one. One direction everywhere: full bar = at the
// limit.
//
// FETCHED ON MOUNT, NOT POLLED. Landing on the dashboard is the refresh — the card asked for either
// a periodic pull or an on-arrival one, and on-arrival is the one that costs no timer: the bridge's
// TTL already bounds how old the answer can be, and the button below covers "I want it now".
// Deliberately NOT on the root loader: that revalidates every 1.5 s, which would mean an HTTP round
// trip per poll tick for a number that moves over minutes.
//
// Renders nothing when there's no reading (no `claude` on the host, an unrecognised panel) — same
// posture as the context gauge: no number beats a wrong one.

/** Where the gauge stops waiting to be asked: it opens itself and wears a card. `ctxTone`'s own red
 *  threshold, so the colour and the escalation land on the same percentage. */
const CRITICAL = 85;

/** Text colour for a percentage, matching what {@link ctxTone} paints the bar. */
function toneText(pct: number): string {
  return pct >= CRITICAL
    ? "text-status-blocked"
    : pct >= 70
      ? "text-status-working"
      : "text-foreground";
}

/** "Current week (all models)" → "week (all models)" — the header already says whose quota. */
function shortLabel(label: string): string {
  return label.replace(/^Current\s+/i, "");
}

/** The limit that decides: the closest one to its wall. Empty lists never reach here. */
function peak(limits: UsageLimit[]): number {
  return limits.reduce((hi, l) => Math.max(hi, l.percent), 0);
}

export function UsageGauge({ className }: { className?: string }) {
  const [usage, setUsage] = useState<ClaudeUsage | null>(null);
  const [busy, setBusy] = useState(false);
  // null = follow the reading (open when critical). A tap pins it either way, so a critical gauge
  // can still be dismissed — it escalates, it doesn't trap.
  const [open, setOpen] = useState<boolean | null>(null);

  const load = useCallback(async (refresh: boolean, signal?: AbortSignal) => {
    setBusy(true);
    try {
      const { usage } = await fetchUsage(refresh, signal);
      if (!signal?.aborted) setUsage(usage);
    } catch {
      // Optional gauge: a failed read leaves whatever was there (or nothing) and says nothing.
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void load(false, ac.signal);
    return () => ac.abort();
  }, [load]);

  if (!usage || usage.limits.length === 0) return null;

  const worst = peak(usage.limits);
  const critical = worst >= CRITICAL;
  const expanded = open ?? critical;

  return (
    <section className={cn("flex flex-col", className)} aria-label="Claude Code usage">
      <div
        className={cn(
          "flex flex-col",
          critical &&
            "gap-1 rounded-2xl border border-status-blocked/45 bg-status-blocked/8 px-3 pb-3",
        )}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(!expanded)}
            aria-expanded={expanded}
            aria-label={expanded ? "Hide the quota detail" : "Show every quota limit"}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 text-left"
          >
            {critical ? (
              <span className="shrink-0 rounded-full bg-status-blocked px-2.5 py-[3px] text-[length:var(--label-size)] font-bold uppercase tracking-[var(--label-tracking)] text-status-chip-foreground">
                at the limit
              </span>
            ) : (
              <span className="shrink-0 text-xs text-muted-foreground">Claude Code</span>
            )}
            <div
              className={cn(
                "flex-1 overflow-hidden rounded-full bg-muted transition-all",
                worst >= 70 ? "h-1.5" : "h-[3px]",
              )}
            >
              <div
                className={cn("h-full rounded-full transition-all", ctxTone(worst))}
                style={{ width: `${worst}%` }}
              />
            </div>
            <span className={cn("shrink-0 text-xs tabular-nums", toneText(worst))}>{worst}%</span>
            {expanded ? (
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            )}
          </button>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={busy}
            aria-label="Refresh Claude Code usage"
            className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
          </button>
        </div>

        {expanded && (
          <div className="flex flex-col gap-2.5 pb-1">
            {usage.limits.map((limit) => (
              <div key={limit.label} className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{shortLabel(limit.label)}</span>
                  <span className={cn("tabular-nums", toneText(limit.percent))}>
                    {limit.percent}%
                  </span>
                  {limit.resetsAt && (
                    <span className="ml-auto truncate text-[11px]">resets {limit.resetsAt}</span>
                  )}
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full transition-all", ctxTone(limit.percent))}
                    style={{ width: `${limit.percent}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
