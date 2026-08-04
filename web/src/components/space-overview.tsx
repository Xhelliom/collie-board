import { FolderPlus, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { StatusDot } from "@/components/status-badge";
import { blockedCount, worstSpaceStatus } from "@/lib/spaces";
import { STATUS_LABEL } from "@/lib/types";
import type { AgentView, TabView, WorkspaceView } from "@/lib/types";

interface SpaceOverviewProps {
  workspaces: WorkspaceView[];
  tabs: TabView[];
  agents: AgentView[];
  onOpen: (workspaceId: string) => void;
  onSelectTab: (workspaceId: string, tabId: string) => void;
  onNewTab: (workspaceId: string) => void;
  onNewSpace: () => void;
}

// The Spaces root tab (redesign §9): one card per space, its status dot in the worst-agent tone, its
// tabs riding inside the card as their own chips — tap one to land straight on that tab, tap the
// card's own header (or anywhere else on it) for the usual drill-in. This replaced the compact list
// row the dashboard used to embed; a space is now its own screen, so it can afford the room.
export function SpaceOverview({
  workspaces,
  tabs,
  agents,
  onOpen,
  onSelectTab,
  onNewTab,
  onNewSpace,
}: SpaceOverviewProps) {
  return (
    <section className="flex flex-col gap-3 px-4 py-5 lg:px-5 lg:py-6">
      <div className="flex items-center justify-between">
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
        <div className="grid gap-3 lg:grid-cols-[repeat(auto-fill,minmax(360px,1fr))]">
          {workspaces.map((w) => {
            const status = worstSpaceStatus(w.workspaceId, agents);
            const blocked = blockedCount(w.workspaceId, agents) > 0;
            const wsTabs = tabs.filter((t) => t.workspaceId === w.workspaceId);
            return (
              <div
                key={w.workspaceId}
                className={cn(
                  "flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-3.5",
                  blocked && "border-status-blocked/45 bg-status-blocked/8",
                )}
              >
                <button
                  type="button"
                  onClick={() => onOpen(w.workspaceId)}
                  className="flex items-center gap-2.5 text-left"
                >
                  {status ? (
                    <>
                      <StatusDot status={status} />
                      {/* The dot alone is color-only; give SR users the status word. */}
                      <span className="sr-only">{STATUS_LABEL[status]}</span>
                    </>
                  ) : (
                    <span className="size-2.5 shrink-0 rounded-full border border-muted-foreground/40" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[17px] font-semibold">{w.label}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {w.tabCount} tab{w.tabCount === 1 ? "" : "s"} · {w.paneCount} pane
                    {w.paneCount === 1 ? "" : "s"}
                  </span>
                </button>

                <div className="flex flex-wrap items-center gap-1.5">
                  {wsTabs.map((t) => (
                    <button
                      key={t.tabId}
                      type="button"
                      onClick={() => onSelectTab(w.workspaceId, t.tabId)}
                      className="rounded-full bg-muted px-2.5 py-[3px] text-xs font-medium text-foreground transition-colors hover:bg-muted/70 active:scale-95"
                    >
                      {t.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => onNewTab(w.workspaceId)}
                    aria-label={`New tab in ${w.label}`}
                    className="flex size-[26px] items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:bg-muted active:scale-95"
                  >
                    <Plus className="size-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
