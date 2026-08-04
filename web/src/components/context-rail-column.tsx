import { GitBranch } from "lucide-react";

import { ctxTone } from "@/components/ctx-bar";
import type { AgentView } from "@/lib/types";

interface ContextRailColumnProps {
  agent: AgentView | undefined;
  /** The agent's own re-surfaced statusline (model · ctx% · cwd · branch · tokens), verbatim. */
  statusLines: string[];
}

/**
 * Desktop's 308px context rail (redesign §5 "three panes"). Three blocks, each omitted when it has
 * nothing real to show rather than rendering an empty shell:
 *
 *  - the ctx gauge, as a large figure — the same number ContextGauge shows elsewhere, just given the
 *    width to be read at a glance instead of scanned in a thin bar.
 *  - the card this pane backs, gated on `AgentView.branch` (only set once `withCardFields` resolves
 *    one) — a hand-launched pane has no card, so the block disappears rather than show a blank one.
 *    Title and "Ouvrir la carte" / "Handoff" need a card id on the pane, which the bridge doesn't
 *    send yet (`AgentView` carries `branch`, not `cardId`) — this shows the branch, the one real
 *    field available, and stops there rather than link to a card it can't identify.
 *  - the agent's statusline, verbatim — same text agent-chat.tsx re-surfaces above the mobile
 *    composer, just also here since the composer's own copy lives one column over.
 */
export function ContextRailColumn({ agent, statusLines }: ContextRailColumnProps) {
  if (!agent) return null;
  const pct = agent.ctxPct;

  return (
    <div className="hidden w-[308px] flex-none flex-col gap-4 overflow-y-auto border-l border-border p-4 lg:flex">
      {pct != null && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            <span className="text-[26px] font-semibold tabular-nums">{Math.round(pct)}%</span>
            <span className="text-xs text-muted-foreground">context</span>
            {pct >= 70 && (
              <span className="ml-auto text-xs font-medium text-status-working">
                worth handing off
              </span>
            )}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all ${ctxTone(pct)}`}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
        </div>
      )}

      {agent.branch && (
        <div className="flex flex-col gap-1 rounded-xl border border-border bg-card px-3 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Card
          </span>
          <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate">{agent.branch}</span>
          </div>
        </div>
      )}

      {statusLines.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-border/60 pt-3 font-mono text-[11px] leading-tight text-muted-foreground/80">
          {statusLines.map((line, i) => (
            <div key={i} className="truncate">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
