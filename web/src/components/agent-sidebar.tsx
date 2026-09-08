import { SpacePaneTree } from "@/components/space-pane-tree";
import type { AgentView, TabView } from "@/lib/types";

interface ThreadSidebarProps {
  agents: AgentView[];
  /** Bare shell panes (no agent) — grouped under their own space like every other pane, so a fresh
   *  space with nothing but a shell in it is still reachable. */
  shellPanes?: AgentView[];
  /** Used only to name each row's tab; a missing tab just leaves the pane's own tag on that line. */
  tabs?: TabView[];
  currentPaneId: string;
  onSelect: (paneId: string) => void;
  /** Override the list container padding (e.g. flush inside a bottom sheet). */
  className?: string;
}

// The pane switcher mounted in the pane-switcher bottom sheet: every pane grouped by space, its
// branch under the space's name, the open one highlighted. Same `SpacePaneTree` the desktop column
// renders, one type rung up for a thumb. Switching is the ONLY action here — closing a pane lives in
// the pane pill's long-press sheet (with its own confirm), so a fat-thumbed switch can never destroy
// a pane.
export function ThreadSidebar({
  agents,
  shellPanes = [],
  tabs = [],
  currentPaneId,
  onSelect,
  className,
}: ThreadSidebarProps) {
  if (agents.length === 0 && shellPanes.length === 0) {
    return (
      <div className="px-4 py-12 text-center text-sm text-muted-foreground">No agents running.</div>
    );
  }

  return (
    <SpacePaneTree
      agents={agents}
      shellPanes={shellPanes}
      tabs={tabs}
      currentPaneId={currentPaneId}
      onSelect={onSelect}
      className={className}
    />
  );
}
