import type { ReactNode } from "react";
import { TerminalSquare } from "lucide-react";

import { cn } from "@/lib/utils";
import { AgentIcon } from "@/components/agent-icon";
import { AGENT_GROUPS } from "@/lib/agent-groups";
import { paneDisplayName } from "@/lib/types";
import type { AgentView, TabView } from "@/lib/types";

interface PaneListColumnProps {
  agents: AgentView[];
  shellPanes: AgentView[];
  tabs: TabView[];
  currentPaneId: string;
  onSelect: (paneId: string) => void;
}

/**
 * Desktop's 296px pane list (redesign §5 "three panes") — every pane in the herd, not just this
 * space, grouped exactly as the pane switcher / ThreadSidebar groups them (AGENT_GROUPS + a
 * trailing "Shells"), so the two never disagree about what a "needs you" pane is. This is the
 * desktop's ENTIRE way to switch panes — below `lg` the same data renders as the pane-switcher sheet
 * instead (agent-chat.tsx's own ThreadSidebar mount).
 */
export function PaneListColumn({
  agents,
  shellPanes,
  tabs,
  currentPaneId,
  onSelect,
}: PaneListColumnProps) {
  const total = agents.length + shellPanes.length;
  return (
    <nav
      aria-label="Panes"
      className="hidden w-[296px] flex-none flex-col overflow-y-auto border-r bg-muted dark:bg-[oklch(0.165_0.006_250)] lg:flex"
    >
      <div className="flex h-14 flex-none items-center gap-2 border-b border-border/60 px-4">
        <span className="text-sm font-semibold">Panes</span>
        <span className="text-xs tabular-nums text-muted-foreground">{total}</span>
      </div>
      <div className="flex flex-col gap-3 p-2">
        {AGENT_GROUPS.map((g) => {
          const members = agents.filter((a) => g.match(a.status));
          if (members.length === 0) return null;
          return (
            <PaneGroup key={g.key} label={g.label} accent={g.accent}>
              {members.map((p) => (
                <PaneRow
                  key={p.paneId}
                  pane={p}
                  tabLabel={tabs.find((t) => t.tabId === p.tabId)?.label}
                  active={p.paneId === currentPaneId}
                  onSelect={onSelect}
                />
              ))}
            </PaneGroup>
          );
        })}
        {shellPanes.length > 0 && (
          <PaneGroup label="Shells">
            {shellPanes.map((p) => (
              <PaneRow
                key={p.paneId}
                pane={p}
                tabLabel={tabs.find((t) => t.tabId === p.tabId)?.label}
                active={p.paneId === currentPaneId}
                onSelect={onSelect}
              />
            ))}
          </PaneGroup>
        )}
      </div>
    </nav>
  );
}

function PaneGroup({
  label,
  accent,
  children,
}: {
  label: string;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2
        className={cn(
          "px-2.5 pb-1 text-xs font-semibold uppercase tracking-wide",
          accent ? "text-status-blocked" : "text-muted-foreground",
        )}
      >
        {label}
      </h2>
      {children}
    </div>
  );
}

function PaneRow({
  pane,
  tabLabel,
  active,
  onSelect,
}: {
  pane: AgentView;
  tabLabel: string | undefined;
  active: boolean;
  onSelect: (paneId: string) => void;
}) {
  const isShell = pane.kind === "shell";
  const tag = pane.paneId.split(":").pop();
  return (
    <button
      type="button"
      onClick={() => onSelect(pane.paneId)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors",
        active ? "bg-brand/16 text-brand" : "text-foreground hover:bg-muted/60",
      )}
    >
      {isShell ? (
        <TerminalSquare className="size-5 shrink-0 text-muted-foreground" />
      ) : (
        <AgentIcon agent={pane.agent} className="size-5 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {paneDisplayName(pane)}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{tag}</span>
        </div>
        <div className="truncate font-mono text-[11px] text-muted-foreground">
          {pane.workspaceLabel}
          {tabLabel ? ` › ${tabLabel}` : ""}
        </div>
      </div>
      {pane.ctxPct != null && (
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          ctx {Math.round(pane.ctxPct)}%
        </span>
      )}
    </button>
  );
}
