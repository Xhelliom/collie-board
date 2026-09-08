import { SpacePaneTree } from "@/components/space-pane-tree";
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
 * space, grouped by SPACE exactly as the pane switcher / ThreadSidebar groups them (both render one
 * `SpacePaneTree`), so the two never disagree about what a space holds. This is the desktop's ENTIRE
 * way to switch panes — below `lg` the same data renders as the pane-switcher sheet instead
 * (agent-chat.tsx's own ThreadSidebar mount).
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
      <SpacePaneTree
        agents={agents}
        shellPanes={shellPanes}
        tabs={tabs}
        currentPaneId={currentPaneId}
        onSelect={onSelect}
        dense
        // The column paints its own shade, so the status dots' rail cut-out has to match it.
        surfaceRing="ring-muted dark:ring-[oklch(0.165_0.006_250)]"
      />
    </nav>
  );
}
