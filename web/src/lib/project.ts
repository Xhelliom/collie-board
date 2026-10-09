import { dependencyMet } from "@/lib/board-groups";
import type { CardView } from "@/lib/board";

// The project view: one repo's cards read as a road map — phases (containers), their steps, and what
// is waiting on a human. NOTHING here is stored: every figure is derived from the cards, so it cannot
// drift from the board (the same rule as repos.ts). A container holds no work of its own, so it is a
// phase and never counted as a step.

export interface ProjectPhase {
  /** Null for the steps that belong to no container. */
  container: CardView | null;
  steps: CardView[];
  done: number;
}

/** What a step is doing, in the four words the project view filters by. */
export type StepGroup = "done" | "flight" | "waiting" | "todo";

export interface ProjectView {
  total: number;
  done: number;
  /** Steps an agent is on right now: working, starting. */
  active: number;
  /** Steps that need the operator: blocked, in review, orphaned. */
  waiting: number;
  /** Steps not started: ready, backlog. */
  todo: number;
  phases: ProjectPhase[];
  /** Steps that need the operator — blocked, in review or orphaned — most urgent first. */
  awaiting: CardView[];
  /** The first step that could start now: ready, and its predecessor filed. */
  next: CardView | null;
}

const GROUP: Record<string, StepGroup> = {
  done: "done",
  working: "flight",
  starting: "flight",
  blocked: "waiting",
  review: "waiting",
  orphaned: "waiting",
  ready: "todo",
  backlog: "todo",
};
export const stepGroup = (c: Pick<CardView, "status">): StepGroup => GROUP[c.status] ?? "todo";
const byPosition = (a: CardView, b: CardView) => a.position - b.position || a.createdAt - b.createdAt;

/** Pure over the cards handed in (already scoped to one repo by the caller). */
export function projectOf(cards: CardView[]): ProjectView {
  const live = cards.filter((c) => c.status !== "archived");
  const byId = new Map(live.map((c) => [c.id, c]));
  const parents = new Set(live.map((c) => c.parentId).filter((id): id is string => !!id && byId.has(id)));
  const steps = live.filter((c) => !parents.has(c.id));

  const phases: ProjectPhase[] = live
    .filter((c) => parents.has(c.id))
    .sort(byPosition)
    .map((container) => ({ container, steps: steps.filter((s) => s.parentId === container.id).sort(byPosition), done: 0 }));
  const loose = steps.filter((s) => !s.parentId || !parents.has(s.parentId)).sort(byPosition);
  if (loose.length) phases.push({ container: null, steps: loose, done: 0 });
  for (const p of phases) p.done = p.steps.filter((s) => s.status === "done").length;

  const ordered = phases.flatMap((p) => p.steps);
  return {
    total: steps.length,
    done: steps.filter((s) => s.status === "done").length,
    active: steps.filter((s) => stepGroup(s) === "flight").length,
    waiting: steps.filter((s) => stepGroup(s) === "waiting").length,
    todo: steps.filter((s) => stepGroup(s) === "todo").length,
    phases,
    awaiting: ["blocked", "review", "orphaned"].flatMap((st) => ordered.filter((s) => s.status === st)),
    next: ordered.find((s) => s.status === "ready" && dependencyMet(s.dependsOn ? byId.get(s.dependsOn) : null)) ?? null,
  };
}
