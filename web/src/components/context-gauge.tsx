import { cn } from "@/lib/utils";
import type { CardSession } from "@/lib/board";

// How full the agent's context window is, read off its own transcript (bridge/context.ts).
//
// Deliberately advisory. It renders nothing at all when there is no number — an agent whose harness
// keeps no transcript is a supported case, not a broken one, and the Handoff button never depends on
// this. The amber/red thresholds are a nudge, not a gate: a handoff fired mid-refactor costs more
// than it saves, so the decision stays a tap.
export function ContextGauge({ session }: { session: CardSession | null }) {
  const pct = session?.ctxPct;
  if (session == null || pct == null) return null;

  const tone =
    pct >= 85 ? "bg-status-blocked" : pct >= 70 ? "bg-status-working" : "bg-status-done";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
        <span>Context</span>
        <span className="tabular-nums text-foreground">{pct}%</span>
        {session.ctxTokens != null && (
          <span className="tabular-nums">{Math.round(session.ctxTokens / 1000)}k tokens</span>
        )}
        {pct >= 70 && <span className="ml-auto text-status-working">worth handing off</span>}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
