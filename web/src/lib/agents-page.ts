// The Agents page, as pure data: who is shown, under which project, in what order. The page
// (components/agents-page.tsx) only draws what this returns.
import { isOrchestrator, projectOf } from "./agent-groups";
import { paneDisplayName, type AgentView } from "./types";

export type StateFilter = "all" | "needs" | "working" | "idle";

export interface AgentsFilters {
  state: StateFilter;
  /** null every machine, "" this one, else a paired peer's name. */
  machine: string | null;
  hideOrch: boolean;
  terminals: boolean;
}

export const DEFAULT_FILTERS: AgentsFilters = { state: "all", machine: null, hideOrch: false, terminals: false };

export const stateOf = (a: Pick<AgentView, "status">): Exclude<StateFilter, "all"> =>
  a.status === "blocked" ? "needs" : a.status === "working" ? "working" : "idle";

export type Role = "card" | "orch" | "free" | "terminal";
export const roleOf = (a: AgentView): Role =>
  a.cardId || a.cardTitle ? "card" : a.kind === "shell" ? "terminal" : isOrchestrator(a) ? "orch" : "free";

/** The row's name: the card it works on, « Orchestrateur », else what the pane calls itself. `orch` is the translated word. */
export const nameOf = (a: AgentView, orch: string): string =>
  a.cardTitle ?? (roleOf(a) === "orch" ? orch : paneDisplayName(a));

export interface ProjectGroup {
  project: string;
  agents: AgentView[];
  /** Something in it waits or works. */
  live: boolean;
}

export interface AgentsPage {
  /** Before the state filter and the search: what the summary sentence and the state counts read. */
  counts: Record<Exclude<StateFilter, "all">, number>;
  /** The paired peers that have an agent here — one chip each, beside « this PC ». */
  machines: string[];
  live: ProjectGroup[];
  resting: ProjectGroup[];
}

const RANK = { needs: 0, working: 1, idle: 2 } as const;

/**
 * `internal`: the board's own panes (lead, copilot) — never listed. An orchestrator that waits for
 * the operator stays visible whatever `hideOrch` says; bare shells only with `terminals`.
 */
export function agentsPage(herd: AgentView[], f: AgentsFilters, query: string, internal: ReadonlySet<string>, orchWord: string): AgentsPage {
  const base = herd.filter(
    (a) =>
      !internal.has(a.paneId) &&
      (f.terminals || a.kind !== "shell") &&
      (!f.hideOrch || a.status === "blocked" || !isOrchestrator(a)),
  );
  const machines = [...new Set(base.flatMap((a) => (a.peer ? [a.peer] : [])))].sort();
  const q = query.trim().toLowerCase();
  const found = base.filter(
    (a) =>
      (f.machine === null || (a.peer ?? "") === f.machine) &&
      (!q || [nameOf(a, orchWord), a.cardTitle ?? "", projectOf(a.cwd), paneDisplayName(a)].some((s) => s.toLowerCase().includes(q))),
  );
  const counts = { needs: 0, working: 0, idle: 0 };
  for (const a of found) counts[stateOf(a)]++;

  const byProject = new Map<string, AgentView[]>();
  for (const a of found) {
    if (f.state !== "all" && stateOf(a) !== f.state) continue;
    const p = projectOf(a.cwd);
    byProject.set(p, [...(byProject.get(p) ?? []), a]);
  }
  const groups = [...byProject].map(([project, agents]): ProjectGroup => {
    // Waiting first, then working, then the newest to settle; orchestrators lead their state.
    agents.sort(
      (a, b) =>
        RANK[stateOf(a)] - RANK[stateOf(b)] ||
        Number(!isOrchestrator(a)) - Number(!isOrchestrator(b)) ||
        (b.statusSince ?? 0) - (a.statusSince ?? 0),
    );
    return { project, agents, live: agents.some((a) => stateOf(a) !== "idle") };
  });
  const worst = (g: ProjectGroup) => Math.min(...g.agents.map((a) => RANK[stateOf(a)]));
  const latest = (g: ProjectGroup) => Math.max(...g.agents.map((a) => a.statusSince ?? 0));
  const live = groups.filter((g) => g.live).sort((a, b) => worst(a) - worst(b) || a.project.localeCompare(b.project));
  const resting = groups.filter((g) => !g.live).sort((a, b) => latest(b) - latest(a) || a.project.localeCompare(b.project));
  return { counts, machines, live, resting };
}

/** « 12 min », « 2 h », « 3 j » — a footnote, not a clock. Units come translated. */
export function ago(ms: number, u: { min: string; h: string; d: string }): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} ${u.min}`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} ${u.h}` : `${Math.floor(h / 24)} ${u.d}`;
}
