import type { CardView, Phase } from "@/lib/board";
import { repoName } from "@/lib/board";
import { AGENT_GROUPS, groupMembers } from "@/lib/agent-groups";
import { projectOf, stepGroup } from "@/lib/project";
import type { AgentView } from "@/lib/types";

// What the home dashboard shows besides the herd, derived from the cards on screen — no request of
// its own, so it cannot disagree with the board (same rule as project.ts / repos.ts).

const WEEK = 7 * 24 * 3600 * 1000;

/** A milestone still in progress: what the tile draws, instead of every step the repo ever had. */
export interface CurrentPhase {
  key: string;
  title: string;
  done: number;
  steps: CardView[];
}

export interface RepoTile {
  path: string;
  name: string;
  current: CurrentPhase[];
  /** Steps an agent is on / that wait for you, over the current phases only. */
  active: number;
  waiting: number;
  /** Validated milestones, for a repo with nothing in progress. */
  closedCount: number;
  updatedAt: number;
}

export interface DashboardView {
  review: number;
  /** Blocked or orphaned: stuck without an agent. */
  stuck: number;
  ready: number;
  /** Done in the last 7 days. ponytail: `updatedAt` stands in for "finished at" — a later edit of a done card
   *  re-counts it; add a doneAt to the card if that ever misleads. */
  delivered: number;
  repos: RepoTile[];
}

export function dashboardOf(cards: CardView[], now = Date.now(), phases: Record<string, Phase[]> = {}): DashboardView {
  const live = cards.filter((c) => c.status !== "archived");
  const count = (...st: CardView["status"][]) => live.filter((c) => st.includes(c.status)).length;
  const byRepo = new Map<string, CardView[]>();
  for (const c of live) if (c.repoPath) byRepo.set(c.repoPath, [...(byRepo.get(c.repoPath) ?? []), c]);
  const repos = [...byRepo].map(([path, own]): RepoTile => {
    const v = projectOf(own, phases[path] ?? []);
    // A phase-table row is current while open (even all done: it awaits its validation); a dictation's
    // section only while it has work left. The "no phase" remainder is never a milestone.
    const current = v.phases
      .filter((p) => p.steps.length > 0 && (p.phase || (p.container && p.steps.some((s) => s.status !== "done"))))
      .map((p) => ({ key: p.key, title: p.title, done: p.done, steps: p.steps }));
    const shown = current.flatMap((p) => p.steps);
    return {
      path,
      name: repoName(path),
      current,
      active: shown.filter((s) => stepGroup(s) === "flight").length,
      waiting: shown.filter((s) => stepGroup(s) === "waiting").length,
      closedCount: v.closedCount,
      updatedAt: own.reduce((m, c) => Math.max(m, c.updatedAt), 0),
    };
  });
  return {
    review: count("review"),
    stuck: count("blocked", "orphaned"),
    ready: count("ready"),
    delivered: live.filter((c) => c.status === "done" && now - c.updatedAt < WEEK).length,
    // A repo with something waiting for you first, then the most recently touched.
    repos: repos.sort((a, b) => Number(b.waiting > 0) - Number(a.waiting > 0) || b.updatedAt - a.updatedAt),
  };
}

/** The herd in the three triage groups the list below uses — [needs, working, idle·done]. */
export function herdCounts(agents: AgentView[]): [number, number, number] {
  const [n, w, o] = AGENT_GROUPS.map((g) => groupMembers(agents, g).length);
  return [n ?? 0, w ?? 0, o ?? 0];
}
