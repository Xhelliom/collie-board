// OpenCode transcript history — the reading view for `opencode` panes.
//
// WHY A SECOND READER. OpenCode keeps its conversations in a sqlite database
// (`~/.local/share/opencode/opencode*.db` — see opencode-store.ts), not in Claude-Code-shaped JSONL files. The history route
// (server.ts) used to gate on `adapter.context` — "does this agent write a transcript
// transcript.ts can parse" — which is false for opencode, so every opencode pane
// answered `no-session`: a pane WITH a running agent and a full conversation on disk
// was reported as a pane with no session at all. This module reads the session store
// directly into the same `TranscriptEntry[]` shape, so the phone renders one
// conversation either way.
//
// SHAPE OF THE SOURCE (2.x, verified 2026-09-22 and 2026-11-02 on opencode v2.0.12):
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
// 1.x stores (session/message/part) are rebuilt into this same shape by opencode-store.ts,
// which also owns the pane → session link (reported id, then directory with the start and
// mirror rules) shared with the gauge.
//
// Never throws: no db, no session, an ambiguous directory, or a corrupt row all read
// as null — "nothing to serve", which the route answers as `no-log`.

import { IMAGE_TYPES } from "./gallery.ts";
import {
  messageRows,
  openOpenCodeStore,
  resolveOpenCodeSession,
  toolResultText,
  type MessageRow,
  type ResolveOpts,
} from "./opencode-store.ts";
import { pageEntries, stripAnsi, summarizeToolInput, type TranscriptEntry } from "./transcript.ts";

/** Per-text-part cap — the same generosity as the Claude reader (transcript.ts). */
const MAX_TEXT_CHARS = 20_000;

/** Per-tool-result cap — the phone only needs a gist (same value as transcript.ts). */
const MAX_RESULT_CHARS = 2000;

/**
 * Per-picture cap on an image a tool returned inline, in base64 chars. Same ceiling as the Claude
 * reader (transcript.ts MAX_IMAGE_CHARS) — the image rides inside the page, so past this the tool
 * line stands alone.
 */
const MAX_IMAGE_CHARS = 1024 * 1024;

/** What an inline picture may claim to be — the gallery's own list, so still no SVG. */
const INLINE_IMAGE_TYPES = new Set(Object.values(IMAGE_TYPES));

/**
 * The picture a tool RETURNED, as a `data:` URL, or null. OpenCode stores images inline as
 * `{type:"file", uri:"data:image/png;base64,…"}` inside a tool's result content (verified
 * 2026-09-22) — a `read` of an image file embeds its bytes this way and nothing else. Mirrors
 * transcript.ts's {@link toolResultImage}: same guard, same `data:` shape, so the phone renders
 * it identically to a Claude-returned image. Last valid block wins.
 */
function toolResultImage(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  let found: string | null = null;
  for (const block of content) {
    const b = block as { type?: unknown; uri?: unknown } | null;
    if (b?.type !== "file" || typeof b.uri !== "string") continue;
    const m = /^data:(image\/[^;,]+);base64,([\s\S]*)$/.exec(b.uri);
    if (!m) continue;
    const media = m[1]!.toLowerCase();
    const data = m[2]!;
    if (
      INLINE_IMAGE_TYPES.has(media) &&
      data.replace(/\s/g, "").length <= MAX_IMAGE_CHARS
    ) {
      found = b.uri;
    }
  }
  return found;
}

function clamp(text: string, max: number): { text: string; truncated?: boolean } {
  if (text.length <= max) return { text };
  return { text: text.slice(0, max), truncated: true };
}

function isoTime(ms: unknown): string {
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0
    ? new Date(ms).toISOString()
    : "";
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
        // A picture the call RETURNED inline — the one case where the output IS the point.
        const returned = toolResultImage(state.content);
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
          ...(returned ? { image: returned } : {}),
        });
      }
    }
    if (parts.length === 0) continue;
    entries.push({ uuid: row.id, ts, role: "assistant", parts });
  }
  return entries;
}

/**
 * Page an opencode pane's conversation — the opencode half of the history route. The session is
 * opencode-store.ts's pane → session link (a reported id first, then the directory with the start
 * and mirror rules). Null when there is no safe answer or no renderable turn yet.
 * `queued` is always empty — OpenCode has no pending-input state this reader knows.
 */
export async function pageOpenCodeHistory(
  dbPath: string,
  opts: ResolveOpts & { limit: number; before?: string; after?: string },
): Promise<{
  entries: TranscriptEntry[];
  hasMore: boolean;
  total: number;
  fileTruncated: false;
  queued: string[];
} | null> {
  const store = openOpenCodeStore(dbPath);
  if (!store) return null;
  try {
    const sessionId = await resolveOpenCodeSession(store, opts);
    if (!sessionId) return null;
    const entries = parseOpenCodeMessages(messageRows(store, sessionId));
    if (entries.length === 0) return null;
    const { window, hasMore } = pageEntries(entries, {
      limit: opts.limit,
      ...(opts.after !== undefined ? { after: opts.after } : {}),
      ...(opts.before !== undefined && opts.after === undefined ? { before: opts.before } : {}),
    });
    return { entries: window, hasMore, total: entries.length, fileTruncated: false, queued: [] };
  } catch {
    return null;
  } finally {
    store.db.close();
  }
}
