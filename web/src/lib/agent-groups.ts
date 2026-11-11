// The triage grouping used by both the home list and the thread sidebar. Kept in one place so the
// two views can't drift apart. "Needs you" first (accented), then active work, then everything else.
import type { MessageKey } from "@/i18n";
import { repoName } from "./board";
import type { AgentStatus, AgentView, WorkspaceView } from "./types";

export interface AgentGroup {
  key: string;
  /** Catalog key of the section title. */
  label: MessageKey;
  match: (s: AgentStatus) => boolean;
  accent?: boolean;
  /** Section bullet class — the same status palette the badges use, so a group's color can't drift
   *  from the status it collects. */
  dot: string;
}

export const AGENT_GROUPS: readonly AgentGroup[] = [
  { key: "needs", label: "home.group.needs", match: (s) => s === "blocked", accent: true, dot: "bg-status-blocked" },
  { key: "working", label: "home.group.working", match: (s) => s === "working", dot: "bg-status-working" },
  { key: "other", label: "home.group.other", match: (s) => s !== "blocked" && s !== "working", dot: "bg-status-idle" },
];

/**
 * The members of a triage group, in display order — the one place the three pane lists (home,
 * ThreadSidebar, PaneListColumn) get their rows from, so they can't order them differently.
 *
 * Orchestrators lead every group (they are the conversations the operator returns to most); then
 * "Idle · done" reads newest-first on `statusSince`, the very instant the row already prints as
 * "5m ago": the session that settled last sits on top. Everything else keeps the bridge's incoming
 * order (status → space → pane). Panes the bridge never witnessed settle carry no `statusSince` and
 * fall to the bottom in that same incoming order — sort is stable, so two renders of an unchanged
 * herd give the same list.
 */
export function groupMembers(agents: AgentView[], g: AgentGroup): AgentView[] {
  const members = agents.filter((a) => g.match(a.status));
  const rank = (a: AgentView) => (isOrchestrator(a) ? 0 : 1);
  if (g.key !== "other") return members.sort((a, b) => rank(a) - rank(b));
  return members.sort((a, b) => rank(a) - rank(b) || (b.statusSince ?? 0) - (a.statusSince ?? 0));
}

/**
 * Is this pane a project's orchestrator? The same derivation as bridge/orchestrator.ts
 * `findOrchestrator`: its workspace is labelled `orchestrator-<repo basename>` AND it runs in that
 * repo — nothing declared, so an operator's own session in the repo is never taken for it.
 */
export const isOrchestrator = (a: Pick<AgentView, "workspaceId" | "workspaceLabel" | "paneLabel" | "cwd">): boolean =>
  // hc has no workspace: the label the bridge gave the orchestrator's space is its pane's (bridge/mux/hc.ts).
  !!a.cwd && (isHcAgent(a) ? a.paneLabel : a.workspaceLabel) === `orchestrator-${repoName(a.cwd)}`;

/** The one synthetic space hc shows every terminal in (bridge/mux/hc.ts `HC_SPACE`): hc has no spaces, no tabs. */
export const HC_SPACE = "hc";

/** The same fact off a pane id alone — hc's addresses are `t` + base 36 (bridge/mux/composite.ts `ownerOf`). */
export const isHcPaneId = (paneId: string): boolean => /^t[0-9a-z]+$/.test(paneId);

export const isHcAgent = (a: Pick<AgentView, "workspaceId">): boolean => a.workspaceId === HC_SPACE;

/**
 * A bare terminal the operator opened from a Project page under hc (bridge/open-routes.ts `FREE_PREFIX`):
 * it has no Spaces tab to live in, so the herd lists it. Not an agent's helper terminals — those carry no such label.
 */
export const isFreeShell = (a: Pick<AgentView, "workspaceId" | "paneLabel">): boolean => isHcAgent(a) && !!a.paneLabel?.startsWith("free-");

/** Spaces and tabs are herdr 0.9's: hidden when every space is hc's. An empty list (0.9 with nothing open, or no snapshot yet) keeps them. */
export const showsSpaces = (workspaces: readonly Pick<WorkspaceView, "workspaceId">[]): boolean =>
  workspaces.length === 0 || workspaces.some((w) => w.workspaceId !== HC_SPACE);

/** The project a pane works in: its cwd's repo — a card's worktree (`~/.herdr/worktrees/<repo>/<branch>`, bridge/git.ts) names it. */
export function projectOf(cwd: string): string {
  return /\/\.herdr\/worktrees\/([^/]+)\//.exec(`${cwd}/`)?.[1] ?? repoName(cwd);
}

/** Where a pane lives, as a label: its space under herdr 0.9; under hc, whose one space is named "hc", its project. */
export const placeOf = (a: Pick<AgentView, "workspaceId" | "workspaceLabel" | "cwd">): string =>
  isHcAgent(a) ? projectOf(a.cwd) : a.workspaceLabel;

/**
 * The hc herd by project (ADR 0052 phase 4): projects by name, and in each the orchestrator first,
 * then the cards' agents, then every other terminal. Sort is stable, so the bridge's order holds within a rank.
 */
export function projectGroups(agents: AgentView[]): { project: string; members: AgentView[] }[] {
  const rank = (a: AgentView) => (isOrchestrator(a) ? 0 : a.cardId ? 1 : 2);
  const byProject = new Map<string, AgentView[]>();
  for (const a of agents) {
    const p = projectOf(a.cwd);
    byProject.set(p, [...(byProject.get(p) ?? []), a]);
  }
  return [...byProject]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([project, members]) => ({ project, members: members.sort((x, y) => rank(x) - rank(y)) }));
}
