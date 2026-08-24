import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { ctxTone } from "@/components/ctx-bar";
import { fetchUsage, type ClaudeUsage } from "@/lib/board";

// How much Claude Code quota is USED, on the dashboard. The bridge reads it from `claude -p /usage`
// (bridge/usage.ts) and caches it for fifteen minutes.
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

/** "Current week (all models)" → "week (all models)" — the column header already says which. */
function shortLabel(label: string): string {
  return label.replace(/^Current\s+/i, "");
}

export function UsageGauge({ className }: { className?: string }) {
  const [usage, setUsage] = useState<ClaudeUsage | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <section className={cn("flex flex-col gap-1.5", className)} aria-label="Claude Code usage">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Claude Code used</span>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={busy}
          aria-label="Refresh Claude Code usage"
          className="ml-auto inline-flex size-6 items-center justify-center rounded-md hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
        </button>
      </div>

      {usage.limits.map((limit) => (
        <div key={limit.label} className="flex flex-col gap-1">
          <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
            <span className="truncate">{shortLabel(limit.label)}</span>
            <span className="tabular-nums text-foreground">{limit.percent}%</span>
            {limit.resetsAt && (
              <span className="ml-auto truncate text-[11px]">resets {limit.resetsAt}</span>
            )}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            {/* Fills and reddens with what's used — the same direction as the context gauge. */}
            <div
              className={cn("h-full rounded-full transition-all", ctxTone(limit.percent))}
              style={{ width: `${limit.percent}%` }}
            />
          </div>
        </div>
      ))}
    </section>
  );
}
