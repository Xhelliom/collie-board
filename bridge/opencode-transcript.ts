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
// than serving none — UNLESS the pane's mirror names the session outright (see
// below). A `sessionId` herdr may report one day (`ses_…`, never a uuid)
// is honoured directly when it exists in the store.
//
// RESOLUTION BY CONTENT. A fan-out of parallel agents in one directory (a dozen
// live sessions, one pane each) makes the clock rule refuse every pane — which is
// exactly when the transcript matters most. The terminal mirror is ground truth
// here as it is for the Claude reader (transcript.ts): herdr hands it back per
// PANE ID, so matching what the pane is showing against each candidate session's
// recent prose identifies the right session outright, no clock involved. An
// outright winner is demanded (pickByContent) — a tie stays a refusal, because
// guessing on a tie is how the wrong transcript gets served with confidence.
//
// Never throws: no db, no session, an ambiguous directory, or a corrupt row all read
// as null — "nothing to serve", which the route answers as `no-log`.

import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";

import { OPENCODE_LIVE_MS } from "./opencode-usage.ts";
import {
  flatten,
  mirrorFragments,
  pageEntries,
  pickByContent,
  stripAnsi,
  summarizeToolInput,
  type TranscriptEntry,
} from "./transcript.ts";

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

/** Most sessions ever scored against one mirror — bounded like the Claude reader. */
const MAX_CONTENT_CANDIDATES = 12;

/** Newest messages read per candidate when scoring — the mirror only ever shows recent turns. */
const CONTENT_TAIL_MESSAGES = 40;

/**
 * The session backing `cwd`: newest first wins, unless several are live.
 *
 * Several live sessions means several panes in one directory, and the clock cannot tell them
 * apart — so with no `mirror` this refuses (null), exactly like the gauge. With the pane's
 * terminal mirror, each candidate's recent prose is scored against what the pane is actually
 * showing, and an outright winner is served; a tie stays a refusal.
 */
export function resolveOpenCodeSession(
  dbPath: string,
  cwd: string,
  now: () => number = Date.now,
  mirror?: string | null,
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
      // One live session at most: the clock decides, and no content read is spent confirming
      // what is already certain.
      if (live.length < 2) return sessions[0]!.id;
      if (!mirror) return null; // several panes, no ground truth supplied — refuse
      // Score the newest sessions LIVE OR NOT: the pane's own session may have gone quiet
      // while its siblings keep writing (a supervisor pane watching finished workers reads
      // exactly like that), and the mirror shows it regardless of any clock. An outright
      // winner is still demanded — a tie stays a refusal.
      return pickByMirror(db, sessions.slice(0, MAX_CONTENT_CANDIDATES), mirror);
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/**
 * All matchable prose of one message's data JSON: the user text, every assistant text (and
 * non-empty reasoning) block, and every tool call — BOTH its input and its result. The mirror
 * shows both sides of a call (OpenCode echoes the command it runs, then its output), and the
 * input is often the most distinctive line on screen (a `$ cat lot-001a.tsv …` one-liner rarely
 * repeats across sibling sessions doing neighbouring lots). Corrupt or textless rows contribute
 * nothing; they must not fail the whole score.
 */
function messageProse(data: string): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return "";
  }
  const out: string[] = [];
  if (typeof parsed.text === "string") out.push(parsed.text);
  const content = Array.isArray(parsed.content) ? parsed.content : [];
  for (const raw of content) {
    if (raw === null || typeof raw !== "object") continue;
    const block = raw as Record<string, unknown>;
    if ((block.type === "text" || block.type === "reasoning") && typeof block.text === "string") {
      out.push(block.text);
    } else if (block.type === "tool") {
      const state =
        block.state !== null && typeof block.state === "object"
          ? (block.state as Record<string, unknown>)
          : {};
      // Input first: scalar values flattened (the command run, the file read) — one line each.
      if (state.input !== null && typeof state.input === "object") {
        for (const value of Object.values(state.input as Record<string, unknown>)) {
          if (typeof value === "string" && value.trim() !== "") out.push(value);
        }
      }
      const result = toolResultText(state.content);
      if (result !== "") out.push(result);
    }
  }
  return out.join("\n");
}

/**
 * A mirror fragment with OpenCode's own shell-echo marker removed. The TUI renders a tool's
 * command as `$ <cmd>`, while the session store holds the bare `<cmd>` in the tool input —
 * without this the most distinctive lines on screen (the exact commands this pane ran) never
 * match anything. Applied to the FRAGMENT side only, so a literal `$` inside prose still
 * matches verbatim; counted once per fragment either way (see {@link pickByMirror}).
 */
function deEcho(fragment: string): string {
  return fragment.replace(/^\$\s+/, "");
}

/**
 * Which of the live sessions the mirror belongs to — null when the evidence doesn't single
 * one out (no distinctive line on screen, or two sessions showing the same words). Only the
 * tail of each session is read: the mirror is a viewport onto its newest turns. Each fragment
 * counts at most once, verbatim or de-echoed.
 */
function pickByMirror(
  db: InstanceType<typeof Database>,
  candidates: { id: string }[],
  mirror: string,
): string | null {
  const fragments = mirrorFragments(mirror);
  if (fragments.length === 0) return null;
  const rows = db.query<{ data: string }, [string, number]>(
    `SELECT data FROM session_message WHERE session_id = $id ORDER BY seq DESC LIMIT $n`,
  );
  const scores: { path: string; hits: number }[] = [];
  for (const { id } of candidates) {
    try {
      const prose = flatten(
        rows.all(id, CONTENT_TAIL_MESSAGES).map((r) => messageProse(r.data)).join("\n"),
      ).replace(/\n/g, " ");
      scores.push({
        path: id,
        hits: fragments.filter((f) => prose.includes(f) || prose.includes(deEcho(f))).length,
      });
    } catch {
      continue; // unreadable session — it simply scores nothing
    }
  }
  return pickByContent(scores);
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
 * single-live-candidate rule — or, when several sessions share the directory, by
 * matching the pane's `mirror` against each candidate's recent prose. Null when there
 * is no safe answer: no db, no session for this directory, an undecidable tie, or a
 * session with no renderable turn yet.
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
    /** The pane's terminal mirror — only consulted when the directory holds several live sessions. */
    mirror?: string | null;
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
        : resolveOpenCodeSession(dbPath, opts.cwd, opts.now ?? Date.now, opts.mirror);
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
