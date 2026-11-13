// What a card's page needs to decide before it draws anything — which of its four faces to show, who
// did each thing in its history, and what the closing report said about each criterion. All DERIVED
// from what the card and its journal already hold, never stored. Pure, so each rule is tested.
import { cardMilestones, milestoneLabel } from "./card-milestones";
import type { CardReport } from "./card-report";
import type { BoardEvent, CardView } from "./board";

/** The card's four faces: not launched, running, stopped and waiting on you, finished. */
export type FicheState = "todo" | "running" | "stopped" | "done";

export function ficheState(card: Pick<CardView, "status" | "runtime">, report: Pick<CardReport, "conclusion"> | null): FicheState {
  if (card.status === "done" || card.status === "archived") return "done";
  if (card.status === "orphaned") return "stopped";
  // The lead gave up on it: whatever its column says, the next move is the operator's.
  if (report?.conclusion?.kind === "halted") return "stopped";
  // Blocked WITH its pane is an agent asking a question: still running, the agent panel answers it.
  if (card.status === "blocked" && !card.runtime) return "stopped";
  if ((card.status === "backlog" || card.status === "ready") && !card.runtime) return "todo";
  return "running";
}

export type Actor = "agent" | "lead" | "copilot" | "orchestrator" | "board" | "you";

/** Who did it. `origin` says who wrote a card that appeared on its own (ADR 0010). */
export function actorOf(e: BoardEvent, card: Pick<CardView, "origin" | "originCardId">): Actor {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  if (e.type === "card.created") {
    if (card.origin === "copilot") return "copilot";
    // Filed by a pane that is not on a card: the orchestrator. From a card's own session: its agent.
    if (card.origin === "agent") return card.originCardId ? "agent" : "orchestrator";
    return "you";
  }
  if (e.type.startsWith("session.") || e.type.startsWith("deliverable.")) return "agent";
  if (["run.report", "card.filed", "agent.notify", "wrapup.collected"].includes(e.type)) return "agent";
  if (e.type === "run.merge" || e.type === "run.gate") return "board";
  if (e.type.startsWith("run.")) return "lead";
  if (e.type === "review.created" || e.type.startsWith("copilot.")) return "copilot";
  if (e.type === "card.released") return p.why === "expired" ? "board" : "you";
  if (["card.edited", "card.operator_said", "card.held", "card.action_added"].includes(e.type)) return "you";
  return "board";
}

export interface HistoryRow {
  id: number;
  ts: number;
  actor: Actor;
  text: string;
}

/** Key steps besides the milestones: the card's birth, a hand edit, the lead stopping, a failed start. */
const KEY_EXTRA = new Set(["card.created", "card.edited", "run.halted", "card.start_failed", "copilot.reformulated", "copilot.refined"]);

/**
 * The history's key steps, newest first: the milestones (one row each, its newest event), plus the
 * few journal events a person asks about. Everything else is in the full journal.
 */
export function historyRows(
  milestoneEvents: readonly BoardEvent[],
  events: readonly BoardEvent[],
  card: Pick<CardView, "origin" | "originCardId">,
  describe: (e: BoardEvent) => string,
  sentBack: (count: number) => string,
): HistoryRow[] {
  const rows: HistoryRow[] = cardMilestones(milestoneEvents).map((m) => {
    const last = m.events.at(-1)!;
    return { id: last.id, ts: m.ts, actor: actorOf(last, card), text: milestoneLabel(m, sentBack) };
  });
  const seen = new Set(rows.map((r) => r.id));
  for (const e of events) {
    if (!KEY_EXTRA.has(e.type) || seen.has(e.id)) continue;
    seen.add(e.id);
    rows.push({ id: e.id, ts: e.ts, actor: actorOf(e, card), text: describe(e) });
  }
  return rows.sort((a, b) => b.ts - a.ts || b.id - a.id);
}

export type CriterionVerdict = { verdict: "met" | "partial" | "not"; reason: string } | null;

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function classify(line: string): "met" | "partial" | "not" | null {
  const l = norm(line);
  if (/\b(not met|non atteint|pas atteint|not done|unmet|pas fait)\b/.test(l)) return "not";
  if (/\b(partly met|partially met|partly|partially|partial|en partie|partiellement)\b/.test(l)) return "partial";
  if (/\b(met|atteint|done|ok|fait)\b/.test(l) || line.includes("✅") || line.includes("✓")) return "met";
  return null;
}

/**
 * What the closing report (or the worker's bilan) said about each criterion — the wrapup asks for
 * « one line each: met, partly met, or not met » (bridge/wrapup.ts). A line counts when it names the
 * criterion (its number, or its first words) AND says one of those; otherwise the criterion gets no
 * verdict at all, rather than a guessed one.
 *
 * shortcut: text matching on a free-form report, upgrade to a structured verdict if the wrapup ever writes one.
 */
export function criterionVerdicts(acceptance: readonly string[], texts: readonly (string | null | undefined)[]): CriterionVerdict[] {
  const lines = texts.flatMap((t) => (t ? t.split("\n") : [])).filter((l) => l.trim());
  return acceptance.map((criterion, i) => {
    const words = norm(criterion).split(" ").slice(0, 4).join(" ");
    const n = i + 1;
    const numbered = new RegExp(`^\\s*(?:[-*]\\s*)?(?:\\*\\*)?(?:(?:criterion|critere|crit[eè]re|c)\\s*)?${n}\\s*[.):\\-]`, "i");
    const line = lines.find((l) => (words.length >= 6 && norm(l).includes(words)) || numbered.test(l));
    if (!line) return null;
    const verdict = classify(line);
    if (!verdict) return null;
    // The reason: what follows the verdict word, or the line itself, trimmed of list marks.
    const reason = line.replace(/^\s*[-*\d.)\s]*/, "").replace(/\*\*/g, "").trim();
    return { verdict, reason };
  });
}
