import { ChevronRight, GitBranch, TerminalSquare } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { ShellBadge, StatusBadge } from "@/components/status-badge";
import { AgentIcon } from "@/components/agent-icon";
import { shortCwd } from "@/lib/format";
import { paneDisplayName } from "@/lib/types";
import type { AgentView } from "@/lib/types";

// A pane row, used by the triage home and the space view. Usually an agent; for a bare shell pane
// (kind:"shell") it shows a terminal glyph and a muted "shell" tag instead of a status badge.
export function AgentCard({ agent, onClick }: { agent: AgentView; onClick: () => void }) {
  const isShell = agent.kind === "shell";
  const blocked = agent.status === "blocked";
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left transition-transform active:scale-[0.99]"
    >
      <Card
        className={cn(
          "flex-row items-center gap-3 rounded-xl px-3.5 py-3 shadow-sm",
          blocked && "border-status-blocked/40 bg-status-blocked/5",
        )}
      >
        {isShell ? (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted">
            <TerminalSquare className="size-4 text-muted-foreground" />
          </div>
        ) : (
          <AgentIcon agent={agent.agent} className="size-9" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {/* Name slot: a user label, else Claude's /rename session name, else the agent name — the
                icon still shows which agent it is (see paneDisplayName). */}
            <span className="truncate font-medium">{paneDisplayName(agent)}</span>
            <span className="truncate text-xs text-muted-foreground">· {agent.workspaceLabel}</span>
          </div>
          {/* Branch gets its OWN row: unlike cwd/ctx% it's unbounded length, and packing it into the
              row below starved ctx% of room (confirmed in a real browser at phone width — the branch
              icon and the ctx% number both got clipped with no ellipsis, not just visually tight).
              The BRANCH only ever appears for a pane backing an open board card (bridge
              `withCardFields`); ctx% below appears for any agent pane the bridge could read
              (`ContextTracker.enrich`, G3). Same fields CardTile shows, so a card ↔ agent pair reads
              the same on both screens (UI_AUDIT.md G2). */}
          {agent.branch && (
            <div className="flex items-center gap-1 truncate font-mono text-xs text-muted-foreground">
              <GitBranch className="size-3 shrink-0" />
              <span className="truncate">{agent.branch}</span>
            </div>
          )}
          <div className="flex items-center gap-2 truncate text-xs text-muted-foreground">
            <span className="truncate font-mono">{shortCwd(agent.cwd)}</span>
            {agent.ctxPct != null && <span className="shrink-0">· ctx {Math.round(agent.ctxPct)}%</span>}
          </div>
        </div>
        {isShell ? <ShellBadge /> : <StatusBadge status={agent.status} />}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Card>
    </button>
  );
}
