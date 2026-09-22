// OpenCode transcript history — the reading view for `opencode` panes.
//
// WHY A SECOND READER. OpenCode keeps its conversations in a sqlite database
// (`~/.local/share/opencode/opencode.db`, tables `session_v2` + `session_message` —
// see opencode-usage.ts), not in Claude-Code-shaped JSONL files. The history route
// (server.ts) used to gate on `adapter.context` — "does this agent write a transcript
// transcript.ts can parse" — which is false for opencode, so every opencode pane
// answered `no-session`: a pane WITH a running agent and a full conversation on disk
// was reported as a pane with no session at all. This module reads the session store
// directly into the same `TranscriptEntry[]` shape, so the phone renders one
// conversation either way.
//
// SHAPE OF THE SOURCE (verified 2026-09-22 against the live db on this machine):
//   session_v2:    id, directory, time_created, time_updated (ms epoch), model (JSON)
//   session_message: id, session_id, type ('user'|'assistant'), seq, time_created,
//     data (JSON):
//     - user:      {time, text, files, agents}
//     - assistant: {time, agent, model, content: [{type:'reasoning'|'text'|'tool'}],
//       finish, tokens}. A `tool` block carries its call AND its result together:
//       state: {status, input, content: [{type:'text', text}]}, so unlike the Claude
//       log there is nothing to fold across rows.
// A `reasoning` block's `text` is empty in practice (encrypted payload kept server-
// side), exactly like Claude's empty `thinking` blocks — skipped unless non-blank.
//
// PANE → SESSION LINK. herdr reports no `agent_session` for opencode panes, so like
// the gauge (opencode-usage.ts) this resolves BY DIRECTORY with the same
// single-live-candidate rule: two sessions updated within LIVE_MS means two live
// panes in one directory, and serving one pane the other's conversation is worse
// than serving none. A `sessionId` herdr may report one day (`ses_…`, never a uuid)
// is honoured directly when it exists in the store.
//
// Never throws: no db, no session, an ambiguous directory, or a corrupt row all read
// as null — "nothing to serve", which the route answers as `no-log`.

import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";

import { OPENCODE_LIVE_MS } from "./opencode-usage.ts";
import { pageEntries, stripAnsi, summarizeToolInput, type TranscriptEntry } from "./transcript.ts";

/** Per-text-part cap — the same generosity as the Claude reader (transcript.ts). */
const MAX_TEXT_CHARS = 20_000;

/** Per-tool-result cap — the phone only needs a gist (same value as transcript.ts). */
const MAX_RESULT_CHARS = 2000;

function clamp(text: string, max: number): { text: string; truncated?: boolean } {
  if (text.length <= max) return { text };
  return { text: text.slice(0, max), truncated: true };
}

function isoTime(ms: unknown): string {
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0
    ? new Date(ms).toISOString()
    : "";
}

interface MessageRow {
  id: string;
  type: string;
  time_created: number;
  data: string;
}

/** The session backing `cwd`: newest first wins, unless two are live (ambiguous → null). */
export function resolveOpenCodeSession(
  dbPath: string,
  cwd: string,
  now: () => number = Date.now,
): string | null {
  try {
    if (!cwd || !dbPath || !existsSync(dbPath)) return null;
    const db = new Database(dbPath, { readonly: true });
    try {
      const sessions = db
        .query<{ id: string; time_updated: number }, [string, string]>(
          `SELECT id, time_updated FROM session_v2
           WHERE directory = $a OR directory = $b ORDER BY time_updated DESC`,
        )
        .all(cwd, cwd.endsWith("/") ? cwd.slice(0, -1) : `${cwd}/`);
      if (sessions.length === 0) return null;
      const at = now();
      const live = sessions.filter(
        (s) => Number.isFinite(s.time_updated) && at - s.time_updated < OPENCODE_LIVE_MS,
      );
      // Two live sessions in one directory: two panes, one transcript — refuse.
      if (live.length >= 2) return null;
      return sessions[0]!.id;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/** True when `sessionId` names a session the store actually holds. */
function hasSession(dbPath: string, sessionId: string): boolean {
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db
        .query<{ id: string }, [string]>(`SELECT id FROM session_v2 WHERE id = $id LIMIT 1`)
        .get(sessionId);
      return row !== null;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

/** Flatten a tool block's `state.content` — in practice always `[{type:'text'}]`. */
function toolResultText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((b) =>
      b !== null && typeof b === "object" && typeof (b as { text?: unknown }).text === "string"
        ? (b as { text: string }).text
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

/**
 * One session's messages as oldest-first turns — the same `TranscriptEntry` shape the
 * Claude reader produces, so the phone renders either source identically. Pure over the
 * rows; the db access lives in {@link pageOpenCodeHistory}.
 */
export function parseOpenCodeMessages(rows: MessageRow[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const row of rows) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(row.data) as Record<string, unknown>;
    } catch {
      continue; // corrupt row — skip it rather than fail the whole read
    }
    const ts = isoTime(row.time_created);
    if (row.type === "user") {
      const text = typeof data.text === "string" ? data.text.trim() : "";
      if (text === "") continue;
      entries.push({ uuid: row.id, ts, role: "user", parts: [{ kind: "text", ...clamp(text, MAX_TEXT_CHARS) }] });
      continue;
    }
    if (row.type !== "assistant") continue;
    const content = Array.isArray(data.content) ? data.content : [];
    const parts: TranscriptEntry["parts"] = [];
    for (const raw of content) {
      if (raw === null || typeof raw !== "object") continue;
      const block = raw as Record<string, unknown>;
      if (block.type === "text" && typeof block.text === "string") {
        if (block.text.trim() !== "")
          parts.push({ kind: "text", ...clamp(stripAnsi(block.text), MAX_TEXT_CHARS) });
      } else if (block.type === "reasoning" && typeof block.text === "string") {
        // Empty in practice (encrypted payload stays server-side) — kept for the day it isn't.
        if (block.text.trim() !== "")
          parts.push({ kind: "thinking", ...clamp(stripAnsi(block.text), MAX_TEXT_CHARS) });
      } else if (block.type === "tool") {
        const state =
          block.state !== null && typeof block.state === "object"
            ? (block.state as Record<string, unknown>)
            : {};
        const resultText = stripAnsi(toolResultText(state.content));
        parts.push({
          kind: "tool",
          name: typeof block.name === "string" && block.name !== "" ? block.name : "tool",
          summary: summarizeToolInput(state.input),
          ...(resultText.trim() !== "" || typeof state.status === "string"
            ? {
                result: {
                  ...clamp(resultText, MAX_RESULT_CHARS),
                  ...(state.status === "error" ? { isError: true } : {}),
                },
              }
            : {}),
        });
      }
    }
    if (parts.length === 0) continue;
    entries.push({ uuid: row.id, ts, role: "assistant", parts });
  }
  return entries;
}

/**
 * Page an opencode pane's conversation — the opencode half of the history route.
 *
 * `sessionId` (a reported `ses_…` id, when herdr ever names one) wins when the store
 * holds it; otherwise the session is resolved by directory with the
 * single-live-candidate rule. Null when there is no safe answer: no db, no session
 * for this directory, two live sessions, or a session with no renderable turn yet.
 * `queued` is always empty — OpenCode has no pending-input state this reader knows.
 */
export async function pageOpenCodeHistory(
  dbPath: string,
  opts: {
    sessionId?: string | null;
    cwd: string;
    limit: number;
    before?: string;
    after?: string;
    now?: () => number;
  },
): Promise<{
  entries: TranscriptEntry[];
  hasMore: boolean;
  total: number;
  fileTruncated: false;
  queued: string[];
} | null> {
  try {
    if (!dbPath || !existsSync(dbPath)) return null;
    const sessionId =
      opts.sessionId && hasSession(dbPath, opts.sessionId)
        ? opts.sessionId
        : resolveOpenCodeSession(dbPath, opts.cwd, opts.now ?? Date.now);
    if (!sessionId) return null;
    const db = new Database(dbPath, { readonly: true });
    let rows: MessageRow[];
    try {
      rows = db
        .query<MessageRow, [string]>(
          `SELECT id, type, time_created, data FROM session_message
           WHERE session_id = $id ORDER BY seq ASC`,
        )
        .all(sessionId);
    } finally {
      db.close();
    }
    const entries = parseOpenCodeMessages(rows);
    if (entries.length === 0) return null;
    const { window, hasMore } = pageEntries(entries, {
      limit: opts.limit,
      ...(opts.after !== undefined ? { after: opts.after } : {}),
      ...(opts.before !== undefined && opts.after === undefined ? { before: opts.before } : {}),
    });
    return { entries: window, hasMore, total: entries.length, fileTruncated: false, queued: [] };
  } catch {
    return null;
  }
}
