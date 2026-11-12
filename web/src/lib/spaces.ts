// Helpers for the space/tab navigator: shape the flat snapshot (agents + shell panes + tabs) into
// the per-space, per-tab tree the home space view renders.
import {
  STATUS_RANK,
  type AgentStatus,
  type AgentView,
  type TabView,
  type WorkspaceView,
} from "./types";

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
  number: number;
  label: string;
  branch: string | null;
  cwd: string;
  panes: AgentView[];
  /** Agents needing attention in this space — drives the header's alert count. */
  blocked: number;
  /** The space's worst agent status (blocked > working > …), or null with only shells in it. */
  status: AgentStatus | null;
  /**
   * The worktree spaces cut from THIS space's repo — herdr's `└─` children. Empty for a space that
   * isn't a repo, or whose worktrees aren't open. Counters stay per-space: a parent's `blocked` /
   * `status` speak for its own panes only, and each child header says its own. Only the ORDERING
   * looks at the subtree, so a blocked worktree still drags its repo to the top of the list.
   */
  children: SpaceGroup[];
}

/**
 * herdr parks a card's worktree at `<…>/worktrees/<repo dir>/<branch slug>`, so the segment before
 * last names the repo it was cut from. That name is the ONLY thread in the snapshot tying the two:
 * no pane field carries a parent, and the worktree is a first-class space to herdr. Returns it, or
 * null for any cwd that isn't a worktree checkout — never a guess.
 */
function worktreeRepoDir(cwd: string): string | null {
  const parts = cwd.split("/").filter(Boolean);
  return parts.length >= 3 && parts.at(-3) === "worktrees" ? parts.at(-2)! : null;
}

/**
 * Shape the flat pane list into a tree of spaces — the pane list's ONLY grouping (home keeps the
 * AGENT_GROUPS triage; see agent-groups.ts). Two levels, both of them herdr's:
 *
 * - one group per space, and
 * - a space that is a WORKTREE of another open space hangs under it as a child, instead of floating
 *   as a sixteenth top-level row named after a truncated card title. That's the `└─` in herdr's
 *   sidebar. A worktree whose repo isn't open stays a root — never an invented parent.
 *
 * Urgency survives the regrouping by moving up a level: spaces sort worst-status-first *across the
 * subtree* (a blocked worktree pulls its repo up with it), then by workspace number, and each row
 * keeps its own status dot.
 *
 * `workspaces`, when given, seeds a group per space so one with no pane in the snapshot still gets a
 * row — the Spaces page lists spaces, the pane switcher only lists what you can switch to.
 *
 * Panes ride in the order the bridge sent them (status → space → pane), agents before shells, so two
 * renders of an unchanged herd give the same list.
 */
/** hc has no spaces: the bridge files every terminal under this one id (bridge/mux/hc.ts `HC_SPACE`). */
export const HC_SPACE = "hc";

/**
 * The group a pane belongs to. A herdr 0.9 pane: its space. An hc pane: its directory — the repo it
 * runs in, or the plain folder of a shell — since the one "hc" space would lump every repo together.
 * Such a group is not a space herdr knows, so it can't be drilled into (see {@link isHcGroup}).
 */
export function spaceKey(pane: AgentView): string {
  return pane.workspaceId === HC_SPACE ? `${HC_SPACE}:${pane.cwd}` : pane.workspaceId;
}

export const isHcGroup = (workspaceId: string): boolean => workspaceId.startsWith(`${HC_SPACE}:`);

export function groupPanesBySpace(
  agents: AgentView[],
  shellPanes: AgentView[],
  workspaces: WorkspaceView[] = [],
): SpaceGroup[] {
  const groups = new Map<string, SpaceGroup>();
  const blank = (workspaceId: string, number: number, label: string, cwd: string): SpaceGroup => ({
    workspaceId,
    number,
    label,
    branch: null,
    cwd,
    panes: [],
    blocked: 0,
    status: null,
    children: [],
  });

  for (const w of workspaces) {
    if (w.workspaceId === HC_SPACE) continue; // its panes regroup by directory below
    groups.set(w.workspaceId, blank(w.workspaceId, w.number, w.label, ""));
  }
  for (const pane of [...agents, ...shellPanes]) {
    const key = spaceKey(pane);
    let g = groups.get(key);
    if (!g) {
      const label = isHcGroup(key) ? (pane.cwd.split("/").filter(Boolean).at(-1) ?? pane.cwd) : pane.workspaceLabel;
      g = blank(key, pane.workspaceNumber, label, pane.cwd);
      groups.set(key, g);
    }
    // A seeded group has no cwd of its own — WorkspaceView doesn't carry one; its first pane says it.
    if (!g.cwd) g.cwd = pane.cwd;
    g.panes.push(pane);
    g.branch ??= pane.branch ?? null;
    if (pane.kind === "shell") continue;
    if (pane.status === "blocked") g.blocked += 1;
    if (g.status === null || STATUS_RANK[pane.status] < STATUS_RANK[g.status]) g.status = pane.status;
  }

  // Index the spaces that could BE a repo by their directory name, and hang each worktree off its
  // own. A worktree is never itself a parent, which is also what stops the tree from cycling.
  const all = [...groups.values()];
  const byRepoDir = new Map<string, SpaceGroup>();
  for (const g of all) {
    const dir = g.cwd.split("/").filter(Boolean).at(-1);
    if (dir && worktreeRepoDir(g.cwd) === null && !byRepoDir.has(dir)) byRepoDir.set(dir, g);
  }
  const roots: SpaceGroup[] = [];
  for (const g of [...all]) {
    const repoDir = worktreeRepoDir(g.cwd);
    let parent = repoDir ? byRepoDir.get(repoDir) : undefined;
    // Under hc a card's worktree still names its repo; with no terminal open there, the repo gets a
    // header of its own rather than the worktree floating as a root titled by its branch slug.
    if (!parent && repoDir && isHcGroup(g.workspaceId)) {
      parent = blank(`${HC_SPACE}:worktrees/${repoDir}`, g.number, repoDir, "");
      byRepoDir.set(repoDir, parent);
      all.push(parent);
      roots.push(parent);
    }
    if (parent && parent !== g) parent.children.push(g);
    else roots.push(g);
  }

  // A space with only shells has no status to rank on; it sorts after every space that has one.
  const rank = (g: SpaceGroup): number =>
    Math.min(g.status === null ? 99 : STATUS_RANK[g.status], ...g.children.map(rank));
  const byUrgency = (a: SpaceGroup, b: SpaceGroup) => rank(a) - rank(b) || a.number - b.number;
  for (const g of all) g.children.sort(byUrgency);
  return roots.sort(byUrgency);
}
