// Who an agent is, in one place: the fields every agent line draws (Agents page, home, and the
// lists that follow) come from here, so two screens can't name or describe the same pane apart.
import { isOrchestrator, projectOf } from "./agent-groups";
import { paneDisplayName, type AgentView } from "./types";

export type Role = "card" | "orch" | "free" | "terminal";
export type AgentState = "needs" | "working" | "idle";
/** `AgentState` with idle split in two, for the words: « terminé il y a » reads apart from « au repos depuis ». */
export type StateWord = AgentState | "done";
/** The efforts Claude Code writes on a turn. Any other value is not shown: a word we can't translate is a guess. */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export const stateOf = (a: Pick<AgentView, "status">): AgentState =>
  a.status === "blocked" ? "needs" : a.status === "working" ? "working" : "idle";

export const roleOf = (a: AgentView): Role =>
  a.cardId || a.cardTitle ? "card" : a.kind === "shell" ? "terminal" : isOrchestrator(a) ? "orch" : "free";

/** The line's name: the card it works on, « Orchestrateur », else what the pane calls itself. `orch` is the translated word. */
export const nameOf = (a: AgentView, orch: string): string =>
  a.cardTitle ?? (roleOf(a) === "orch" ? orch : paneDisplayName(a));

export interface AgentIdentity {
  name: string;
  role: Role;
  /** The card it works for — the line links to it. */
  cardId: string | null;
  /** What it does: its project for an orchestrator, else its own last words. Null rather than guessed. */
  detail: string | null;
  state: AgentState;
  word: StateWord;
  /** When the current state began (epoch ms); null when the bridge never saw it start. */
  since: number | null;
  /** The paired peer it runs on; null on this machine. */
  machine: string | null;
  model: string | null;
  effort: Effort | null;
  ctxPct: number | null;
}

/** Everything an agent line shows, from the snapshot alone. PURE. */
export function agentIdentity(a: AgentView, orch: string): AgentIdentity {
  const role = roleOf(a);
  const state = stateOf(a);
  return {
    name: nameOf(a, orch),
    role,
    cardId: a.cardId ?? null,
    detail: role === "orch" ? projectOf(a.cwd) : role === "terminal" ? null : (a.said ?? null),
    state,
    word: state === "idle" && a.status === "done" ? "done" : state,
    since: a.statusSince ?? null,
    machine: a.peer ?? null,
    model: a.model ?? null,
    // An effort with no model would float on its own: the pair goes together or not at all.
    effort: a.model && (EFFORTS as readonly string[]).includes(a.effort ?? "") ? (a.effort as Effort) : null,
    ctxPct: a.ctxPct ?? null,
  };
}
