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

export interface ProjectView {
  total: number;
  done: number;
  /** Steps with an agent on them or a diff waiting: working, starting, review. */
  active: number;
  phases: ProjectPhase[];
  /** Steps that need the operator — blocked or waiting for review — most urgent first. */
  awaiting: CardView[];
  /** The first step that could start now: ready, and its predecessor filed. */
  next: CardView | null;
}

const ACTIVE = new Set(["working", "starting", "review"]);
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
    active: steps.filter((s) => ACTIVE.has(s.status)).length,
    phases,
    awaiting: ["blocked", "review"].flatMap((st) => ordered.filter((s) => s.status === st)),
    next: ordered.find((s) => s.status === "ready" && dependencyMet(s.dependsOn ? byId.get(s.dependsOn) : null)) ?? null,
  };
}
