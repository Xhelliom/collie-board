// Helpers for the space/tab navigator: shape the flat snapshot (agents + shell panes + tabs) into
// the per-space, per-tab tree the home space view renders.
import { STATUS_RANK, type AgentStatus, type AgentView, type TabView } from "./types";

export interface TabGroup {
  tabId: string;
  label: string;
  panes: AgentView[];
}

/**
 * Group a workspace's panes (agents + shells) by tab, in tab order. Panes whose tab isn't in the
 * tab list yet (a brief poll race after a create) fall into a trailing group so they're never lost.
 */
export function groupPanesByTab(
  workspaceId: string,
  tabs: TabView[],
  agents: AgentView[],
  shellPanes: AgentView[],
): TabGroup[] {
  const panes = [...agents, ...shellPanes].filter((p) => p.workspaceId === workspaceId);
  const wsTabs = tabs.filter((t) => t.workspaceId === workspaceId);

  const groups: TabGroup[] = wsTabs.map((t) => ({
    tabId: t.tabId,
    label: t.label,
    panes: panes.filter((p) => p.tabId === t.tabId),
  }));

  const known = new Set(wsTabs.map((t) => t.tabId));
  const orphans = panes.filter((p) => !known.has(p.tabId));
  if (orphans.length) groups.push({ tabId: `${workspaceId}:other`, label: "…", panes: orphans });

  return groups;
}

/** Agents needing attention (blocked) in a workspace — drives the space chip's alert dot. */
export function blockedCount(workspaceId: string, agents: AgentView[]): number {
  return agents.filter((a) => a.workspaceId === workspaceId && a.status === "blocked").length;
}

/**
 * The most-urgent agent status in a workspace (blocked > working > … > done), or null if the space
 * has no agents at all (only shells, or empty). Drives the status dot beside each space row.
 */
export function worstSpaceStatus(workspaceId: string, agents: AgentView[]): AgentStatus | null {
  const inWs = agents.filter((a) => a.workspaceId === workspaceId);
  if (inWs.length === 0) return null;
  return inWs.reduce<AgentStatus>(
    (worst, a) => (STATUS_RANK[a.status] < STATUS_RANK[worst] ? a.status : worst),
    inWs[0]!.status,
  );
}

/**
 * One space's row in the pane list: its identity, the secondary line under its name, and its panes.
 * `branch` is the space's current branch when a pane in it backs an open card session — the same
 * `card.branch` the snapshot already carries, never a fresh git call — and null otherwise, where the
 * header falls back to `cwd`. A branch we can't read is shown as no branch, never as a guess.
 */
export interface SpaceGroup {
  workspaceId: string;
  label: string;
  branch: string | null;
  cwd: string;
  panes: AgentView[];
  /** Agents needing attention in this space — drives the header's alert count. */
  blocked: number;
  /** The space's worst agent status (blocked > working > …), or null with only shells in it. */
  status: AgentStatus | null;
}

/**
 * Shape the flat pane list into one group per space — the pane list's ONLY grouping (home keeps the
 * AGENT_GROUPS triage; see agent-groups.ts). Urgency survives the regrouping by moving up a level:
 * spaces sort worst-status-first, then by workspace number, and each row keeps its own status dot.
 *
 * Panes ride in the order the bridge sent them (status → space → pane), agents before shells, so two
 * renders of an unchanged herd give the same list.
 */
export function groupPanesBySpace(agents: AgentView[], shellPanes: AgentView[]): SpaceGroup[] {
  const groups = new Map<string, SpaceGroup>();
  for (const pane of [...agents, ...shellPanes]) {
    let g = groups.get(pane.workspaceId);
    if (!g) {
      g = {
        workspaceId: pane.workspaceId,
        label: pane.workspaceLabel,
        branch: null,
        cwd: pane.cwd,
        panes: [],
        blocked: 0,
        status: null,
      };
      groups.set(pane.workspaceId, g);
    }
    g.panes.push(pane);
    g.branch ??= pane.branch ?? null;
    if (pane.kind === "shell") continue;
    if (pane.status === "blocked") g.blocked += 1;
    if (g.status === null || STATUS_RANK[pane.status] < STATUS_RANK[g.status]) g.status = pane.status;
  }
  // A space with only shells has no status to rank on; it sorts after every space that has one.
  const rank = (g: SpaceGroup) => (g.status === null ? 99 : STATUS_RANK[g.status]);
  return [...groups.values()].sort(
    (a, b) => rank(a) - rank(b) || (a.panes[0]?.workspaceNumber ?? 0) - (b.panes[0]?.workspaceNumber ?? 0),
  );
}
