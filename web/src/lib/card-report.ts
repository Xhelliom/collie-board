import type { BoardEvent, CardSession } from "@/lib/board";

// The card's « Compte rendu » — DERIVED from the journal's `run.report` / `run.decision` / `run.halted`
// on every read (bridge/run.ts keeps the bilans), never stored. Pure.

export type BilanIssue = "coded" | "present" | "partial" | "none";

/** The lead's word on a round: sent back (with what), accepted, or stopped for the operator. */
export interface LeadAnswer {
  kind: "prompt" | "finished" | "halted";
  reason: string;
  prompt?: string;
}

/** One back-and-forth: what the worker said it did, then what the lead made of it. Either may be missing. */
export interface ReportRound {
  id: number;
  bilan: string | null;
  issue: BilanIssue | null;
  answer: LeadAnswer | null;
}

export interface CardReport {
  /** The newest bilan's outcome; null when it gave none (or there is no bilan). */
  issue: BilanIssue | null;
  /** The lead's last verdict — acceptance or halt — or null while it has not given one. */
  conclusion: LeadAnswer | null;
  rounds: ReportRound[];
  /** The newest end-of-session report, or null. */
  handoffMd: string | null;
}

const str = (p: Record<string, unknown>, k: string): string => (typeof p[k] === "string" ? (p[k] as string) : "");

function answerOf(e: BoardEvent): LeadAnswer | null {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  if (e.type === "run.halted") return { kind: "halted", reason: str(p, "reason") };
  if (e.type !== "run.decision") return null;
  // keep / fold / drop / wait are about follow-ups and lots, not this card's work.
  if (p.decision === "finished") return { kind: "finished", reason: str(p, "reason") };
  if (p.decision === "prompt") return { kind: "prompt", reason: str(p, "reason"), prompt: str(p, "prompt") || undefined };
  return null;
}

/** The report of a card, or null when there is nothing to tell (a manual card, never launched). */
export function cardReport(events: readonly BoardEvent[], sessions: readonly CardSession[] = []): CardReport | null {
  const rounds: ReportRound[] = [];
  let conclusion: LeadAnswer | null = null;
  for (const e of [...events].sort((a, b) => a.id - b.id)) {
    if (e.type === "run.report") {
      const p = (e.payload ?? {}) as Record<string, unknown>;
      const issue = (p.issue as BilanIssue | null | undefined) ?? null;
      rounds.push({ id: e.id, bilan: str(p, "text"), issue, answer: null });
      continue;
    }
    const a = answerOf(e);
    if (!a) continue;
    if (a.kind !== "prompt") conclusion = a;
    const last = rounds.at(-1);
    if (last && !last.answer) last.answer = a;
    else rounds.push({ id: e.id, bilan: null, issue: null, answer: a });
  }
  const handoffMd = [...sessions].reverse().find((s) => s.handoffMd)?.handoffMd ?? null;
  if (rounds.length === 0 && !handoffMd) return null;
  const issue = [...rounds].reverse().find((r) => r.bilan !== null)?.issue ?? null;
  return { issue, conclusion, rounds, handoffMd };
}
