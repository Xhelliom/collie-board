// Agent templates — ADR 0026. A template is a ROLE for a worker: a brief that goes in front of the
// card's own prompt, an agent kind, and a model. Everything here is pure (the db and the routes call
// it), so what is sent to an agent is pinned by tests rather than by reading a start flow.
//
// WHAT A TEMPLATE CAN NEVER BE: a command line. The model is one word that must look like a model
// name and reaches the CLI only behind the kind's own verified flag (`modelFlag`, adapters.ts) — a
// value like `--dangerously-skip-permissions` would otherwise ride in as a second argument.

import { BUILTIN_ADAPTERS, type AgentAdapter } from "./adapters.ts";
import type { AgentTemplate } from "./db.ts";

export const TEMPLATE_BRIEF_MAX = 12_000;
export const TEMPLATE_NAME_MAX = 80;
export const TEMPLATE_DESCRIPTION_MAX = 300;
/** An agent file bigger than this is not a role, it is a dump. */
export const AGENT_FILE_MAX_BYTES = 64 * 1024;

/** One word, no leading dash: sonnet, opus, claude-sonnet-4-5, gpt-5.1-codex, provider/model:tag. */
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;
const KIND = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const isModel = (v: unknown): v is string => typeof v === "string" && MODEL.test(v);
export const isKind = (v: unknown): v is string => typeof v === "string" && KIND.test(v);

// ── the shipped templates ──────────────────────────────────────────────────────

type Builtin = Pick<AgentTemplate, "key" | "name" | "description" | "agentKind" | "model" | "brief">;

const LANG = "Answer and write your report in the language of the card.";

/**
 * Names and descriptions are English here, as stored; the app shows them translated by `key`.
 * Briefs are English too — the agent reads them in any language, and the report follows the card's.
 */
export const BUILTIN_TEMPLATES: readonly Builtin[] = [
  {
    key: "implementer",
    name: "Implementer",
    description: "Implements exactly one ticket, tests first, until the checks are green.",
    agentKind: null,
    model: "sonnet",
    brief: [
      "You implement ONE card. Its spec and acceptance criteria are below; nothing else is your job.",
      "",
      "Method:",
      "1. Read the card, then ONLY the files it points at. No exhaustive reading of the repository.",
      "2. Write the acceptance tests first and check that they fail.",
      "3. Write the minimum code that makes them pass, following the repo's own rules (CLAUDE.md and friends).",
      "4. Run the repository's checks until they are green, then commit with a clear message.",
      "",
      "Limits:",
      "- Stay inside the card. A need outside it goes in your report; do not do it.",
      "- A real ambiguity, an open design question, or three failures on the same check: STOP and say so. Do not decide for the owner.",
      "- Never kill a process by pattern; only the ones you started.",
      "",
      "Final report, short: what you changed, the tests you added, the state of the checks, what remains or blocks.",
      LANG,
    ].join("\n"),
  },
  {
    key: "reviewer",
    name: "Reviewer",
    description: "Read-only review of a diff: APPROVE or CHANGES with a short, actionable list.",
    agentKind: null,
    model: "opus",
    brief: [
      "You review the work on ONE card. You change nothing: you return a verdict.",
      "",
      "Read the diff against its base branch. The automatic checks are assumed green: do not redo their work, look for what they cannot see.",
      "Checklist: the diff does what the card says and nothing more; every acceptance criterion has a test that would fail if the code were wrong; no decision is contradicted or silently taken; names and comments are honest; nothing unsafe at a trust boundary.",
      "",
      "Verdict, strict format, 15 lines at most:",
      "VERDICT: APPROVE | CHANGES",
      "- file:line — problem — expected fix",
      "CHANGES only for a real problem. A style preference the repo's rules do not cover is one `NOTE:` line at most.",
      LANG,
    ].join("\n"),
  },
  {
    key: "doc",
    name: "Documentation",
    description: "Touches documentation only: no code, no tests, no config.",
    agentKind: null,
    model: null,
    brief: [
      "You work on DOCUMENTATION only. Do not modify code, tests or configuration; if the docs and the code disagree, say so in your report instead of fixing the code.",
      "",
      "Keep each file short and focused, link rather than repeat, and update every document the change makes stale. Commit with a clear message.",
      "A decision you are not sure of is a question for the owner: stop and ask rather than write it down as settled.",
      LANG,
    ].join("\n"),
  },
  {
    key: "explore",
    name: "Exploration",
    description: "Brainstorm or investigation: delivers a written conclusion and the cards it proposes.",
    agentKind: null,
    model: null,
    brief: [
      "This card is an EXPLORATION: its deliverable is a written conclusion and the cards it proposes, not code.",
      "",
      "Investigate, then write the conclusion into the repository (a short document the owner can read in two minutes): the question, what you found, the options, your recommendation and why.",
      "File the follow-up work as cards through the board's API; each must be real, scoped and follow from the conclusion. Do not start any of it.",
      "A choice that belongs to the owner is a question in the conclusion, not a decision.",
      LANG,
    ].join("\n"),
  },
  {
    key: "fix",
    name: "Bug fix",
    description: "Finds the root cause, proves it with a failing test, fixes it where all callers route through.",
    agentKind: null,
    model: "sonnet",
    brief: [
      "You fix ONE bug. Find the ROOT CAUSE, not the symptom the report names.",
      "",
      "1. Reproduce it, then write a test that fails because of it.",
      "2. Before editing, look at every caller of the code you are about to change: the right fix is usually one guard in the shared function, not one in each caller.",
      "3. Fix it once, make the test pass, run the repository's checks, commit with a clear message.",
      "",
      "If the cause is not where the report points, say so in your report. Stay inside the bug.",
      LANG,
    ].join("\n"),
  },
];

// ── applying a template ────────────────────────────────────────────────────────

/** The brief, a separator, then the card's own prompt. Pure. */
export function composePrompt(brief: string, cardPrompt: string): string {
  const b = brief.trim();
  return b ? `${b}\n\n---\n\n${cardPrompt}` : cardPrompt;
}

/**
 * The CLI arguments that pick a template's model, or none: the kind has no verified flag, no model
 * was set, or the model does not look like a model name. Pure.
 */
export function modelArgs(
  kind: string,
  model: string | null | undefined,
  adapters: Record<string, AgentAdapter> = BUILTIN_ADAPTERS,
): string[] {
  const flag = adapters[kind]?.modelFlag;
  return flag && isModel(model) ? [flag, model] : [];
}

/** The template a card starts with: its own, else its phase's, else none. Pure. */
export function resolveTemplate(
  card: { templateId: string | null },
  phase: { templateId: string | null } | null,
  templates: readonly AgentTemplate[],
): AgentTemplate | null {
  const id = card.templateId ?? phase?.templateId ?? null;
  return id ? (templates.find((t) => t.id === id) ?? null) : null;
}

// ── reading a repo's `.claude/agents/*.md` ─────────────────────────────────────

export interface AgentFile {
  name: string;
  description: string;
  /** `inherit` and unknown shapes become null: a template's model is a plain model name or nothing. */
  model: string | null;
  /** Kept to show the operator; a template does not restrict tools (ADR 0026). */
  tools: string;
  brief: string;
}

const unquote = (v: string) => v.trim().replace(/^(["'])(.*)\1$/, "$2");

/**
 * Claude Code's agent file: a YAML-ish frontmatter (`name`, `description`, `model`, `tools`, one
 * line each) then the prompt. Minimal on purpose — a block scalar or anything else in the header is
 * skipped, and a file with no name, no body, or too big is not an agent. Pure.
 */
export function parseAgentFile(text: string): AgentFile | null {
  if (text.length > AGENT_FILE_MAX_BYTES) return null;
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const head: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) head[kv[1]!.toLowerCase()] = unquote(kv[2]!);
  }
  const name = (head.name ?? "").slice(0, TEMPLATE_NAME_MAX);
  const brief = m[2]!.trim();
  if (!name || !brief || brief.length > TEMPLATE_BRIEF_MAX) return null;
  return {
    name,
    description: (head.description ?? "").slice(0, TEMPLATE_DESCRIPTION_MAX),
    model: isModel(head.model) && head.model !== "inherit" ? head.model : null,
    tools: head.tools ?? "",
    brief,
  };
}

// ── drafting one with the copilot ──────────────────────────────────────────────

export interface TemplateDraft {
  name: string;
  description: string;
  agentKind: string | null;
  model: string | null;
  brief: string;
}

export function draftPrompt(input: { description: string; baseOn: string | null; outPath: string }): string {
  return [
    "You are drafting an AGENT TEMPLATE for a coding-agent board: the role brief an agent reads before the card it works on.",
    "",
    "HARD RULES. You write one JSON file and nothing else: do not edit, create or delete anything in any repository, run nothing.",
    "",
    `What the operator wants: ${input.description}`,
    ...(input.baseOn ? ["", "Start from this existing brief and adapt it:", input.baseOn] : []),
    "",
    "A good brief is short and imperative: the method in a few numbered steps, the LIMITS (what is out of scope, when to stop and ask",
    "instead of deciding), and the shape of the final report. It never names a file or a repo; it works on any card.",
    "End it with one line: answer in the language of the card.",
    "",
    "`agentKind` is the agent that should run it (claude, codex…) or null for the board's default. `model` is one word (sonnet, opus,",
    "haiku) or null. Leave both null unless the role really needs them.",
    "",
    `Write ONLY this JSON to ${input.outPath} (create directories as needed) and print nothing else:`,
    "{",
    '  "name": "Short name",',
    '  "description": "One line: what this agent is for",',
    '  "agentKind": null,',
    '  "model": null,',
    '  "brief": "the brief"',
    "}",
  ].join("\n");
}

/** Pure: throws on anything that is not a usable template, so a half answer never reaches the form. */
export function toTemplateDraft(raw: unknown): TemplateDraft {
  if (typeof raw !== "object" || raw === null) throw new Error("template: the answer is not an object");
  const o = raw as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
  const name = str("name");
  const brief = str("brief");
  if (!name || name.length > TEMPLATE_NAME_MAX) throw new Error("template: no usable name");
  if (!brief || brief.length > TEMPLATE_BRIEF_MAX) throw new Error("template: no usable brief");
  const description = str("description").slice(0, TEMPLATE_DESCRIPTION_MAX);
  const agentKind = isKind(o.agentKind) ? o.agentKind : null;
  const model = isModel(o.model) ? o.model : null;
  return { name, description, agentKind, model, brief };
}
