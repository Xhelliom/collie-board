import { Folder, GitBranch, TerminalSquare } from "lucide-react";

import { cn } from "@/lib/utils";
import { AgentIcon } from "@/components/agent-icon";
import { StatusDot } from "@/components/status-badge";
import { groupPanesBySpace, type SpaceGroup } from "@/lib/spaces";
import { shortCwd } from "@/lib/format";
import { repoName } from "@/lib/board";
import { paneDisplayName, STATUS_LABEL } from "@/lib/types";
import type { AgentView, TabView, WorkspaceView } from "@/lib/types";

interface SpacePaneTreeProps {
  agents: AgentView[];
  shellPanes: AgentView[];
  tabs: TabView[];
  currentPaneId: string;
  onSelect: (paneId: string) => void;
  /** Every space, so one with no pane in the snapshot still gets a row. The Spaces page passes it —
   *  it lists spaces; the pane switcher doesn't — it lists what you can switch to. */
  workspaces?: WorkspaceView[];
  /** The highlighted space. Defaults to the one holding `currentPaneId` — the Spaces page has no
   *  open pane and passes herdr's focused space instead. */
  activeWorkspaceId?: string;
  /** When given, a space header drills into that space (the Spaces page). Without it the header is
   *  plain text — the pane switcher has nowhere to drill to. */
  onOpenSpace?: (workspaceId: string) => void;
  /** The desktop column's tighter type rung (and its pane tag). The sheet runs a phone rung. */
  dense?: boolean;
  /** Ring utility matching the surface this list sits on — it's what makes the rail read as passing
   *  BEHIND each status dot. Defaults to the sheet's `bg-background`; the desktop column paints its
   *  own shade and passes its own. */
  surfaceRing?: string;
  className?: string;
}

/**
 * Every geometry number in this file hangs off one origin: the LEFT EDGE OF THE LIST, shared by
 * every depth. A section at depth d draws its rail at `railX(d)`; its own header dot sits at the TOP
 * of that rail, and every row under it sits its dot on the same rail and starts its text 13px past
 * it. A nested section steps in by one `RAIL_STEP` and reaches back to its parent's rail with a
 * short horizontal hairline — the elbow, which is herdr's `└─` drawn instead of typed.
 *
 * Nested sections carry no padding of their own, so an absolute `left` means the same thing at
 * every depth. Change that and every offset below lies.
 */
const RAIL_STEP = 14;
const railX = (depth: number) => 13 + RAIL_STEP * depth;

/**
 * The pane list, grouped by space — the ONE body behind the desktop pane column, the pane-switcher
 * sheet AND the Spaces page, so the three can't disagree about what a space contains. Herdr's
 * sidebar shape (space → its branch → its children), not herdr's rendering: the `└─` connectors
 * become a hairline rail down the group, and each child's status dot SITS on that rail. The rail is
 * the hierarchy and the dot is the row's own state — one mark doing both jobs, which is what a
 * browser buys us over a terminal.
 *
 * The tree is two levels deep, both of them herdr's: a space, and the WORKTREE spaces cut from its
 * repo hanging under it (`groupPanesBySpace`). Urgency didn't disappear with the triage sections, it
 * moved a level up: spaces sort worst-first across their whole subtree and each header carries its
 * own blocked count.
 */
export function SpacePaneTree({
  agents,
  shellPanes,
  tabs,
  currentPaneId,
  onSelect,
  workspaces,
  activeWorkspaceId,
  onOpenSpace,
  dense,
  surfaceRing = "ring-background",
  className,
}: SpacePaneTreeProps) {
  const groups = groupPanesBySpace(agents, shellPanes, workspaces);
  // The space you're reading, not the one Herdr's TUI happens to focus — this list is a phone's.
  const active =
    activeWorkspaceId ??
    [...agents, ...shellPanes].find((p) => p.paneId === currentPaneId)?.workspaceId;

  return (
    <div className={cn("flex flex-col gap-2.5 px-2 py-3", className)}>
      {groups.map((g) => (
        <SpaceSection
          key={g.workspaceId}
          group={g}
          activeWorkspaceId={active}
          tabs={tabs}
          currentPaneId={currentPaneId}
          onSelect={onSelect}
          onOpenSpace={onOpenSpace}
          dense={dense}
          surfaceRing={surfaceRing}
        />
      ))}
    </div>
  );
}

function SpaceSection({
  group,
  activeWorkspaceId,
  tabs,
  currentPaneId,
  onSelect,
  onOpenSpace,
  dense,
  surfaceRing,
  depth = 0,
}: {
  group: SpaceGroup;
  activeWorkspaceId: string | undefined;
  tabs: TabView[];
  currentPaneId: string;
  onSelect: (paneId: string) => void;
  onOpenSpace?: (workspaceId: string) => void;
  dense?: boolean;
  surfaceRing: string;
  depth?: number;
}) {
  const active = group.workspaceId === activeWorkspaceId;
  const spansTabs = new Set(group.panes.map((p) => p.tabId)).size > 1;
  const rail = railX(depth);
  // A space with ONE pane is one session: its agent rides the header as a meta line instead of a
  // row of its own, so it can't read as a second entry. The Spaces page keeps the row — there the
  // header drills into the space and the row opens the pane, two different taps.
  const lone = !onOpenSpace && group.panes.length === 1 ? group.panes[0] : undefined;
  // A path whose last segment IS the space's name only repeats the title. A branch always speaks.
  const where = group.branch ?? (repoName(group.cwd) === group.label ? "" : group.cwd);
  // Nothing but shells (or nothing at all): nothing to watch, so it steps back behind the agents.
  const quiet = group.status === null;

  const header = (
    <>
      {/* The elbow: the one horizontal stroke that says "this space was cut from the one above". A
          drawn hairline, not a `└─` — same job, none of the terminal's typography. */}
      {depth > 0 && (
        <span
          aria-hidden="true"
          className="absolute h-px rounded-full bg-muted-foreground/40"
          style={{ left: rail - RAIL_STEP, top: 15, width: RAIL_STEP }}
        />
      )}

      {/* The space's worst status, sitting at the head of its own rail. No screen-reader text on it:
          it only ever summarises rows that each announce their own status, and the blocked count
          below says the part that matters. */}
      {group.status ? (
        <StatusDot
          status={group.status}
          className={cn("absolute", group.status === "idle" && IDLE_DOT)}
          style={{ left: rail - 5, top: 10 }}
        />
      ) : (
        <span
          className="absolute size-2.5 rounded-full border border-muted-foreground/40"
          style={{ left: rail - 5, top: 10 }}
        />
      )}

      <div className="min-w-0 flex-1">
        <h3
          className={cn(
            "truncate font-semibold",
            dense ? "text-[13px]" : "text-sm",
            quiet && "text-muted-foreground",
          )}
        >
          {group.label}
        </h3>
        {/* The space's branch, secondary under its name. No branch known (a space nobody filed a
            card for) — the path stands in, marked by its own icon rather than dressed up as a ref. */}
        {where && (
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
        )}
        {lone && <PaneMeta pane={lone} dense={dense} className="mt-0.5" />}
      </div>

      {group.blocked > 0 ? (
        <span className="mt-0.5 flex shrink-0 items-center gap-1 rounded-full bg-status-blocked/15 px-1.5 py-px text-[11px] font-semibold tabular-nums text-status-blocked">
          <span aria-hidden="true" className="size-[5px] rounded-full bg-status-blocked" />
          {group.blocked}
          <span className="sr-only">needing you</span>
        </span>
      ) : null}
    </>
  );

  const loneActive = lone?.paneId === currentPaneId;
  const headerClass = cn(
    "relative flex w-full items-start gap-2 rounded-[10px] py-1.5 pr-2 text-left",
    loneActive ? "bg-brand/16" : active && "bg-brand/10",
    (onOpenSpace || lone) && "transition-colors hover:bg-muted/60 active:bg-muted",
  );
  const headerStyle = { paddingLeft: rail + 13 };

  return (
    <section className="flex flex-col">
      {onOpenSpace ? (
        <button
          type="button"
          onClick={() => onOpenSpace(group.workspaceId)}
          className={headerClass}
          style={headerStyle}
        >
          {header}
        </button>
      ) : lone ? (
        <button
          type="button"
          onClick={() => onSelect(lone.paneId)}
          // The dot is the only place the pane's status shows, so it rides the accessible name too.
          aria-label={`${paneDisplayName(lone)}, ${STATUS_LABEL[lone.status]} · ${group.label}`}
          aria-current={loneActive ? "page" : undefined}
          className={headerClass}
          style={headerStyle}
        >
          {header}
        </button>
      ) : (
        <div className={headerClass} style={headerStyle}>
          {header}
        </div>
      )}

      <div className="relative pt-0.5">
        {/* The hierarchy, drawn: one hairline from the header down through the group, fading out
            rather than stopping dead at the last row. Brand-tinted for the space you're in. */}
        <span
          aria-hidden="true"
          className={cn(
            "absolute bottom-4 top-0 w-px rounded-full bg-linear-to-b",
            // --border sits a hair too close to every surface this list is painted on to read as a
            // line; the muted foreground is the same neutral, far enough off to be a hairline.
            active
              ? "from-brand/70 via-brand/45 to-transparent"
              : "from-muted-foreground/30 via-muted-foreground/16 to-transparent",
          )}
          style={{ left: rail }}
        />
        {!lone && group.panes.map((p) => (
          <PaneRow
            key={p.paneId}
            pane={p}
            tabLabel={tabs.find((t) => t.tabId === p.tabId)?.label}
            active={p.paneId === currentPaneId}
            onSelect={onSelect}
            dense={dense}
            surfaceRing={surfaceRing}
            showTab={spansTabs}
            rail={rail}
          />
        ))}
        {/* The worktrees of this space's repo — herdr's `└─` children, one level in. */}
        {group.children.map((child) => (
          <SpaceSection
            key={child.workspaceId}
            group={child}
            activeWorkspaceId={activeWorkspaceId}
            tabs={tabs}
            currentPaneId={currentPaneId}
            onSelect={onSelect}
            onOpenSpace={onOpenSpace}
            dense={dense}
            surfaceRing={surfaceRing}
            depth={depth + 1}
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
  rail,
}: {
  pane: AgentView;
  tabLabel: string | undefined;
  active: boolean;
  onSelect: (paneId: string) => void;
  dense?: boolean;
  surfaceRing: string;
  showTab: boolean;
  rail: number;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(pane.paneId)}
      // The dot is the only place the row's status shows, so it rides the accessible name too.
      aria-label={`${paneDisplayName(pane)}, ${STATUS_LABEL[pane.status]}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex w-full min-w-0 items-center gap-2 rounded-[10px] py-1.5 pr-2.5 text-left transition-colors",
        // A thumb needs 44px even when the row is down to one line.
        !dense && "min-h-11",
        active ? "bg-brand/16" : "hover:bg-muted/60 active:bg-muted",
      )}
      style={{ paddingLeft: rail + 13 }}
    >
      {/* The row's own status, sitting ON the rail: the attachment point IS the indicator. The ring
          is the list's background, so the hairline reads as passing behind the dot. */}
      <StatusDot
        status={pane.status}
        className={cn(
          "absolute top-1/2 size-[7px] -translate-y-1/2 ring-[3px]",
          surfaceRing,
          (pane.status === "idle" || pane.status === "unknown") && IDLE_DOT,
        )}
        style={{ left: rail - 3.5 }}
      />

      <PaneMeta
        pane={pane}
        dense={dense}
        tabLabel={showTab ? tabLabel : undefined}
        className="flex-1"
      />
    </button>
  );
}

/** Idle (or a shell, unknown) asks nothing of you: in this list its dot steps back so it can't pass
 *  for a list bullet. */
const IDLE_DOT = "opacity-55";

/**
 * What runs in a pane, on one line — `[icon] claude · p1 · ctx 8%`. The SAME line under a lone
 * pane's header and in a row of a multi-pane space, so one fact is always written one way.
 */
function PaneMeta({
  pane,
  dense,
  tabLabel,
  className,
}: {
  pane: AgentView;
  dense?: boolean;
  tabLabel?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1 text-foreground/70",
        dense ? "text-[11px]" : "text-xs",
        className,
      )}
    >
      {pane.kind === "shell" ? (
        <TerminalSquare className="size-3.5 shrink-0" />
      ) : (
        <AgentIcon agent={pane.agent} className="size-3.5 shrink-0" />
      )}
      <span className="min-w-0 truncate">{paneDisplayName(pane)}</span>
      {/* Only when the space spreads over several tabs — otherwise it's the only tab there. */}
      {tabLabel && <span className="min-w-0 truncate font-mono">· {tabLabel}</span>}
      {dense && (
        <span className="shrink-0">
          · <span className="font-mono text-[10px]">{pane.paneId.split(":").pop()}</span>
        </span>
      )}
      {pane.ctxPct != null && (
        <span className="shrink-0 tabular-nums">· ctx {Math.round(pane.ctxPct)}%</span>
      )}
    </span>
  );
}
