// The lead — the run's judge (ADR 0017, *Who drives it*).
//
// The copilot's opposite bargain on the same plumbing: its own pane and workspace label, the same
// serialised file-answer request, but it READS THE WORKER'S CHECKOUT and decides. Three questions:
// check (step 3), triage (step 5), and the re-check after a conflict (step 6).
//
// IT JUDGES AND SPEAKS, NOTHING ELSE. This file imports nothing that edits a card, starts an agent,
// pushes or merges — its only output is a typed decision. The coordinator executes it through the
// routes a tap would use, so the gates of integrate.ts and the traces of ADR 0010 apply unchanged.
// `lead.test.ts` holds that line on the imports.
//
// A decision without a reason is not a decision: the reason is what goes to the card's journal, and
// that journal is what the operator reads instead of the diff. So every parser below throws on a
// malformed answer or an empty reason — an error, never a guessed decision.

import { Copilot } from "./copilot.ts";

/** The lead's own workspace label (and, through agentNameFor, its agent name). */
const LEAD_LABEL = "lead";

/**
 * A second instance of the copilot's plumbing, under its own label. Always enabled: the run's
 * gesture is the consent that pays for it, and the coordinator only asks inside a run.
 */
export class Lead extends Copilot {
  override get enabled(): boolean {
    return true;
  }
  protected override get label(): string {
    return LEAD_LABEL;
  }
  protected override get tag(): string {
    return "lead";
  }

  async check(input: Omit<CheckInput, "outPath">): Promise<CheckDecision> {
    return toCheckDecision(await this.ask((outPath) => checkPrompt({ ...input, outPath })));
  }
  async triage(input: Omit<TriageInput, "outPath">): Promise<TriageDecision> {
    const answer = await this.ask((outPath) => triagePrompt({ ...input, outPath }));
    return toTriageDecision(answer, input.followUps.length);
  }
  async recheckConflict(input: Omit<ConflictInput, "outPath">): Promise<ConflictDecision> {
    return toConflictDecision(await this.ask((outPath) => conflictPrompt({ ...input, outPath })));
  }
}

// ── prompts (pure) ────────────────────────────────────────────────────────────

/** What the lead knows of the card it judges. */
export interface CardBrief {
  title: string;
  spec: string | null;
  acceptance: string[];
  /** The worker's checkout — the lead reads it directly. */
  worktree: string;
  /** The ref the card forked from; the lead diffs against it. */
  base: string;
}

export interface CheckInput extends CardBrief {
  /** `git diff --stat`, as a starting map — the lead still reads the code. */
  statSummary: string;
  outPath: string;
}

export interface TriageInput extends CardBrief {
  verdict: string | null;
  notes: string | null;
  /** The review's follow-ups, in order; the answer refers to them by index. */
  followUps: { title: string; spec?: string | null }[];
  outPath: string;
}

export interface ConflictInput extends CardBrief {
  /** The files the conflict was on, as the merge reported them. */
  conflicts: string[];
  outPath: string;
}

function brief(role: string, b: CardBrief): string[] {
  const parts = [
    `You are the lead of a run: ${role}`,
    "",
    "HARD RULES. You read and you judge; you never act. Do NOT edit, create or delete any file in the",
    "checkout, do not commit, stash, checkout, reset, push, merge or open a PR, do not start agents.",
    "Read-only git commands (diff, log, show, status) and reading files are all you may run.",
    "",
    `Card: ${b.title}`,
  ];
  if (b.spec) parts.push("", "Spec:", b.spec);
  if (b.acceptance.length) parts.push("", "Acceptance criteria:", ...b.acceptance.map((a) => `- ${a}`));
  parts.push(
    "",
    `The worker's checkout: ${b.worktree}`,
    `Its work is \`git -C ${b.worktree} diff ${b.base}...HEAD\` plus anything uncommitted (\`git -C ${b.worktree} status\`).`,
    "Read the code itself, not just the diff, wherever a criterion depends on it.",
  );
  return parts;
}

function answer(outPath: string, shape: string[]): string[] {
  return [
    "",
    "Every `reason` is one or two plain sentences the operator reads instead of the diff — never empty.",
    "",
    `Write ONLY this JSON to ${outPath} (create directories as needed) and print nothing else:`,
    ...shape,
  ];
}

/** Step 3: the worker went idle — is the card finished, or does the worker get sent back? Pure. */
export function checkPrompt(input: CheckInput): string {
  return [
    ...brief("decide whether the worker on this card is finished.", input),
    "",
    "What changed (git diff --stat):",
    input.statSummary,
    "",
    "Finished means: every acceptance criterion holds in the code, and the work is committed. A drift",
    "from the spec is fine if it is a better path to the same goal — say so in the reason.",
    "Otherwise write the message the worker will receive: direct, specific, naming the criterion that",
    'is not met and why (e.g. "commit; criterion 2 is not met because …").',
    ...answer(input.outPath, [
      "{",
      '  "decision": "finished | prompt",',
      '  "prompt": "the message to the worker — only when decision is prompt",',
      '  "reason": "why"',
      "}",
    ]),
  ].join("\n");
}

/** Step 5: the copilot's review landed — accept its verdict? keep, fold or drop each follow-up. Pure. */
export function triagePrompt(input: TriageInput): string {
  const parts = [
    ...brief("triage the review of this card, reading it WITH the code.", input),
    "",
    `The review's verdict: ${input.verdict ?? "(none)"}`,
  ];
  if (input.notes) parts.push("", "The review's notes:", input.notes);
  parts.push("", "The review's follow-ups:");
  if (input.followUps.length === 0) parts.push("(none)");
  input.followUps.forEach((f, i) => {
    parts.push(`${i}. ${f.title}${f.spec ? ` — ${f.spec}` : ""}`);
  });
  parts.push(
    "",
    "Verdict: accept it, or not. A `drift` you judge to be a better path is accepted, with why.",
    "Each follow-up, by its index, exactly once:",
    "- keep: worth its own card, later;",
    "- fold: belongs to this run's work — the worker should do it now;",
    "- drop: not worth doing, already done, or invented by the review.",
    ...answer(input.outPath, [
      "{",
      '  "verdict": { "accept": true or false, "reason": "why" },',
      '  "followUps": [ { "index": 0, "action": "keep | fold | drop", "reason": "why" } ]',
      "}",
    ]),
  );
  return parts.join("\n");
}

/** Step 6: the worker resolved a merge conflict — does the result still hold? Pure. */
export function conflictPrompt(input: ConflictInput): string {
  return [
    ...brief("re-check this card after its worker resolved a merge conflict.", input),
    "",
    "The conflict was on:",
    ...input.conflicts.map((f) => `- ${f}`),
    "",
    "Resolved means: no conflict markers left, the resolution is committed, and it keeps both this",
    "card's intent and what the base brought in. If the worker can fix what is wrong, write it the",
    "message; if it cannot (it is a judgement only the operator can make), halt.",
    ...answer(input.outPath, [
      "{",
      '  "decision": "resolved | prompt | halt",',
      '  "prompt": "the message to the worker — only when decision is prompt",',
      '  "reason": "why"',
      "}",
    ]),
  ].join("\n");
}

// ── answers (typed, strict) ───────────────────────────────────────────────────

export type CheckDecision =
  | { decision: "finished"; reason: string }
  | { decision: "prompt"; prompt: string; reason: string };

export type ConflictDecision =
  | { decision: "resolved"; reason: string }
  | { decision: "halt"; reason: string }
  | { decision: "prompt"; prompt: string; reason: string };

export type FollowUpAction = "keep" | "fold" | "drop";

export interface TriageDecision {
  verdict: { accept: boolean; reason: string };
  /** One per follow-up, in the input's order. */
  followUps: { index: number; action: FollowUpAction; reason: string }[];
}

function obj(v: unknown, what: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`lead: ${what} is not an object`);
  return v as Record<string, unknown>;
}

function text(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== "string" || !v.trim()) throw new Error(`lead: missing or empty "${key}"`);
  return v.trim();
}

function decided<T extends string>(o: Record<string, unknown>, allowed: readonly T[]): T {
  const d = o.decision;
  if (!allowed.includes(d as T)) throw new Error(`lead: unknown decision ${JSON.stringify(d)}`);
  return d as T;
}

/** Parse a check answer. Throws on anything malformed — `null` (no answer) included. Pure. */
export function toCheckDecision(parsed: unknown): CheckDecision {
  const o = obj(parsed, "the check answer");
  const reason = text(o, "reason");
  return decided(o, ["finished", "prompt"] as const) === "finished"
    ? { decision: "finished", reason }
    : { decision: "prompt", prompt: text(o, "prompt"), reason };
}

/** Parse a conflict re-check answer. Throws on anything malformed. Pure. */
export function toConflictDecision(parsed: unknown): ConflictDecision {
  const o = obj(parsed, "the conflict answer");
  const reason = text(o, "reason");
  const d = decided(o, ["resolved", "prompt", "halt"] as const);
  return d === "prompt" ? { decision: d, prompt: text(o, "prompt"), reason } : { decision: d, reason };
}

/**
 * Parse a triage answer. Every follow-up must be decided exactly once — a silently skipped one would
 * be a follow-up nobody chose to keep or drop. Throws on anything malformed. Pure.
 */
export function toTriageDecision(parsed: unknown, followUpCount: number): TriageDecision {
  const o = obj(parsed, "the triage answer");
  const v = obj(o.verdict, "verdict");
  if (typeof v.accept !== "boolean") throw new Error('lead: verdict "accept" is not a boolean');
  const verdict = { accept: v.accept, reason: text(v, "reason") };

  if (!Array.isArray(o.followUps)) throw new Error('lead: "followUps" is not a list');
  const followUps: TriageDecision["followUps"] = [];
  for (const raw of o.followUps) {
    const f = obj(raw, "a follow-up decision");
    const index = f.index;
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= followUpCount) {
      throw new Error(`lead: follow-up index ${JSON.stringify(index)} out of range`);
    }
    if (followUps.some((d) => d.index === index)) throw new Error(`lead: follow-up ${index} decided twice`);
    const action = f.action;
    if (action !== "keep" && action !== "fold" && action !== "drop") {
      throw new Error(`lead: unknown follow-up action ${JSON.stringify(action)}`);
    }
    followUps.push({ index: index as number, action, reason: text(f, "reason") });
  }
  if (followUps.length !== followUpCount) {
    throw new Error(`lead: ${followUpCount - followUps.length} follow-up(s) left undecided`);
  }
  followUps.sort((a, b) => a.index - b.index);
  return { verdict, followUps };
}
