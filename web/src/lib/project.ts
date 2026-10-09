import { dependencyMet } from "@/lib/board-groups";
import type { CardView, Lot, Phase } from "@/lib/board";

// The project view: one repo's cards read as a road map — phases, their lots and steps, and what is
// waiting on a human. Every FIGURE is derived from the cards, so it cannot drift from the board (the
// same rule as repos.ts). Phases come from the phase table (ADR 0021); a repo with none falls back
// to its containers, then to one "No phase". A container holds no work of its own: never a step.

/** A lot with the cards it holds, in the order the board would run them. */
export interface ProjectLot {
  lot: Lot;
  cards: CardView[];
  done: number;
}

export interface ProjectPhase {
  /** Stable React / anchor key: the phase id, the container id, or "loose". */
  key: string;
  title: string;
  goal: string;
  /** The table row, when this section is one. */
  phase: Phase | null;
  /** The container this section stands in for, when the repo has no phase table rows. */
  container: CardView | null;
  steps: CardView[];
  done: number;
  lots: ProjectLot[];
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
export function projectOf(cards: CardView[], phaseRows: Phase[] = [], lotRows: Lot[] = []): ProjectView {
  const live = cards.filter((c) => c.status !== "archived");
  const byId = new Map(live.map((c) => [c.id, c]));
  const parents = new Set(live.map((c) => c.parentId).filter((id): id is string => !!id && byId.has(id)));
  const steps = live.filter((c) => !parents.has(c.id));
  const section = (key: string, title: string, goal: string, phase: Phase | null, container: CardView | null, own: CardView[]): ProjectPhase => {
    const mine = own.sort(byPosition);
    const lots = lotRows
      .filter((l) => (phase ? l.phaseId === phase.id : key === "loose" && !phaseRows.some((p) => p.id === l.phaseId)))
      .sort((a, b) => a.position - b.position)
      .map((lot) => {
        const lotCards = lot.cardIds.map((id) => byId.get(id)).filter((c): c is CardView => !!c).sort(byPosition);
        return { lot, cards: lotCards, done: lotCards.filter((c) => c.status === "done").length };
      });
    return { key, title, goal, phase, container, steps: mine, done: mine.filter((s) => s.status === "done").length, lots };
  };

  let phases: ProjectPhase[];
  if (phaseRows.length) {
    const known = new Set(phaseRows.map((p) => p.id));
    phases = [...phaseRows]
      .sort((a, b) => a.position - b.position)
      .map((p) => section(p.id, p.name, p.goal, p, null, steps.filter((s) => s.phaseId === p.id)));
    const loose = steps.filter((s) => !s.phaseId || !known.has(s.phaseId));
    if (loose.length || lotRows.some((l) => !l.phaseId || !known.has(l.phaseId))) phases.push(section("loose", "No phase", "", null, null, loose));
  } else {
    phases = live
      .filter((c) => parents.has(c.id))
      .sort(byPosition)
      .map((c) => section(c.id, c.title, "", null, c, steps.filter((s) => s.parentId === c.id)));
    const loose = steps.filter((s) => !s.parentId || !parents.has(s.parentId));
    if (loose.length) phases.push(section("loose", "No phase", "", null, null, loose));
  }

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
