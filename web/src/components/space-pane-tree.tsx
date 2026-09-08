import { Folder, GitBranch, TerminalSquare } from "lucide-react";

import { cn } from "@/lib/utils";
import { AgentIcon } from "@/components/agent-icon";
import { StatusDot } from "@/components/status-badge";
import { groupPanesBySpace, type SpaceGroup } from "@/lib/spaces";
import { shortCwd } from "@/lib/format";
import { paneDisplayName, STATUS_LABEL } from "@/lib/types";
import type { AgentView, TabView } from "@/lib/types";

interface SpacePaneTreeProps {
  agents: AgentView[];
  shellPanes: AgentView[];
  tabs: TabView[];
  currentPaneId: string;
  onSelect: (paneId: string) => void;
  /** The desktop column's tighter type rung (and its pane tag). The sheet runs a phone rung. */
  dense?: boolean;
  /** Ring utility matching the surface this list sits on — it's what makes the rail read as passing
   *  BEHIND each status dot. Defaults to the sheet's `bg-background`; the desktop column paints its
   *  own shade and passes its own. */
  surfaceRing?: string;
  className?: string;
}

/**
 * The pane list, grouped by space — the ONE body behind both the desktop pane column and the
 * pane-switcher sheet, so the two can't disagree about what a space contains. Herdr's sidebar shape
 * (space → its branch → its panes), not herdr's rendering: the `└─` connectors become a hairline
 * rail down the group, and each pane's status dot SITS on that rail. The rail is the hierarchy and
 * the dot is the pane's own state — one mark doing both jobs, which is what a browser buys us over
 * a terminal.
 *
 * Urgency didn't disappear with the triage sections, it moved a level up: `groupPanesBySpace` sorts
 * blocked spaces first and the header carries the space's blocked count.
 */
export function SpacePaneTree({
  agents,
  shellPanes,
  tabs,
  currentPaneId,
  onSelect,
  dense,
  surfaceRing = "ring-background",
  className,
}: SpacePaneTreeProps) {
  const groups = groupPanesBySpace(agents, shellPanes);
  // The space you're reading, not the one Herdr's TUI happens to focus — this list is a phone's.
  const activeWorkspaceId = [...agents, ...shellPanes].find((p) => p.paneId === currentPaneId)
    ?.workspaceId;

  return (
    <div className={cn("flex flex-col gap-2.5 px-2 py-3", className)}>
      {groups.map((g) => (
        <SpaceSection
          key={g.workspaceId}
          group={g}
          active={g.workspaceId === activeWorkspaceId}
          tabs={tabs}
          currentPaneId={currentPaneId}
          onSelect={onSelect}
          dense={dense}
          surfaceRing={surfaceRing}
        />
      ))}
    </div>
  );
}

function SpaceSection({
  group,
  active,
  tabs,
  currentPaneId,
  onSelect,
  dense,
  surfaceRing,
}: {
  group: SpaceGroup;
  active: boolean;
  tabs: TabView[];
  currentPaneId: string;
  onSelect: (paneId: string) => void;
  dense?: boolean;
  surfaceRing: string;
}) {
  const spansTabs = new Set(group.panes.map((p) => p.tabId)).size > 1;
  return (
    <section className="flex flex-col">
      <div
        className={cn(
          "flex items-start gap-2 rounded-[10px] px-2 py-1.5",
          active && "bg-brand/10",
        )}
      >
        {/* The space's worst status. No screen-reader text on it: it only ever summarises rows that
            each announce their own status, and the blocked count below says the part that matters. */}
        {group.status ? (
          <StatusDot status={group.status} className="mt-1" />
        ) : (
          <span className="mt-1 size-2.5 shrink-0 rounded-full border border-muted-foreground/40" />
        )}

        <div className="min-w-0 flex-1">
          <h3 className={cn("truncate font-semibold", dense ? "text-[13px]" : "text-sm")}>
            {group.label}
          </h3>
          {/* The space's branch, secondary under its name. No branch known (a space nobody filed a
              card for) — the path stands in, marked by its own icon rather than dressed up as a ref. */}
          <p className="flex min-w-0 items-center gap-1">
            {group.branch ? (
              <GitBranch className="size-3 shrink-0 text-muted-foreground/85" />
            ) : (
              <Folder className="size-3 shrink-0 text-muted-foreground/70" />
            )}
            <span
              className={cn(
                "truncate font-mono text-muted-foreground",
                dense ? "text-[11px]" : "text-xs",
                !group.branch && "opacity-85",
              )}
            >
              {/* The branch runs off the END, not the front: what tells two card branches apart is
                  the slug right after `board/`. A path is the other way round, hence shortCwd. */}
              {group.branch ?? shortCwd(group.cwd)}
            </span>
          </p>
        </div>

        {group.blocked > 0 ? (
          <span className="mt-0.5 flex shrink-0 items-center gap-1 rounded-full bg-status-blocked/15 px-1.5 py-px text-[11px] font-semibold tabular-nums text-status-blocked">
            <span aria-hidden="true" className="size-[5px] rounded-full bg-status-blocked" />
            {group.blocked}
            <span className="sr-only">needing you</span>
          </span>
        ) : (
          <span className="mt-1 shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {group.panes.length}
            <span className="sr-only"> panes</span>
          </span>
        )}
      </div>

      <div className="relative pt-0.5">
        {/* The hierarchy, drawn: one hairline from the header down through the group, fading out
            rather than stopping dead at the last row. Brand-tinted for the space you're in. */}
        <span
          aria-hidden="true"
          className={cn(
            "absolute bottom-4 left-[13px] top-0 w-px rounded-full bg-linear-to-b",
            // --border sits a hair too close to every surface this list is painted on to read as a
            // line; the muted foreground is the same neutral, far enough off to be a hairline.
            active
              ? "from-brand/70 via-brand/45 to-transparent"
              : "from-muted-foreground/30 via-muted-foreground/16 to-transparent",
          )}
        />
        {group.panes.map((p) => (
          <PaneRow
            key={p.paneId}
            pane={p}
            tabLabel={tabs.find((t) => t.tabId === p.tabId)?.label}
            active={p.paneId === currentPaneId}
            onSelect={onSelect}
            dense={dense}
            surfaceRing={surfaceRing}
            showTab={spansTabs}
          />
        ))}
      </div>
    </section>
  );
}

function PaneRow({
  pane,
  tabLabel,
  active,
  onSelect,
  dense,
  surfaceRing,
  showTab,
}: {
  pane: AgentView;
  tabLabel: string | undefined;
  active: boolean;
  onSelect: (paneId: string) => void;
  dense?: boolean;
  surfaceRing: string;
  showTab: boolean;
}) {
  const isShell = pane.kind === "shell";
  const tag = pane.paneId.split(":").pop();
  return (
    <button
      type="button"
      onClick={() => onSelect(pane.paneId)}
      // The dot is the only place the row's status shows, so it rides the accessible name too.
      aria-label={`${paneDisplayName(pane)}, ${STATUS_LABEL[pane.status]}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex w-full min-w-0 items-center gap-2.5 rounded-[10px] py-2 pl-[26px] pr-2.5 text-left transition-colors",
        // A thumb needs 44px even when the row is down to one line.
        !dense && "min-h-11",
        active ? "bg-brand/16 text-brand" : "text-foreground hover:bg-muted/60 active:bg-muted",
      )}
    >
      {/* The row's own status, sitting ON the rail: the attachment point IS the indicator. The ring
          is the list's background, so the hairline reads as passing behind the dot. */}
      <StatusDot
        status={pane.status}
        className={cn("absolute left-[9.5px] top-1/2 size-[7px] -translate-y-1/2 ring-[3px]", surfaceRing)}
      />

      {isShell ? (
        <TerminalSquare className="size-5 shrink-0 text-muted-foreground" />
      ) : (
        <AgentIcon agent={pane.agent} className="size-5 shrink-0" />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span
            className={cn("min-w-0 flex-1 truncate font-semibold", dense ? "text-sm" : "text-base")}
          >
            {paneDisplayName(pane)}
          </span>
          {dense && (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{tag}</span>
          )}
        </div>
        {/* The space is the header's job now, so the second line is left with the tab — and only
            when the space has more than one for the row to be in. Otherwise the row is one line. */}
        {showTab && tabLabel && (
          <div
            className={cn(
              "truncate font-mono text-muted-foreground",
              dense ? "text-[11px]" : "text-xs",
            )}
          >
            {tabLabel}
          </div>
        )}
      </div>

      {pane.ctxPct != null && (
        <span
          className={cn(
            "shrink-0 tabular-nums text-muted-foreground",
            dense ? "text-[11px]" : "text-xs",
          )}
        >
          ctx {Math.round(pane.ctxPct)}%
        </span>
      )}
    </button>
  );
}
