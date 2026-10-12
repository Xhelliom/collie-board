import { describeEvent } from "@/components/card-journal";
import type { BoardEvent } from "@/lib/board";

// A card's milestones — DERIVED from its journal on every read, never stored or declared (the card is
// durable, the state is read). Pure. Labels are the journal's own sentences (describeEvent).

export type MilestoneKind = "started" | "sentBack" | "gate" | "lead" | "review" | "prOpened" | "prMerged" | "prClosed" | "finished";
export type MilestoneTone = "good" | "bad" | "warn" | "plain";

export interface Milestone {
  kind: MilestoneKind;
  tone: MilestoneTone;
  ts: number;
  /** The events behind it, oldest first: more than one makes the milestone expandable. */
  events: BoardEvent[];
  /** Only `sentBack`: how many round-trips with the lead it folds. */
  count?: number;
}

/** Kinds where only the newest occurrence is the state of the card. */
const LATEST = new Set<MilestoneKind>(["started", "gate", "lead", "review", "finished"]);

function classify(e: BoardEvent): Pick<Milestone, "kind" | "tone"> | null {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  switch (e.type) {
    case "session.opened":
      return { kind: "started", tone: "plain" };
    case "run.gate":
      return { kind: "gate", tone: p.ok ? "good" : "bad" };
    case "run.decision":
      return p.decision === "prompt" ? { kind: "sentBack", tone: "warn" } : p.decision === "finished" ? { kind: "lead", tone: "good" } : null;
    case "review.created":
      return { kind: "review", tone: p.verdict === "complete" ? "good" : "warn" };
    case "card.pr_opened":
      return { kind: "prOpened", tone: "plain" };
    case "card.pr_merged":
      return { kind: "prMerged", tone: "good" };
    case "card.pr_closed":
      return { kind: "prClosed", tone: "bad" };
    case "card.status":
      return p.to === "done" ? { kind: "finished", tone: "good" } : null;
    default:
      return null;
  }
}

/** The milestones of a card, oldest first, from its journal (any order). Everything else is noise. */
export function cardMilestones(events: readonly BoardEvent[]): Milestone[] {
  const out: Milestone[] = [];
  for (const e of [...events].sort((a, b) => a.id - b.id)) {
    const c = classify(e);
    if (!c) {
      // "Finished" is the card's status: moved out of done again (a reopen), it is no longer true.
      if (e.type === "card.status") {
        const i = out.findIndex((m) => m.kind === "finished");
        if (i >= 0) out.splice(i, 1);
      }
      continue;
    }
    if (c.kind === "sentBack") {
      const prev = out.find((m) => m.kind === "sentBack");
      if (prev) {
        prev.events.push(e);
        prev.count = prev.events.length;
        prev.ts = e.ts;
        continue;
      }
      out.push({ ...c, ts: e.ts, events: [e], count: 1 });
      continue;
    }
    if (LATEST.has(c.kind)) {
      // ponytail: "started" keeps the newest session, not the first — a restart is the card starting again
      const i = out.findIndex((m) => m.kind === c.kind);
      if (i >= 0) out.splice(i, 1);
    }
    out.push({ ...c, ts: e.ts, events: [e] });
  }
  return out;
}

/** The line a milestone shows. */
export const milestoneLabel = (m: Milestone, sentBack: (count: number) => string): string =>
  m.kind === "sentBack" ? sentBack(m.count ?? m.events.length) : describeEvent(m.events[0]!);
