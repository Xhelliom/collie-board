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
  /** Empty for the "no phase" section: its name is the viewer's language, the view supplies it. */
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
  /** The figures below count the OPEN scope only: steps that are not in a validated phase (ADR 0025). */
  total: number;
  done: number;
  /** Steps an agent is on right now: working, starting. */
  active: number;
  /** Steps that need the operator: blocked, in review, orphaned. */
  waiting: number;
  /** Steps not started: ready, backlog. */
  todo: number;
  /** The phases still in progress (and the "no phase" section). */
  phases: ProjectPhase[];
  /** The validated phases — milestones — oldest first, with the steps they froze. */
  closed: ProjectPhase[];
  /** Finished steps in validated phases: what was delivered before the current milestone. */
  deliveredSteps: number;
  closedCount: number;
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
  let closed: ProjectPhase[] = [];
  if (phaseRows.length) {
    const known = new Set(phaseRows.map((p) => p.id));
    const sorted = [...phaseRows].sort((a, b) => a.position - b.position);
    const shutIds = new Set(sorted.filter((p) => p.closedAt != null).map((p) => p.id));
    // A validated phase holds what was DELIVERED. An open step that got filed there afterwards is still
    // work in progress — it must not vanish from the figures or from "waiting for you".
    const frozen = (s: CardView) => !!s.phaseId && shutIds.has(s.phaseId) && s.status === "done";
    const build = (p: Phase) =>
      section(p.id, p.name, p.goal, p, null, steps.filter((s) => s.phaseId === p.id && (p.closedAt == null || frozen(s))));
    phases = sorted.filter((p) => p.closedAt == null).map(build);
    closed = sorted.filter((p) => p.closedAt != null).sort((a, b) => a.closedAt! - b.closedAt!).map(build);
    const loose = steps.filter((s) => !frozen(s) && (!s.phaseId || !known.has(s.phaseId) || shutIds.has(s.phaseId)));
    // What no phase has taken keeps the shape it had: a dictation's steps stay a section of their own, so an
    // old project can be validated one dictation at a time, not only as one lump.
    const dictations = live.filter((c) => parents.has(c.id)).sort(byPosition);
    for (const c of dictations) {
      const own = loose.filter((s) => s.parentId === c.id);
      if (own.length) phases.push(section(c.id, c.title, "", null, c, own));
    }
    const rest = loose.filter((s) => !s.parentId || !parents.has(s.parentId));
    if (rest.length || lotRows.some((l) => !l.phaseId || !known.has(l.phaseId))) phases.push(section("loose", "", "", null, null, rest));
  } else {
    phases = live
      .filter((c) => parents.has(c.id))
      .sort(byPosition)
      .map((c) => section(c.id, c.title, "", null, c, steps.filter((s) => s.parentId === c.id)));
    const loose = steps.filter((s) => !s.parentId || !parents.has(s.parentId));
    if (loose.length) phases.push(section("loose", "", "", null, null, loose));
  }

  const ordered = phases.flatMap((p) => p.steps);
  return {
    total: ordered.length,
    done: ordered.filter((s) => s.status === "done").length,
    active: ordered.filter((s) => stepGroup(s) === "flight").length,
    waiting: ordered.filter((s) => stepGroup(s) === "waiting").length,
    todo: ordered.filter((s) => stepGroup(s) === "todo").length,
    phases,
    closed,
    deliveredSteps: closed.reduce((n, p) => n + p.steps.filter((s) => s.status === "done").length, 0),
    closedCount: closed.length,
    awaiting: ["blocked", "review", "orphaned"].flatMap((st) => ordered.filter((s) => s.status === st)),
    next: ordered.find((s) => s.status === "ready" && dependencyMet(s.dependsOn ? byId.get(s.dependsOn) : null)) ?? null,
  };
}
