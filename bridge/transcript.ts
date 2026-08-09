// Agent transcript history — the scrollback Herdr structurally cannot give us.
//
// WHY THIS EXISTS. A pane running Claude sits on the terminal's ALTERNATE SCREEN, and the alternate
// screen has no scrollback ring — Herdr's terminal core (Ghostty) keeps nothing behind the viewport.
// Empirically: every claude pane reports `scroll.max_offset_from_bottom: 0`, and `pane.read` returns
// exactly `viewport_rows + 1` lines no matter how many you ask for (200, 600, 5000, 10000 — all 52).
// A plain bash pane on the primary screen, by contrast, reports 6895 and pages fine. So "load older"
// against a Claude pane can never work: the bytes were never retained. This is upstream terminal
// behaviour, not a Collie bug and not a config knob.
//
// The history does exist, though — Claude Code writes every turn to its own session log at
// `~/.claude/projects/<mangled-cwd>/<session-uuid>.jsonl`, and Herdr hands us that uuid on the pane
// record (`agent_session.value`). This module turns that log into a bounded, typed transcript the
// phone can page through. It is strictly BETTER than terminal scrollback would have been: real
// message boundaries, timestamps, tool calls folded together with their results, and it survives the
// pane being closed.
//
// SHAPE OF THE SOURCE (verified against Claude Code 2.1.220, 2026-07-26):
//   {"type":"user",      "message":{"role":"user","content":"..." | [ {type:"tool_result",...} ]}, ...}
//   {"type":"assistant", "message":{"role":"assistant","content":[ {type:"text"|"thinking"|"tool_use"} ]}}
//   plus bookkeeping rows we ignore (mode, permission-mode, ai-title, file-history-*, queue-operation…).
// Human turns carry a STRING content; a `user` row whose content is a LIST is tool-result traffic,
// not something the user typed — we fold those into the tool call that produced them rather than
// rendering 705 fake "user" turns. `isSidechain` marks subagent traffic (dropped by default);
// `isCompactSummary` marks the summary Claude writes when a session is compacted.
//
// A message typed while the agent is mid-turn (steered straight into the running turn, "surfaced
// alongside the next tool result" rather than queued for the next one) never gets a `user` row at
// all — verified against Claude Code 2.1.222, 2026-08-06, on this repo's own session log. It's
// journaled as {"type":"attachment","attachment":{"type":"queued_command","prompt":"...",...}}
// instead. Miss this shape and the message is gone from the transcript for good, not just delayed —
// it was 5/5 of this session's own mid-turn messages, none of which ever became a `user` row.
//
// SECURITY. This reads files, which nothing else in the bridge does, so the path is pinned shut:
//  - the client never supplies a path — only a pane id, which we map to a session uuid server-side;
//  - the uuid must match a strict v4-shaped pattern before it is ever concatenated into a path;
//  - the resolved file must still be inside the transcript root after symlink resolution;
//  - reads are byte-capped, so a pathological log can't balloon the bridge's memory.
// The transcript is exactly as sensitive as the pane mirror Collie already serves (it is the same
// conversation), but it reaches further back — `COLLIE_BOARD_TRANSCRIPT=off` disables the feature wholesale.

import { readdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";

import { containedIn, galleryRoot, isImagePath } from "./gallery.ts";

/** First bytes of a file — enough to find the root entry without reading a multi-megabyte log. */
async function head(path: string, bytes = 64 * 1024): Promise<string> {
  return Bun.file(path).slice(0, bytes).text();
}

/** A session uuid as Claude writes it — canonical 8-4-4-4-12 hex. Anything else never touches fs. */
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Most bytes we will ever pull off one transcript. Beyond this we keep the TAIL (newest turns). */
const MAX_TRANSCRIPT_BYTES = 32 * 1024 * 1024; // 32 MB

/** Per-tool-result cap. Tool output is unbounded (a 2 MB file read); the phone only needs a gist. */
const MAX_RESULT_CHARS = 2000;

/** Per-text-part cap. Generous — assistant prose is the thing you actually came to read. */
const MAX_TEXT_CHARS = 20_000;

/** How many parsed transcripts to keep hot. Each is re-parsed only when the file's size/mtime moves. */
const CACHE_MAX = 4;

/** One renderable piece of a turn. Deliberately small — the phone renders these as text nodes. */
export type TranscriptPart =
  | { kind: "text"; text: string; truncated?: boolean }
  /**
   * Extended-thinking text. In practice this NEVER fires: Claude Code writes `thinking` blocks whose
   * `thinking` field is an empty string, keeping only the encrypted `signature` (verified 2026-07-26:
   * 3944 of 3944 blocks across 40 session logs were empty). The branch stays because the block type is
   * real and not ours to control — if a future version persists the text, it renders instead of vanishing.
   */
  | { kind: "thinking"; text: string; truncated?: boolean }
  /** A tool call. `result` is filled in from the `tool_result` row that answers it, when one exists. */
  | {
      kind: "tool";
      name: string;
      /** One-line gist of the call's input (the file read, the command run) — never the whole input. */
      summary: string;
      result?: { text: string; truncated?: boolean; isError?: boolean };
      /**
       * Absolute path of the image this call touched, when it touched one the gallery route can
       * actually serve (see {@link toolImagePath}). The client renders the picture in place of the
       * tool line — "Read /…/render.png" is the one tool call whose own output is the point.
       */
      image?: string;
    };

/**
 * One turn of the conversation.
 *
 * `user`/`assistant` are speech. The other two are NOT, and are rendered set apart so they can't be
 * mistaken for it: `summary` is Claude's own compaction summary, and `note` is machine-injected
 * content that still belongs on screen (a background task finishing, a local command's output).
 */
export interface TranscriptEntry {
  /** The source row's uuid — stable, and the paging cursor (`before`). */
  uuid: string;
  /** ISO timestamp from the log; empty when the row carried none. */
  ts: string;
  role: "user" | "assistant" | "summary" | "note";
  parts: TranscriptPart[];
}

/** What the history endpoint answers with. */
export interface TranscriptPage {
  paneId: string;
  /** Oldest-first, ready to render top-down. */
  entries: TranscriptEntry[];
  /** True when older turns exist before `entries[0]` — drives "load older". */
  hasMore: boolean;
  /** Total turns available in the parsed window (after sidechain filtering). */
  total: number;
  /** True when the on-disk log exceeded the byte cap and we kept only its tail. */
  fileTruncated: boolean;
  /**
   * Messages currently sitting in Claude Code's OWN input queue, oldest first — submitted while the
   * agent was busy, not yet taken. This is the one state {@link parseTranscript} can never produce a
   * turn for: a queued message has no `user` row (and no `attachment` one either) until it's taken or
   * recalled, so without this it is invisible everywhere Collie reads from the log.
   */
  queued: string[];
}

// ── pure parsing ──────────────────────────────────────────────────────────────

/** Guard used before any path work. Exported so the route can 400 on a malformed id explicitly. */
export function isSessionId(value: string): boolean {
  return SESSION_ID_RE.test(value);
}

/**
 * Claude Code's project-directory name for a working directory: every non-alphanumeric byte becomes
 * `-`. Verified against the installed version (2026-07-28) —
 * `/home/me/.herdr/worktrees/repo/board-x` → `-home-me--herdr-worktrees-repo-board-x`.
 *
 * The mangling is LOSSY (two different paths can collide), which is why `resolve()` never uses it.
 * It is sound for {@link TranscriptSource.resolveByCwd} only because the caller supplies a checkout
 * root it created itself, not a pane's drifting cwd. Pure + exported for the test.
 */
export function mangleProjectDir(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

// CSI/SGR and two-character escapes. Transcript text is NOT a terminal mirror — nothing downstream
// interprets escapes, so a `\x1b[2m` left in place renders as garbage glyphs on the phone.
const ANSI_RE = /\[[0-9;?]*[ -/]*[@-~]|[@-Z\\-_]/g;

/** Strip terminal escapes from log text. Exported for the parser's tests. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/** Inner text of the first `<tag>…</tag>`, trimmed; null when the tag isn't present. */
function inner(tag: string, text: string): string | null {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text);
  return m ? (m[1] ?? "").trim() : null;
}

/** True when the content IS this envelope (rather than merely mentioning the tag in prose). */
function isEnvelope(tag: string, text: string): boolean {
  return text.trimStart().startsWith(`<${tag}>`);
}

/**
 * Classify a `user` row's string content.
 *
 * Only about half of these are things a human typed — Claude Code reuses the user role as the
 * carrier for injected plumbing. Measured across 60 session logs: 1196 string-content user rows, of
 * which 359 `task-notification`, 82 `local-command-caveat`, 82 `command-name`, 78
 * `local-command-stdout` and 21 `system-reminder` were envelopes rather than speech. Rendering those
 * verbatim as "You" would be actively wrong, so each is handled on its merits:
 *
 *  - `system-reminder` / `local-command-caveat` → DROPPED. Both are addressed to the model, never
 *    shown to the operator in the TUI (the caveat literally says "DO NOT respond to these").
 *  - `command-name` → a slash command the user really did run; shown as `/compact`, args included.
 *  - `local-command-stdout` → that command's output. Real, but not speech → a `note`.
 *  - `task-notification` → a background agent finishing. Reduced to its `<summary>` line → a `note`.
 *
 * Returns null for "drop this row entirely".
 */
export function classifyUserText(
  raw: string,
): { role: "user" | "note"; text: string } | null {
  const text = stripAnsi(raw);

  if (isEnvelope("system-reminder", text)) return null;
  if (isEnvelope("local-command-caveat", text)) return null;

  if (isEnvelope("command-name", text)) {
    const name = inner("command-name", text) ?? "";
    const args = inner("command-args", text) ?? "";
    const line = `${name} ${args}`.trim();
    return line === "" ? null : { role: "user", text: line };
  }

  if (isEnvelope("local-command-stdout", text)) {
    const stdout = inner("local-command-stdout", text) ?? "";
    return stdout === "" ? null : { role: "note", text: stdout };
  }

  if (isEnvelope("task-notification", text)) {
    const summary = inner("summary", text);
    return summary ? { role: "note", text: summary } : null;
  }

  return text.trim() === "" ? null : { role: "user", text };
}

function clamp(text: string, max: number): { text: string; truncated?: boolean } {
  if (text.length <= max) return { text };
  return { text: text.slice(0, max), truncated: true };
}

/**
 * Collapse a tool call's input into one readable line. The well-known tools get their defining
 * argument (the path, the command, the pattern); anything else falls back to the first string-ish
 * value, so a tool this code has never heard of still reads as something rather than "{...}".
 */
export function summarizeToolInput(input: unknown): string {
  if (input === null || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = o[k];
      if (typeof v === "string" && v.trim() !== "") return v;
    }
    return undefined;
  };
  // Order matters: the MOST defining argument first. Grep carries both `pattern` and `path`, and the
  // pattern is what you actually searched for; Task carries both `description` and `prompt`, and the
  // description is already the one-line form.
  const chosen =
    pick("file_path", "command", "pattern", "query", "url", "path", "description", "prompt") ??
    // Unknown tool: first string value wins, so the line is never empty for no reason.
    Object.values(o).find((v): v is string => typeof v === "string" && v.trim() !== "");
  if (chosen === undefined) return "";
  // Tool inputs can be multi-line (a Bash heredoc); a summary is one line by definition.
  const oneLine = chosen.replace(/\s+/g, " ").trim();
  return oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine;
}

/**
 * The image a tool call touched, or null. Only `file_path` counts — the argument Read/Write/Edit all
 * name their target with — and only when it's an absolute path to a servable image type INSIDE the
 * gallery root, because a path the gallery route would refuse is a broken `<img>` on the phone.
 *
 * The containment test here is on the path AS WRITTEN, which is a display filter and nothing more:
 * this function is pure (parseTranscript touches no fs), so it can't resolve symlinks. The decision
 * that actually guards the bytes is {@link resolveImage} in gallery.ts, which realpaths both sides at
 * serve time. Do not read this as an authorisation check.
 */
export function toolImagePath(input: unknown, root: string): string | null {
  if (input === null || typeof input !== "object") return null;
  const p = (input as Record<string, unknown>).file_path;
  if (typeof p !== "string" || !isAbsolute(p)) return null;
  const full = normalize(p);
  return isImagePath(full) && containedIn(root, full) ? full : null;
}

/** Flatten a `tool_result.content`, which is either a plain string or a list of text blocks. */
function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => (b && typeof b === "object" && typeof (b as { text?: unknown }).text === "string"
      ? (b as { text: string }).text
      : ""))
    .filter(Boolean)
    .join("\n");
}

interface RawRow {
  type?: unknown;
  uuid?: unknown;
  timestamp?: unknown;
  isSidechain?: unknown;
  isCompactSummary?: unknown;
  message?: { role?: unknown; content?: unknown } | unknown;
  attachment?: { type?: unknown; prompt?: unknown } | unknown;
}

/**
 * Parse a Claude session log into oldest-first turns.
 *
 * PURE — no fs, no clock — so the whole grammar is unit-testable (`bun test`). Unparseable lines are
 * skipped rather than thrown on: a log is appended to live, so the final line can be a partial write,
 * and a tail-read window starts mid-line by construction.
 *
 * `includeSidechains` defaults false: subagent traffic is a different conversation and would swamp
 * the thread you opened.
 */
export function parseTranscript(
  text: string,
  opts: { includeSidechains?: boolean; imageRoot?: string } = {},
): TranscriptEntry[] {
  const imageRoot = opts.imageRoot ?? galleryRoot();
  const entries: TranscriptEntry[] = [];
  // tool_use id → the part awaiting its result, so a `tool_result` row lands on the call that made it.
  const pendingTools = new Map<string, Extract<TranscriptPart, { kind: "tool" }>>();

  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let row: RawRow;
    try {
      row = JSON.parse(line) as RawRow;
    } catch {
      continue; // partial trailing write, or the clipped first line of a tail read
    }
    const type = row.type;
    if (type === "attachment") {
      const attachment = row.attachment;
      if (attachment !== null && typeof attachment === "object") {
        const a = attachment as { type?: unknown; prompt?: unknown };
        if (a.type === "queued_command" && typeof a.prompt === "string") {
          const classified = classifyUserText(a.prompt);
          if (classified !== null) {
            entries.push({
              uuid: typeof row.uuid === "string" ? row.uuid : "",
              ts: typeof row.timestamp === "string" ? row.timestamp : "",
              role: classified.role,
              parts: [{ kind: "text", ...clamp(classified.text, MAX_TEXT_CHARS) }],
            });
          }
        }
      }
      continue;
    }
    if (type !== "user" && type !== "assistant") continue;
    if (row.isSidechain === true && !opts.includeSidechains) continue;

    const message = row.message;
    if (message === null || typeof message !== "object") continue;
    const content = (message as { content?: unknown }).content;
    const uuid = typeof row.uuid === "string" ? row.uuid : "";
    const ts = typeof row.timestamp === "string" ? row.timestamp : "";
    const parts: TranscriptPart[] = [];
    // Set by a `user` row whose string content turns out to be injected plumbing rather than speech.
    let roleOverride: "note" | undefined;

    if (typeof content === "string") {
      // A string content is the HUMAN-turn carrier — but Claude Code also routes injected plumbing
      // through it, so classify before believing it (see classifyUserText).
      const classified = classifyUserText(content);
      if (classified === null) continue;
      if (classified.role === "note") roleOverride = "note";
      parts.push({ kind: "text", ...clamp(classified.text, MAX_TEXT_CHARS) });
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block === null || typeof block !== "object") continue;
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") {
          if (b.text.trim() !== "")
            parts.push({ kind: "text", ...clamp(stripAnsi(b.text), MAX_TEXT_CHARS) });
        } else if (b.type === "thinking" && typeof b.thinking === "string") {
          if (b.thinking.trim() !== "")
            parts.push({ kind: "thinking", ...clamp(stripAnsi(b.thinking), MAX_TEXT_CHARS) });
        } else if (b.type === "tool_use") {
          const part: Extract<TranscriptPart, { kind: "tool" }> = {
            kind: "tool",
            name: typeof b.name === "string" ? b.name : "tool",
            summary: summarizeToolInput(b.input),
          };
          const image = toolImagePath(b.input, imageRoot);
          if (image) part.image = image;
          if (typeof b.id === "string") pendingTools.set(b.id, part);
          parts.push(part);
        } else if (b.type === "tool_result") {
          // Fold onto the call that produced it. The awaited part is MUTATED in place — it already
          // sits in an emitted entry, which is exactly why results attach without reordering anything.
          const id = typeof b.tool_use_id === "string" ? b.tool_use_id : "";
          const target = pendingTools.get(id);
          // Tool output routinely carries colour codes (any command run through a shell) — strip
          // them, since this view renders text nodes rather than interpreting escapes.
          const resultText = stripAnsi(toolResultText(b.content));
          if (target) {
            pendingTools.delete(id);
            target.result = {
              ...clamp(resultText, MAX_RESULT_CHARS),
              ...(b.is_error === true ? { isError: true } : {}),
            };
          } else if (resultText.trim() !== "") {
            // Orphan result (its call fell outside a tail-read window) — keep it, unattached, so the
            // window never silently drops output.
            parts.push({
              kind: "tool",
              name: "result",
              summary: "",
              result: {
                ...clamp(resultText, MAX_RESULT_CHARS),
                ...(b.is_error === true ? { isError: true } : {}),
              },
            });
          }
        }
      }
    }

    if (parts.length === 0) continue; // bookkeeping row with nothing to show
    const role: TranscriptEntry["role"] =
      row.isCompactSummary === true
        ? "summary"
        : type === "assistant"
          ? "assistant"
          : (roleOverride ?? "user");
    entries.push({ uuid, ts, role, parts });
  }

  return entries;
}

/**
 * Messages currently sitting in Claude Code's own input queue, oldest first.
 *
 * `{"type":"queue-operation","operation":"enqueue","content":"..."}` is the ONLY place a queued
 * message's text is ever written while it's still pending — the terminal's "❯" line has already
 * swapped it for the "Press up to edit queued messages" placeholder by the time anyone reads the
 * screen, and no `user`/`attachment` row exists for it until it's taken or recalled. FIFO: `enqueue`
 * pushes, `dequeue` (taken) and `remove` (recalled via Up, never sent) both pop the front — `remove`
 * happens to also carry the content, but which one left doesn't matter, only that one did.
 *
 * Claude Code's queue isn't only human input — it's also how it hands itself a `<task-notification>`
 * or other plumbing to deliver on the NEXT turn, and a session sitting idle has no next turn to
 * dequeue it on, so a system item can sit "pending" indefinitely. Filtered through
 * {@link classifyUserText}, the same rule that already keeps such plumbing out of the transcript's
 * `user` turns — done AFTER the FIFO walk, on the raw content, so a filtered-out system entry still
 * consumes its own `dequeue`/`remove` instead of one meant for a real, still-pending human message.
 *
 * PURE — no fs, no clock — like the rest of this file's parsing.
 */
export function pendingQueue(text: string): string[] {
  const queue: string[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let row: { type?: unknown; operation?: unknown; content?: unknown };
    try {
      row = JSON.parse(line) as typeof row;
    } catch {
      continue; // partial trailing write, or the clipped first line of a tail read
    }
    if (row.type !== "queue-operation") continue;
    if (row.operation === "enqueue" && typeof row.content === "string") queue.push(row.content);
    else if (row.operation === "dequeue" || row.operation === "remove") queue.shift();
  }
  return queue
    .map((content) => classifyUserText(content))
    .filter((c): c is { role: "user"; text: string } => c !== null && c.role === "user")
    .map((c) => c.text);
}

/**
 * Page a parsed transcript. Returned entries stay oldest-first so the view renders top-down whichever
 * direction you asked in.
 *
 * BACKWARDS (default, or `before`): with no cursor you get the LAST `limit` turns (the phone opens at
 * the recent end, like the mirror it replaces); `before` walks backwards from a turn you already hold.
 *
 * FORWARDS (`after`): the turns written SINCE one you already hold — for a view that follows a live
 * conversation rather than paging back through it. Without it, following means re-pulling the whole
 * archive on every tick just to discover the two turns that are new. Symmetric with `before` in every
 * way that matters: the same cap, the same opaque uuid cursor, the same degradation on a cursor this
 * log no longer knows.
 */
export function pageEntries(
  entries: TranscriptEntry[],
  opts: { limit: number; before?: string; after?: string },
): { window: TranscriptEntry[]; hasMore: boolean } {
  if (opts.after !== undefined) {
    const i = entries.findIndex((e) => e.uuid === opts.after);
    // Unknown cursor — the log rotated under a follower, or the client is stale. Degrade to the newest
    // page, exactly as `before` does; a follower merges by uuid, so a disjoint window can't duplicate
    // what it already holds.
    if (i === -1) return pageEntries(entries, { limit: opts.limit });
    const window = entries.slice(i + 1, i + 1 + opts.limit);
    // `hasMore` keeps its single meaning — older turns exist BEFORE the window — which is true by
    // construction whenever this returned anything: the cursor itself is one of them.
    return { window, hasMore: window.length > 0 };
  }
  // An unknown cursor (log rewritten under us, or a stale client) degrades to "newest", never to an
  // empty page — the user asked for older history and must still see something.
  const end =
    opts.before === undefined
      ? entries.length
      : (() => {
          const i = entries.findIndex((e) => e.uuid === opts.before);
          return i === -1 ? entries.length : i;
        })();
  const start = Math.max(0, end - opts.limit);
  return { window: entries.slice(start, end), hasMore: start > 0 };
}

// ── fs-backed store ───────────────────────────────────────────────────────────

/**
 * The uuid of a log's first entry — its conversation ROOT.
 *
 * Claude Code does not keep one file per conversation. Resuming a session (and `/fork`, and
 * promotion to a background job) COPIES the whole thread into a fresh `<new-uuid>.jsonl` and
 * continues there, while Herdr keeps reporting whichever id the agent last announced. Observed live:
 * Herdr named a log frozen at 18:12 while the conversation had been continuing in a different file
 * until 20:59 — nearly three hours of history simply invisible.
 *
 * Every copy preserves the original first entry, so the root uuid identifies the lineage: three logs
 * of one conversation all began `bcb07539-…`, while unrelated sessions in the same directory each had
 * their own. Exported for the tests.
 */
export function conversationRoot(text: string): string | null {
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const row = JSON.parse(line) as { uuid?: unknown };
      if (typeof row.uuid === "string" && row.uuid !== "") return row.uuid;
    } catch {
      continue; // a clipped/partial line — keep looking
    }
  }
  return null;
}

/** The fs seam. Real implementation below; tests inject a fake so no temp files are needed. */
export interface TranscriptSource {
  /** Absolute path of the log for `sessionId`, or null when it isn't on disk. */
  resolve(sessionId: string): Promise<string | null>;
  /**
   * Absolute path of the log the agent process started at `startedAtMs` is CONVERSING IN, or null.
   *
   * "Written during this process's life" is the rule, i.e. the newest log whose mtime lands after the
   * process started. Birth time is only the tie-break, for a process that hasn't written yet.
   *
   * IT USED TO BE THE OTHER WAY ROUND — the log BORN closest after the process started — and that is
   * wrong for a **resumed** conversation, which is most of them in a long-running herd. Live case
   * (2026-08-03): a pane's claude started 09:54:48 and Claude Code created a log 17 s later, then
   * resumed a conversation from four days earlier and wrote everything into THAT file. The startup
   * log went dead at 31 entries while the real one grew to 20 MB — and the "exact" rule served the
   * dead one: a months-old conversation presented as the pane's history, and another session's
   * occupancy on the context gauge.
   *
   * What this gives up: two agents live in ONE directory, both writing, is back to a coin flip
   * (whoever wrote last). That case is rare here by construction — a card gets its own worktree — and
   * an actively-wrong file for a resumed session is the more common failure by far.
   *
   * Falls back to {@link resolveByCwd} when neither signal is available (birth times need statx, so
   * some filesystems and platforms report 0) — a worse answer, never a wrong crash.
   */
  resolveForProcess(cwd: string, startedAtMs: number): Promise<string | null>;

  /**
   * Absolute path of the newest log written by an agent STARTED in `cwd`, or null.
   *
   * The fallback for when herdr reports no `agent_session` for a pane — which is the DEFAULT state:
   * that field only appears once `herdr integration install claude` has planted its hook, and a
   * plain install has none (verified on 0.7.5, 2026-07-28: not one agent pane in the herd carried
   * it). Without this, the context gauge would be dead for most users.
   *
   * Only sound because the CALLER knows the exact directory the agent was launched in — the board
   * creates the worktree itself. `resolve()` deliberately refuses to derive a path from a pane's
   * reported cwd, because that drifts as the agent works; a checkout root does not.
   */
  resolveByCwd(cwd: string): Promise<string | null>;
  /** Tail-read a log. `complete` is false when the byte cap clipped the head. */
  load(path: string): Promise<{ text: string; complete: boolean; size: number; mtimeMs: number }>;
}

/** The file facts resolution decides on. See {@link ClaudeTranscriptSource}'s constructor for why. */
export interface FileTimes {
  size: number;
  mtimeMs: number;
  /** 0 on a filesystem with no birth time (no statx) — resolution degrades, it never throws. */
  birthtimeMs: number;
}

export type StatFn = (path: string) => Promise<FileTimes>;

const realStat: StatFn = async (path) => {
  const st = await stat(path);
  return { size: st.size, mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs };
};

/**
 * Real filesystem source rooted at Claude's projects directory.
 *
 * Resolution is by UUID SCAN, not by reconstructing the mangled project-directory name from the
 * pane's cwd. The mangling is lossy (every non-alphanumeric becomes "-") and, worse, a pane's
 * reported cwd drifts as the agent works — a subdirectory cwd would derive a directory that doesn't
 * exist. Session uuids are globally unique, so scanning the project dirs for `<uuid>.jsonl` is both
 * correct and cheap (measured: ~14 ms across 306 logs, and the hit is then cached).
 */
export class ClaudeTranscriptSource implements TranscriptSource {
  private readonly pathCache = new Map<string, string>();

  /**
   * `root` is Claude's projects directory. `statFile` is injected for ONE reason: resolution decides
   * which log belongs to which agent from the relationship between a file's BIRTH time and a
   * process's start time, and a test fixture cannot forge a birth time — every file it writes is born
   * now. Without this seam the two cases resolveForProcess has to tell apart (a resumed conversation
   * vs. a second agent in the same directory) are literally inexpressible in a test, which is how the
   * rule got inverted twice. Only the RESOLVERS use it; `load()` keeps the real stat, because what it
   * reports must describe the bytes it actually read.
   */
  constructor(
    private readonly root: string,
    private readonly statFile: StatFn = realStat,
  ) {}

  async resolve(sessionId: string): Promise<string | null> {
    if (!isSessionId(sessionId)) return null; // never build a path from an unvalidated id
    const cached = this.pathCache.get(sessionId);
    if (cached !== undefined) {
      // Re-verify: a cached path can vanish when a session is deleted.
      //
      // The cache memoises only the EXPENSIVE part — the global scan that maps a uuid to its file,
      // which never changes. Continuation-following must still run on every call, because the
      // conversation rotates into a new file WHILE the bridge is up: caching its result would pin the
      // answer to whatever was true at the first request and go stale minutes later.
      if (await exists(cached)) return this.followContinuation(cached);
      this.pathCache.delete(sessionId);
    }

    let dirs: string[];
    try {
      dirs = await readdir(this.root);
    } catch {
      return null; // no ~/.claude/projects at all — feature simply has nothing to serve
    }
    const file = `${sessionId}.jsonl`;
    for (const dir of dirs) {
      const candidate = join(this.root, dir, file);
      if (!(await exists(candidate))) continue;
      // Containment check AFTER symlink resolution: a project dir symlinked outside the root must not
      // become a way to read arbitrary files, even though the id itself is already pattern-validated.
      const real = await realpath(candidate).catch(() => null);
      const realRoot = await realpath(this.root).catch(() => null);
      if (real === null || realRoot === null) return null;
      if (real !== realRoot && !real.startsWith(realRoot + sep)) return null;
      this.pathCache.set(sessionId, real);
      return this.followContinuation(real);
    }
    return null;
  }

  /**
   * Follow a rotated conversation to the log it actually continues in.
   *
   * The id Herdr reports can name a FROZEN PREFIX (see {@link conversationRoot}), so serving it
   * verbatim silently drops everything since the rotation. We look for siblings sharing this log's
   * root uuid and prefer the most recently written one.
   *
   * Two guards keep this from making things worse:
   *  - a candidate must be at least as large as the log we already have, so following can never show
   *    LESS history than not following;
   *  - only the first line of each sibling is read (plus a stat), so the scan is a few milliseconds
   *    over a directory of ~40 logs — and this route is on-demand, never on the poll loop.
   *
   * Known limit: a `/fork` of the same conversation shares the root too, so a fork being written more
   * recently than the pane's own session would win. That needs a per-pane session id Herdr doesn't
   * expose; showing the freshest branch of the right conversation beats showing a stale one.
   */
  private async followContinuation(path: string): Promise<string> {
    const dir = dirname(path);
    let self: { root: string | null; size: number; mtimeMs: number };
    try {
      const st = await this.statFile(path);
      self = { root: conversationRoot(await head(path)), size: st.size, mtimeMs: st.mtimeMs };
    } catch {
      return path;
    }
    if (self.root === null) return path;

    let best = { path, size: self.size, mtimeMs: self.mtimeMs };
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return path;
    }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const candidate = join(dir, name);
      if (candidate === path) continue;
      try {
        const st = await this.statFile(candidate);
        if (st.mtimeMs <= best.mtimeMs || st.size < self.size) continue;
        if (conversationRoot(await head(candidate)) !== self.root) continue;
        best = { path: candidate, size: st.size, mtimeMs: st.mtimeMs };
      } catch {
        continue; // unreadable sibling — ignore it rather than fail the whole read
      }
    }
    // `path` arrives already containment-checked (resolve()'s callers only pass a validated real
    // path), but `best` can now name a SIBLING the scan just picked off disk — a project dir symlinked
    // outside the root must not become a way to read arbitrary files just because it sits next to a
    // legitimate log and shares its conversation root. Same rule as contained(), skipped here on the
    // (safe) path so the common case pays no extra realpath call.
    if (best.path === path) return path;
    return (await this.contained(best.path)) ?? path;
  }

  async resolveForProcess(cwd: string, startedAtMs: number): Promise<string | null> {
    const dir = join(this.root, mangleProjectDir(cwd));
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return null;
    }
    // A small negative slack absorbs clock granularity on both comparisons.
    const SLACK_MS = 5_000;
    // The most recently WRITTEN log, and whether it already existed when this process started.
    let live: { path: string; mtimeMs: number; predatesStart: boolean } | null = null;
    // The log born CLOSEST AFTER this process started — the only signal that tells two live agents
    // apart, since a session log is created BY the process that owns it.
    let born: { path: string; delta: number } | null = null;
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const candidate = join(dir, name);
      try {
        const st = await this.statFile(candidate);
        const birth = st.birthtimeMs; // 0 where statx is unavailable — then `live` has to carry it
        if (st.mtimeMs >= startedAtMs - SLACK_MS && (!live || st.mtimeMs > live.mtimeMs)) {
          live = {
            path: candidate,
            mtimeMs: st.mtimeMs,
            // Strictly older than this process, so this process cannot have created it.
            predatesStart: birth > 0 && birth < startedAtMs - SLACK_MS,
          };
        }
        if (birth) {
          const delta = birth - startedAtMs;
          if (delta >= -SLACK_MS && (!born || delta < born.delta)) {
            born = { path: candidate, delta };
          }
        }
      } catch {
        continue;
      }
    }
    // ONE categorical fact decides which rule applies — was the live log already there when we
    // started — and not any duration threshold:
    //
    //  - Born BEFORE us → we cannot have created it, so this is a conversation the process RESUMED,
    //    and "what is being written" is the only signal there is. (Claude Code also opens a log of its
    //    own at launch and then abandons it for the resumed one, dead at a few dozen entries — that
    //    abandoned file is exactly what `born` would hand back. Live evidence 2026-08-03: the startup
    //    log stopped at 31 entries while the resumed one grew to 20 MB.)
    //  - Born AFTER us → every candidate was created by SOME process around ITS OWN start, so "newest
    //    write" merely names whichever agent spoke last — the same file for every pane in the
    //    directory. Live evidence 2026-08-09: two agents in one repo, both panes shown one
    //    transcript. The log born closest to OUR start is ours.
    //
    // With no birth times at all (`born` null, no statx) this degrades to the newest-write answer,
    // which stays correct whenever the directory holds a single agent.
    const best = live?.predatesStart ? live : (born ?? live);
    if (best === null) return this.resolveByCwd(cwd);
    return this.contained(best.path);
  }

  async resolveByCwd(cwd: string): Promise<string | null> {
    const dir = join(this.root, mangleProjectDir(cwd));
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return null; // no project dir for that cwd — nothing has run there
    }
    // Newest wins: a resumed/forked conversation writes a fresh file, exactly as followContinuation
    // handles for the id path.
    let best: { path: string; mtimeMs: number } | null = null;
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const candidate = join(dir, name);
      try {
        const st = await this.statFile(candidate);
        if (!best || st.mtimeMs > best.mtimeMs) best = { path: candidate, mtimeMs: st.mtimeMs };
      } catch {
        continue;
      }
    }
    if (best === null) return null;
    return this.contained(best.path);
  }

  /**
   * Same containment rule as resolve(): a project dir symlinked outside the root must not become a
   * way to read arbitrary files, even though nothing here comes from a request.
   */
  private async contained(path: string): Promise<string | null> {
    const real = await realpath(path).catch(() => null);
    const realRoot = await realpath(this.root).catch(() => null);
    if (real === null || realRoot === null) return null;
    return real === realRoot || real.startsWith(realRoot + sep) ? real : null;
  }

  async load(path: string): Promise<{ text: string; complete: boolean; size: number; mtimeMs: number }> {
    const st = await stat(path);
    const size = st.size;
    const complete = size <= MAX_TRANSCRIPT_BYTES;
    const file = Bun.file(path);
    // Over the cap we keep the TAIL — the newest turns are the ones worth having. The clipped first
    // line is a partial JSON object; parseTranscript skips it by design.
    const text = complete
      ? await file.text()
      : await file.slice(size - MAX_TRANSCRIPT_BYTES).text();
    return { text, complete, size, mtimeMs: st.mtimeMs };
  }
}

/**
 * Find a pane's transcript when herdr reports NO `agent_session` — which is the default state, not an
 * edge case: that field only exists once `herdr integration install <agent>` has planted its hook.
 *
 * Ask herdr for the pane's foreground pid, read that process's start time, and take the log born
 * closest after it ({@link TranscriptSource.resolveForProcess}). Exact even with two agents live in
 * one directory, where "newest file in the folder" is a coin flip — and a coin flip here means
 * showing someone else's conversation. Everything degrades in order: no pid, no `/proc`, no birth
 * times → the by-directory guess → null.
 *
 * The lookups are INJECTED rather than imported so this stays testable without a socket or a `/proc`,
 * and so the one implementation can serve both consumers (the context gauge and the history route).
 * Callers must have established that this agent writes a readable transcript at all — resolution is
 * by directory, so a pane running something else in a directory Claude once ran in would otherwise
 * resolve to Claude's log.
 */
export async function resolveWithoutSession(opts: {
  source: TranscriptSource;
  /** herdr's `pane.process_info` → the pane's foreground pid and cwd. */
  paneProcess: (paneId: string) => Promise<{ pid: number; cwd: string } | null>;
  /** The process's start time in epoch ms; null where the platform can't say. */
  startedAt: (pid: number) => Promise<number | null>;
  paneId: string;
  /** The pane's cwd, as the fallback when the process route can't answer. */
  cwd: string;
}): Promise<string | null> {
  try {
    const proc = await opts.paneProcess(opts.paneId);
    const startedAt = proc ? await opts.startedAt(proc.pid) : null;
    if (proc && startedAt !== null) {
      return await opts.source.resolveForProcess(proc.cwd || opts.cwd, startedAt);
    }
  } catch {
    // herdr couldn't tell us, or this platform has no /proc — fall through to the directory guess.
  }
  return opts.cwd ? opts.source.resolveByCwd(opts.cwd) : null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

interface CacheEntry {
  size: number;
  mtimeMs: number;
  complete: boolean;
  entries: TranscriptEntry[];
}

/**
 * Reads + caches parsed transcripts. The cost that matters is the repeat visit, not the first — a
 * parse is reused until the log's size or mtime moves.
 *
 * This route is no longer strictly on-demand: the reading view follows a live pane with `after` at
 * the pane poll's cadence. That is affordable because the answer is a handful of turns and the parse
 * is cached — but the READ is not: `load()` pulls the whole file every call, so an idle agent with a
 * large log still costs one re-read per tick.
 *
 * ponytail: whole-file re-read per call. Measured elsewhere in this repo at 10–23 ms for a typical
 * log and 110 ms for an 18 MB one — fine for one open pane on loopback, not fine as a pattern. If a
 * follower ever needs more than that: stat before load and reuse the cache when size/mtime are
 * unchanged, then read only the appended bytes (the parse is already line-at-a-time).
 */
export class TranscriptStore {
  private readonly cache = new Map<string, CacheEntry>();

  /** Public so a caller holding a path from {@link resolveWithoutSession} can page it via {@link pageAt}. */
  constructor(readonly source: TranscriptSource) {}

  /** Null when this session has no log on disk (never started, or a non-Claude agent). */
  async page(
    sessionId: string,
    opts: { limit: number; before?: string; after?: string },
  ): Promise<Omit<TranscriptPage, "paneId"> | null> {
    const path = await this.source.resolve(sessionId);
    if (path === null) return null;
    return this.pageAt(path, opts);
  }

  /**
   * Page a log by absolute path — for a pane whose session id herdr never reported, where the path
   * came from {@link resolveWithoutSession} rather than from a uuid. Same cache (keyed by path), so
   * the two entry points share a parse.
   */
  async pageAt(
    path: string,
    opts: { limit: number; before?: string; after?: string },
  ): Promise<Omit<TranscriptPage, "paneId"> | null> {
    const { text, complete, size, mtimeMs } = await this.source.load(path);
    const cached = this.cache.get(path);
    let entries: TranscriptEntry[];
    if (cached && cached.size === size && cached.mtimeMs === mtimeMs) {
      entries = cached.entries;
    } else {
      entries = parseTranscript(text);
      this.cache.set(path, { size, mtimeMs, complete, entries });
      if (this.cache.size > CACHE_MAX) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
    }

    const { window, hasMore } = pageEntries(entries, opts);
    return {
      entries: window,
      // A clipped file always has more behind it, even at the window's start.
      hasMore: hasMore || (!complete && window.length > 0 && window[0] === entries[0]),
      total: entries.length,
      fileTruncated: !complete,
      // Not cached alongside `entries`: cheap (one more pass over text already in hand), and its
      // whole point is to reflect the tail of the log at THIS instant, not whenever it last changed.
      queued: pendingQueue(text),
    };
  }
}

// ── context telemetry ─────────────────────────────────────────────────────────
//
// The board's context gauge is an extension of THIS file rather than a new subsystem: the path
// resolution, the tail read and the JSONL walk already exist here, and the number we need is one
// field the parser above deliberately drops. That is the whole reason this lives in transcript.ts.
//
// VERIFIED against the installed Claude Code (2026-07-28): every `assistant` row carries
// `message.usage` with `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` and
// `output_tokens`. The first three are what occupies the context window on the NEXT turn — the
// output isn't in the window until it is sent back, and by then it shows up inside the cache read.
// So the gauge is the sum of those three on the newest non-sidechain assistant row.

/** Context occupancy read off a transcript's newest assistant turn. */
export interface ContextUsage {
  /** input + cache_creation + cache_read on the newest assistant turn. */
  tokens: number;
  /** That turn's output tokens — informational; NOT counted in {@link tokens}. */
  outputTokens: number;
}

interface RawUsage {
  input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  output_tokens?: unknown;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

/**
 * Context occupancy from a Claude session log, or null when the log carries none (a fresh session,
 * a non-Claude agent, a tail window that clipped every assistant row).
 *
 * Two filters matter and neither is optional:
 *  - **sidechains are skipped.** Subagent turns are a different conversation with its own small
 *    context; letting one be "newest" makes a 90 %-full session read as 5 %.
 *  - **the NEWEST row wins**, not the largest. `/compact` genuinely shrinks the window, and a gauge
 *    that took the max would stay pinned at the pre-compaction figure forever.
 *
 * PURE — no fs, no clock — like the rest of this file's parsing.
 */
export function latestUsage(text: string): ContextUsage | null {
  let found: ContextUsage | null = null;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let row: { type?: unknown; isSidechain?: unknown; message?: unknown };
    try {
      row = JSON.parse(line) as typeof row;
    } catch {
      continue; // partial trailing write, or the clipped first line of a tail read
    }
    if (row.type !== "assistant" || row.isSidechain === true) continue;
    const message = row.message;
    if (message === null || typeof message !== "object") continue;
    const usage = (message as { usage?: unknown }).usage as RawUsage | undefined;
    if (usage === null || typeof usage !== "object") continue;
    const tokens =
      num(usage.input_tokens) + num(usage.cache_creation_input_tokens) + num(usage.cache_read_input_tokens);
    if (tokens === 0) continue; // a usage block with nothing in it tells us nothing
    found = { tokens, outputTokens: num(usage.output_tokens) };
  }
  return found;
}
