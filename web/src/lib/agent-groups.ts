// The triage grouping used by both the home list and the thread sidebar. Kept in one place so the
// two views can't drift apart. "Needs you" first (accented), then active work, then everything else.
import type { AgentStatus, AgentView } from "./types";

export interface AgentGroup {
  key: string;
  label: string;
  match: (s: AgentStatus) => boolean;
  accent?: boolean;
  /** Section bullet class — the same status palette the badges use, so a group's color can't drift
   *  from the status it collects. */
  dot: string;
}

export const AGENT_GROUPS: readonly AgentGroup[] = [
  { key: "needs", label: "Needs you", match: (s) => s === "blocked", accent: true, dot: "bg-status-blocked" },
  { key: "working", label: "Working", match: (s) => s === "working", dot: "bg-status-working" },
  { key: "other", label: "Idle · done", match: (s) => s !== "blocked" && s !== "working", dot: "bg-status-idle" },
];

/**
 * The members of a triage group, in display order — the one place the three pane lists (home,
 * ThreadSidebar, PaneListColumn) get their rows from, so they can't order them differently.
 *
 * "Idle · done" reads newest-first on `statusSince`, the very instant the row already prints as
 * "5m ago": the session that settled last sits on top. Everything else keeps the bridge's incoming
 * order (status → space → pane). Panes the bridge never witnessed settle carry no `statusSince` and
 * fall to the bottom in that same incoming order — sort is stable, so two renders of an unchanged
 * herd give the same list.
 */
export function groupMembers(agents: AgentView[], g: AgentGroup): AgentView[] {
  const members = agents.filter((a) => g.match(a.status));
  if (g.key !== "other") return members;
  return members.sort((a, b) => (b.statusSince ?? 0) - (a.statusSince ?? 0));
}
