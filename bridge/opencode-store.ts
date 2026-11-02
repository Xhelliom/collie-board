// OpenCode's session store, read-only, whichever version wrote it — and the one rule that
// links a pane to a session in it. Shared by the reading view (opencode-transcript.ts) and the
// gauge (opencode-usage.ts) so the two can never name different conversations for one pane.
//
// TWO SCHEMAS (both verified on real databases, 2026-11-02):
//   - 2.x (opencode v2.0.12, `opencode.db`): `session_v2` + `session_message` (one row per turn,
//     `type` user|assistant, ordered by `seq`, `data.content` holds the blocks).
//   - 1.x (opencode 1.15.10, `opencode-stable.db` — the file is named after the release channel):
//     drizzle's `session` + `message` (`data.role`, `data.tokens`) + `part` (one row per block:
//     text | reasoning | tool | step-start | step-finish | patch …, ordered by id).
// 1.x rows are rebuilt into the 2.x message shape here, so everything downstream reads one shape.
//
// WHICH FILE. The data dir can hold several `opencode*.db` (one per channel, or a 2.x next to a
// 1.x left behind); the one written last is the one in use.
//
// PANE → SESSION. A session herdr NAMES (`agent_session`, reported by the opencode integration)
// wins. Otherwise by directory, over ROOT sessions only (subagent runs are child sessions and
// never own a pane), and never a session created before the agent in the pane started: a freshly
// launched opencode has no session until its first message, and the directory then only holds
// OLDER conversations — serving one of them is the "wrong session" bug. Ambiguity (several live
// candidates, another opencode pane in the same directory, or an unknown start) is settled only
// by the pane's own mirror; no outright winner is no answer.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { flatten, mirrorFragments, pickByContent } from "./transcript.ts";

/** A session updated more recently than this counts as live for the ambiguity rule. */
export const OPENCODE_LIVE_MS = 10 * 60 * 1000;

/** A session created this long before the pane's agent process still counts as its own (clock grain). */
const START_SLACK_MS = 2000;

/** Most sessions ever scored against one mirror. */
const MAX_CONTENT_CANDIDATES = 12;

/** Newest messages read per candidate when scoring — the mirror only ever shows recent turns. */
const CONTENT_TAIL_MESSAGES = 40;

/** One turn, in the 2.x `session_message` shape whatever the schema. */
export interface MessageRow {
  id: string;
  type: string;
  time_created: number;
  data: string;
}

export interface OpenCodeStore {
  db: InstanceType<typeof Database>;
  version: 1 | 2;
}

/**
 * The database file in use: `path` itself when it is a file, else the most recently written
 * `opencode*.db` inside it (WAL included — opencode writes there first). Null when none.
 */
export function findOpenCodeDb(path: string): string | null {
  try {
    if (!path || !existsSync(path)) return null;
    if (!statSync(path).isDirectory()) return path;
    let best: { file: string; at: number } | null = null;
    for (const name of readdirSync(path)) {
      if (!/^opencode(-[\w.-]+)?\.db$/.test(name)) continue;
      const file = join(path, name);
      const at = Math.max(
        statSync(file).mtimeMs,
        existsSync(`${file}-wal`) ? statSync(`${file}-wal`).mtimeMs : 0,
      );
      if (!best || at > best.at) best = { file, at };
    }
    return best?.file ?? null;
  } catch {
    return null;
  }
}

/** Open the store read-only and tell its schema apart, or null (no file, unknown schema). */
export function openOpenCodeStore(path: string): OpenCodeStore | null {
  const file = findOpenCodeDb(path);
  if (!file) return null;
  let db: InstanceType<typeof Database> | null = null;
  try {
    db = new Database(file, { readonly: true });
    const has = (t: string) =>
      db!.query(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t) !== null;
    if (has("session_v2")) return { db, version: 2 };
    if (has("session") && has("message") && has("part")) return { db, version: 1 };
    db.close();
    return null;
  } catch {
    db?.close();
    return null;
  }
}

const sessionTable = (s: OpenCodeStore) => (s.version === 2 ? "session_v2" : "session");

export interface SessionRow {
  id: string;
  time_created: number;
  time_updated: number;
  model: string | null;
}

export function getSession(s: OpenCodeStore, id: string): SessionRow | null {
  return s.db
    .query<SessionRow, [string]>(
      `SELECT id, time_created, time_updated, model FROM ${sessionTable(s)} WHERE id = ? LIMIT 1`,
    )
    .get(id);
}

/** Root sessions filed under `cwd` (with or without a trailing slash), newest activity first. */
function rootSessions(s: OpenCodeStore, cwd: string): SessionRow[] {
  return s.db
    .query<SessionRow, [string, string]>(
      `SELECT id, time_created, time_updated, model FROM ${sessionTable(s)}
       WHERE (directory = ? OR directory = ?) AND (parent_id IS NULL OR parent_id = '')
       ORDER BY time_updated DESC`,
    )
    .all(cwd, cwd.endsWith("/") ? cwd.slice(0, -1) : `${cwd}/`);
}

/**
 * A session's turns oldest-first, in the 2.x shape. `tail` keeps only the newest N; `assistant`
 * keeps only assistant turns (the gauge's read).
 */
export function messageRows(
  s: OpenCodeStore,
  sessionId: string,
  opts: { tail?: number; assistant?: boolean } = {},
): MessageRow[] {
  const limit = opts.tail ?? -1; // sqlite: a negative LIMIT is no limit
  if (s.version === 2) {
    return s.db
      .query<MessageRow, [string, number]>(
        `SELECT id, type, time_created, data FROM session_message
         WHERE session_id = ? ${opts.assistant ? "AND type = 'assistant'" : ""}
         ORDER BY seq DESC LIMIT ?`,
      )
      .all(sessionId, limit)
      .reverse();
  }
  const messages = s.db
    .query<{ id: string; time_created: number; data: string }, [string, number]>(
      `SELECT id, time_created, data FROM message WHERE session_id = ?
       ${opts.assistant ? "AND json_extract(data, '$.role') = 'assistant'" : ""}
       ORDER BY time_created DESC, id DESC LIMIT ?`,
    )
    .all(sessionId, limit)
    .reverse();
  if (messages.length === 0) return [];
  const parts = new Map<string, unknown[]>();
  const ids = messages.map((m) => m.id);
  const partRows = s.db
    .query<{ message_id: string; data: string }, string[]>(
      `SELECT message_id, data FROM part WHERE session_id = ?
       ${opts.tail !== undefined ? `AND message_id IN (${ids.map(() => "?").join(",")})` : ""}
       ORDER BY message_id, id`,
    )
    .all(sessionId, ...(opts.tail !== undefined ? ids : []));
  for (const p of partRows) {
    try {
      const list = parts.get(p.message_id) ?? [];
      list.push(JSON.parse(p.data));
      parts.set(p.message_id, list);
    } catch {
      // corrupt part — the rest of the turn still reads
    }
  }
  return messages.map((m) => v1Row(m, parts.get(m.id) ?? []));
}

/** One 1.x message + its parts, as a 2.x `session_message` row. Pure — exported for the tests. */
export function v1Row(
  m: { id: string; time_created: number; data: string },
  parts: unknown[],
): MessageRow {
  let info: Record<string, unknown> = {};
  try {
    info = JSON.parse(m.data) as Record<string, unknown>;
  } catch {
    // an unreadable header still carries its parts
  }
  const blocks = parts.filter(
    (p): p is Record<string, unknown> => p !== null && typeof p === "object",
  );
  if (info.role === "user") {
    const text = blocks
      .filter((b) => b.type === "text" && typeof b.text === "string" && !b.synthetic)
      .map((b) => b.text as string)
      .join("\n");
    return { id: m.id, type: "user", time_created: m.time_created, data: JSON.stringify({ text }) };
  }
  const content = blocks.flatMap((b): unknown[] => {
    if ((b.type === "text" || b.type === "reasoning") && typeof b.text === "string")
      return [{ type: b.type, text: b.text }];
    if (b.type !== "tool") return [];
    const state = (b.state ?? {}) as Record<string, unknown>;
    const out = typeof state.output === "string" ? state.output : state.error;
    return [
      {
        type: "tool",
        name: b.tool,
        state: {
          status: state.status,
          input: state.input,
          content: typeof out === "string" ? [{ type: "text", text: out }] : [],
        },
      },
    ];
  });
  return {
    id: m.id,
    type: info.role === "assistant" ? "assistant" : String(info.role ?? ""),
    time_created: m.time_created,
    data: JSON.stringify({ content, tokens: info.tokens }),
  };
}

export interface ResolveOpts {
  /** The session herdr reports for the pane (opencode integration) — wins when the store has it. */
  sessionId?: string | null;
  cwd: string;
  now?: () => number;
  /** Start of the pane's agent process (ms epoch); null when unknown — then only the mirror decides. */
  startedAt?: number | null;
  /** Another opencode pane sits in the same directory: the clock cannot tell them apart. */
  shared?: boolean;
  /** The pane's terminal mirror, read only when the clock cannot decide. */
  mirror?: string | null | (() => Promise<string | null>);
}

/** The session backing a pane, or null when there is no safe answer. See the header. */
export async function resolveOpenCodeSession(
  s: OpenCodeStore,
  opts: ResolveOpts,
): Promise<string | null> {
  if (opts.sessionId && getSession(s, opts.sessionId)) return opts.sessionId;
  if (!opts.cwd) return null;
  const startedAt = opts.startedAt ?? null;
  const candidates = rootSessions(s, opts.cwd).filter(
    (c) => startedAt === null || c.time_created >= startedAt - START_SLACK_MS,
  );
  if (candidates.length === 0) return null;
  const at = (opts.now ?? Date.now)();
  const live = candidates.filter((c) => at - c.time_updated < OPENCODE_LIVE_MS).length;
  if (startedAt !== null && !opts.shared && live < 2) return candidates[0]!.id;
  const mirror = typeof opts.mirror === "function" ? await opts.mirror() : opts.mirror;
  if (!mirror) return null;
  return pickByMirror(s, candidates.slice(0, MAX_CONTENT_CANDIDATES), mirror);
}

/**
 * All matchable prose of one message's data JSON: the user text, every assistant text (and
 * non-empty reasoning) block, and every tool call — BOTH its input and its result. The mirror
 * shows both sides of a call, and the input is often the most distinctive line on screen.
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

/** Flatten a tool block's `state.content` — in practice always `[{type:'text'}]`. */
export function toolResultText(content: unknown): string {
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

/** OpenCode's TUI echoes a command as `$ <cmd>`; the store holds the bare `<cmd>`. */
function deEcho(fragment: string): string {
  return fragment.replace(/^\$\s+/, "");
}

/** Which candidate the mirror is showing — null unless one wins outright. */
function pickByMirror(s: OpenCodeStore, candidates: { id: string }[], mirror: string): string | null {
  const fragments = mirrorFragments(mirror);
  if (fragments.length === 0) return null;
  const scores: { path: string; hits: number }[] = [];
  for (const { id } of candidates) {
    try {
      const prose = flatten(
        messageRows(s, id, { tail: CONTENT_TAIL_MESSAGES }).map((r) => messageProse(r.data)).join("\n"),
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

/**
 * Everything the pane → session link needs to know about one pane, gathered from herdr: its
 * reported session, the start of its foreground process, whether another opencode pane shares its
 * directory, and (lazily) its mirror. Shared by the history route and the gauge.
 */
export async function paneResolveOpts(
  pane: { paneId: string; agent: string; cwd: string; agentSessionId?: string | null },
  agents: readonly { paneId: string; agent: string; cwd: string }[],
  herdr: {
    paneProcess(paneId: string): Promise<{ pid: number } | null>;
    readPane(paneId: string, source: "recent", lines: number, format: "ansi"): Promise<{ text: string }>;
  },
  processStartedAt: (pid: number) => Promise<number | null>,
): Promise<ResolveOpts> {
  const proc = await herdr.paneProcess(pane.paneId).catch(() => null);
  return {
    sessionId: pane.agentSessionId ?? null,
    cwd: pane.cwd,
    startedAt: proc ? await processStartedAt(proc.pid).catch(() => null) : null,
    shared: agents.some((a) => a.paneId !== pane.paneId && a.agent === pane.agent && a.cwd === pane.cwd),
    // "ansi", not "text": the plain-text conversion takes seconds on an idle pane (HERDR_API.md).
    mirror: () => herdr.readPane(pane.paneId, "recent", 200, "ansi").then((r) => r.text, () => null),
  };
}
