// OpenCode transcript reader against a throwaway sqlite file: the pane → session link
// is by directory with the single-live-candidate rule (like the gauge), and messages
// parse into the same TranscriptEntry shape the Claude reader produces.
import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";

import { OPENCODE_LIVE_MS } from "./opencode-usage.ts";
import {
  pageOpenCodeHistory,
  parseOpenCodeMessages,
  resolveOpenCodeSession,
} from "./opencode-transcript.ts";

const NOW = 1_800_000_000_000;

function userData(text: string): string {
  return JSON.stringify({ time: { created: NOW }, text, files: [], agents: [] });
}

function assistantData(content: unknown[]): string {
  return JSON.stringify({
    time: { created: NOW },
    agent: "build",
    model: { id: "m", providerID: "opencode" },
    content,
    finish: "stop",
    tokens: { input: 10, output: 5, cache: { read: 0, write: 0 } },
  });
}

const textBlock = (text: string) => ({ type: "text", text });
const toolBlock = (name: string, input: unknown, result: string, status = "completed") => ({
  type: "tool",
  id: `call-${name}`,
  name,
  state: { status, input, content: [{ type: "text", text: result }] },
});

/** A minimal opencode.db: sessions plus their messages. Times are ms-epoch like the real store. */
function fixture(
  sessions: { id: string; directory: string; updatedAgoMs: number }[],
  messages: Record<string, { id: string; type: string; seq: number; data: string }[]>,
): string {
  const path = join(mkdtempSync(join(tmpdir(), "octran-")), "opencode.db");
  const db = new Database(path);
  db.exec(
    `CREATE TABLE session_v2 (id TEXT PRIMARY KEY, directory TEXT NOT NULL,
      time_created INTEGER, time_updated INTEGER, model TEXT);
     CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
      type TEXT NOT NULL, seq INTEGER NOT NULL,
      time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);`,
  );
  const addSession = db.prepare(
    `INSERT INTO session_v2 (id, directory, time_created, time_updated, model) VALUES (?, ?, ?, ?, ?)`,
  );
  const addMessage = db.prepare(
    `INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const s of sessions) {
    addSession.run(s.id, s.directory, NOW - s.updatedAgoMs - 1000, NOW - s.updatedAgoMs, "{}");
    for (const m of messages[s.id] ?? []) {
      addMessage.run(m.id, s.id, m.type, m.seq, NOW, NOW, m.data);
    }
  }
  db.close();
  return path;
}

const msg = (id: string, type: string, seq: number, data: string) => ({ id, type, seq, data });

describe("parseOpenCodeMessages", () => {
  it("turns user text and assistant text into turns", () => {
    const entries = parseOpenCodeMessages([
      { id: "u1", type: "user", time_created: NOW, data: userData("hello") },
      { id: "a1", type: "assistant", time_created: NOW, data: assistantData([textBlock("hi there")]) },
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ uuid: "u1", role: "user" });
    expect(entries[0]!.parts).toEqual([{ kind: "text", text: "hello" }]);
    expect(entries[1]).toMatchObject({ uuid: "a1", role: "assistant" });
    expect(entries[1]!.parts).toEqual([{ kind: "text", text: "hi there" }]);
  });

  it("folds a tool call and its result into one part, flagging errors", () => {
    const entries = parseOpenCodeMessages([
      {
        id: "a1",
        type: "assistant",
        time_created: NOW,
        data: assistantData([
          textBlock("let me look"),
          toolBlock("read", { file_path: "/repo/a.ts" }, "const x = 1;"),
          toolBlock("edit", { file_path: "/repo/a.ts" }, "oldString not found", "error"),
        ]),
      },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.parts).toEqual([
      { kind: "text", text: "let me look" },
      {
        kind: "tool",
        name: "read",
        summary: "/repo/a.ts",
        result: { text: "const x = 1;" },
      },
      {
        kind: "tool",
        name: "edit",
        summary: "/repo/a.ts",
        result: { text: "oldString not found", isError: true },
      },
    ]);
  });

  it("skips empty reasoning, blank text and unknown rows", () => {
    const entries = parseOpenCodeMessages([
      {
        id: "a1",
        type: "assistant",
        time_created: NOW,
        data: assistantData([
          { type: "reasoning", text: "" },
          { type: "text", text: "   " },
          { type: "text", text: "real" },
        ]),
      },
      { id: "u1", type: "user", time_created: NOW, data: userData("   ") },
      { id: "x1", type: "system", time_created: NOW, data: "{}" },
      { id: "bad", type: "assistant", time_created: NOW, data: "not json" },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.parts).toEqual([{ kind: "text", text: "real" }]);
  });
});

describe("resolveOpenCodeSession", () => {
  const now = () => NOW;

  it("resolves the newest session for the directory", () => {
    const path = fixture(
      [
        { id: "old", directory: "/repo", updatedAgoMs: OPENCODE_LIVE_MS + 5000 },
        { id: "new", directory: "/repo", updatedAgoMs: OPENCODE_LIVE_MS + 1000 },
      ],
      {},
    );
    expect(resolveOpenCodeSession(path, "/repo", now)).toBe("new");
    expect(resolveOpenCodeSession(path, "/elsewhere", now)).toBeNull();
    expect(resolveOpenCodeSession("/nonexistent/opencode.db", "/repo", now)).toBeNull();
  });

  it("refuses when two sessions in one directory are both live", () => {
    const path = fixture(
      [
        { id: "s1", directory: "/repo", updatedAgoMs: 1000 },
        { id: "s2", directory: "/repo", updatedAgoMs: 2000 },
      ],
      {},
    );
    expect(resolveOpenCodeSession(path, "/repo", now)).toBeNull();
  });

  it("names the live session whose prose the mirror is showing", () => {
    const path = fixture(
      [
        { id: "s1", directory: "/repo", updatedAgoMs: 1000 },
        { id: "s2", directory: "/repo", updatedAgoMs: 2000 },
      ],
      {
        s1: [msg("u1", "user", 1, userData("summarise the quarterly report for finance"))],
        s2: [msg("u2", "user", 1, userData("rewrite the onboarding guide for newcomers"))],
      },
    );
    // Without the mirror there is nothing to decide on.
    expect(resolveOpenCodeSession(path, "/repo", now)).toBeNull();
    // With it, the outright winner is served — even though both sessions are live.
    expect(
      resolveOpenCodeSession(path, "/repo", now, "summarise the quarterly report for finance"),
    ).toBe("s1");
    expect(
      resolveOpenCodeSession(path, "/repo", now, "rewrite the onboarding guide for newcomers"),
    ).toBe("s2");
  });

  it("still refuses on a tie — guessing is how the wrong transcript gets served", () => {
    const path = fixture(
      [
        { id: "s1", directory: "/repo", updatedAgoMs: 1000 },
        { id: "s2", directory: "/repo", updatedAgoMs: 2000 },
      ],
      {
        s1: [msg("u1", "user", 1, userData("hello world, this is a long greeting"))],
        s2: [msg("u2", "user", 1, userData("hello world, this is a long greeting"))],
      },
    );
    expect(
      resolveOpenCodeSession(path, "/repo", now, "hello world, this is a long greeting"),
    ).toBeNull();
  });

  it("names a quiet session when the mirror shows it while siblings keep writing", () => {
    const path = fixture(
      [
        { id: "loud1", directory: "/repo", updatedAgoMs: 1000 },
        { id: "loud2", directory: "/repo", updatedAgoMs: 2000 },
        // Quieter than the live window: the clock alone would never serve it.
        { id: "quiet", directory: "/repo", updatedAgoMs: OPENCODE_LIVE_MS + 60_000 },
      ],
      {
        loud1: [msg("u1", "user", 1, userData("summarise the quarterly report for finance"))],
        loud2: [msg("u2", "user", 1, userData("rewrite the onboarding guide for newcomers"))],
        quiet: [msg("u3", "user", 1, userData("audit the access logs for intrusions tonight"))],
      },
    );
    expect(resolveOpenCodeSession(path, "/repo", now)).toBeNull();
    expect(
      resolveOpenCodeSession(path, "/repo", now, "audit the access logs for intrusions tonight"),
    ).toBe("quiet");
  });
});

describe("pageOpenCodeHistory", () => {
  const now = () => NOW;

  function db() {
    return fixture(
      [{ id: "ses_abc", directory: "/repo", updatedAgoMs: 1000 }],
      {
        ses_abc: [
          msg("u1", "user", 1, userData("first question")),
          msg("a1", "assistant", 2, assistantData([textBlock("first answer")])),
          msg("u2", "user", 3, userData("second question")),
          msg("a2", "assistant", 4, assistantData([textBlock("second answer")])),
        ],
      },
    );
  }

  it("serves the conversation oldest-first with paging cursors", async () => {
    const path = db();
    const full = (await pageOpenCodeHistory(path, { cwd: "/repo", limit: 10, now }))!;
    expect(full.entries.map((e) => e.uuid)).toEqual(["u1", "a1", "u2", "a2"]);
    expect(full.total).toBe(4);
    expect(full.hasMore).toBe(false);
    expect(full.fileTruncated).toBe(false);
    expect(full.queued).toEqual([]);

    const tail = (await pageOpenCodeHistory(path, { cwd: "/repo", limit: 10, after: "a1", now }))!;
    expect(tail.entries.map((e) => e.uuid)).toEqual(["u2", "a2"]);
    expect(tail.hasMore).toBe(true); // older turns exist before the window

    const older = (await pageOpenCodeHistory(path, { cwd: "/repo", limit: 1, before: "u2", now }))!;
    expect(older.entries.map((e) => e.uuid)).toEqual(["a1"]);
    expect(older.hasMore).toBe(true);
  });

  it("honours a reported session id directly", async () => {
    const path = db();
    const page = (await pageOpenCodeHistory(path, {
      sessionId: "ses_abc",
      cwd: "/elsewhere",
      limit: 10,
      now,
    }))!;
    expect(page.total).toBe(4);
  });

  it("reads nothing when the directory is ambiguous or unknown", async () => {
    const ambiguous = fixture(
      [
        { id: "s1", directory: "/repo", updatedAgoMs: 1000 },
        { id: "s2", directory: "/repo", updatedAgoMs: 2000 },
      ],
      { s1: [msg("u1", "user", 1, userData("hi"))] },
    );
    expect(await pageOpenCodeHistory(ambiguous, { cwd: "/repo", limit: 10, now })).toBeNull();
    expect(await pageOpenCodeHistory(db(), { cwd: "/elsewhere", limit: 10, now })).toBeNull();
    expect(
      await pageOpenCodeHistory("/nonexistent/opencode.db", { cwd: "/repo", limit: 10, now }),
    ).toBeNull();
  });
});
