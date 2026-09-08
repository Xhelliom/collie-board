import { FolderPlus } from "lucide-react";

import { SpacePaneTree } from "@/components/space-pane-tree";
import type { AgentView, TabView, WorkspaceView } from "@/lib/types";

interface SpaceOverviewProps {
  workspaces: WorkspaceView[];
  tabs: TabView[];
  agents: AgentView[];
  shellPanes: AgentView[];
  onOpen: (workspaceId: string) => void;
  onOpenPane: (paneId: string) => void;
  onNewSpace: () => void;
}

/**
 * The Spaces root tab — the same `SpacePaneTree` the desktop pane column and the pane switcher
 * render, so the three can't disagree about what a space holds or what hangs under it. Herdr's
 * shape: a space, its current branch under its name, its panes on a hairline rail, and the WORKTREE
 * spaces cut from its repo nested one level in (`groupPanesBySpace`) — which is what this screen's
 * card grid could never show: a card's worktree used to float here as its own top-level card, named
 * after a truncated card title, with nothing tying it to the repo it came from.
 *
 * Tapping a space header drills into it (tabs, tab creation, the pane grid); tapping a row opens
 * that pane. `workspaces` goes in so a space with no pane in the snapshot still gets a row — this
 * screen lists spaces, not just what you can switch to.
 */
export function SpaceOverview({
  workspaces,
  tabs,
  agents,
  shellPanes,
  onOpen,
  onOpenPane,
  onNewSpace,
}: SpaceOverviewProps) {
  return (
    <section className="flex flex-col px-2 py-3 lg:px-3">
      <div className="flex items-center justify-between px-2">
        <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
          Spaces <span className="opacity-60">({workspaces.length})</span>
        </h2>
        <button
          type="button"
          onClick={onNewSpace}
          aria-label="New space"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted active:scale-95"
        >
          <FolderPlus className="size-4" />
        </button>
      </div>

      {workspaces.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No spaces yet.</p>
      ) : (
        <SpacePaneTree
          agents={agents}
          shellPanes={shellPanes}
          tabs={tabs}
          workspaces={workspaces}
          // No pane is open on this screen; the space herdr has focused is the one to mark.
          currentPaneId=""
          activeWorkspaceId={workspaces.find((w) => w.focused)?.workspaceId}
          onSelect={onOpenPane}
          onOpenSpace={onOpen}
          className="px-0"
        />
      )}
    </section>
  );
}
