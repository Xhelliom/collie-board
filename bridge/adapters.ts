// Per-agent divergence, in one table.
//
// Herdr already normalises the hard part — it detects and reports the state of 16 agents with no
// configuration at all — so almost everything the board does is agnostic by construction: statuses,
// `agent.prompt`, `send_keys`, git, the handoff note, the JSON-to-a-file output contract. Nothing
// here re-implements any of that.
//
// What is left is FOUR points, and they are the only things this file describes:
//
//   1. launch — herdr's `kind`, which is what `agent.start` takes.
//   2. context reset — `/clear` for Claude Code, something else elsewhere, nothing at all for an
//      agent that has no such command.
//   3. context READING — whether the gauge can work. It needs a Claude-Code-shaped JSONL transcript
//      with `message.usage`; an agent that keeps none degrades to level 3 (no gauge), which is a
//      supported outcome, not a failure.
//   4. native session id — whether the agent reports one to herdr, which is what links a pane to a
//      transcript that outlives it.
//
// Shipped defaults live in `adapters/agents.toml`; a user file at
// `<configDir>/agents.toml` is merged over them, key by key, so overriding one field of one agent
// doesn't mean restating the table.

import { existsSync, readFileSync } from "node:fs";

/** What the board needs to know about one agent kind. */
export interface AgentAdapter {
  /** Herdr agent kind — the `kind` argument to `agent.start`. */
  kind: string;
  /** Command that resets the agent's context, or empty when it has none. */
  clear: string;
  /** Whether this agent writes a transcript the context gauge can read (see context.ts). */
  context: boolean;
  /** Whether the agent reports a native session id to herdr. */
  sessionId: boolean;
}

/**
 * The built-in table, used when no file is found at all.
 *
 * Only `claude` claims `context: true`, because that is the only transcript format `latestUsage()`
 * knows how to read (verified against the installed Claude Code). Claiming it for an agent whose
 * format we have never seen would produce a confident, wrong percentage — the exact failure mode
 * the telemetry design refuses.
 */
export const BUILTIN_ADAPTERS: Record<string, AgentAdapter> = {
  claude: { kind: "claude", clear: "/clear", context: true, sessionId: true },
  codex: { kind: "codex", clear: "", context: false, sessionId: false },
  gemini: { kind: "gemini", clear: "", context: false, sessionId: false },
  opencode: { kind: "opencode", clear: "", context: false, sessionId: false },
};

/** The fallback for an agent kind nobody described: assume nothing, degrade everywhere. */
export function unknownAdapter(kind: string): AgentAdapter {
  return { kind, clear: "", context: false, sessionId: false };
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function text(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

/**
 * Merge a parsed TOML table over a base table, per agent and per field.
 *
 * Per-field on purpose: a user who wants to change Claude's clear command should write three lines,
 * not restate every capability and risk silently turning the gauge off. Pure + exported.
 *
 * Shape (see adapters/agents.toml):
 *   [agent.claude]
 *   clear      = "/clear"
 *   context    = true
 *   session_id = true
 */
export function mergeAdapters(
  base: Record<string, AgentAdapter>,
  parsed: unknown,
): Record<string, AgentAdapter> {
  const out: Record<string, AgentAdapter> = { ...base };
  if (parsed === null || typeof parsed !== "object") return out;
  const agents = (parsed as { agent?: unknown }).agent;
  if (agents === null || typeof agents !== "object") return out;

  for (const [kind, raw] of Object.entries(agents as Record<string, unknown>)) {
    if (raw === null || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const current = out[kind] ?? unknownAdapter(kind);
    out[kind] = {
      kind,
      clear: text(o.clear, current.clear),
      context: bool(o.context, current.context),
      // `session_id` is the TOML spelling; accept the camelCase too rather than silently ignoring it.
      sessionId: bool(o.session_id ?? o.sessionId, current.sessionId),
    };
  }
  return out;
}

/**
 * Load the adapter table: built-ins, then the shipped `adapters/agents.toml`, then the user's.
 *
 * Every layer is optional and every failure is soft — a syntax error in a user's TOML must degrade
 * to the built-in table with a warning, not stop the bridge from serving a board.
 */
export function loadAdapters(paths: string[]): Record<string, AgentAdapter> {
  let table = { ...BUILTIN_ADAPTERS };
  for (const path of paths) {
    if (!existsSync(path)) continue;
    try {
      table = mergeAdapters(table, Bun.TOML.parse(readFileSync(path, "utf8")));
    } catch (err) {
      console.warn(`[adapters] ignoring ${path}: ${(err as Error).message}`);
    }
  }
  return table;
}

/** The adapter for a kind, never undefined. */
export function adapterFor(table: Record<string, AgentAdapter>, kind: string): AgentAdapter {
  return table[kind] ?? unknownAdapter(kind);
}
