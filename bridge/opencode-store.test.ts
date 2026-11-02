// OpenCode store: which file, both schemas, and the pane → session link. The 1.x DDL below is
// copied verbatim from a real opencode 1.15.10 `opencode-stable.db` (2026-11-02); the rows are
// synthetic but shaped like that database's (no real content in the repo).
import { describe, expect, it } from "bun:test";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";

import { findOpenCodeDb, openOpenCodeStore, resolveOpenCodeSession, type ResolveOpts } from "./opencode-store.ts";
import { pageOpenCodeHistory } from "./opencode-transcript.ts";
import { readOpenCodeUsage } from "./opencode-usage.ts";

const NOW = 1_800_000_000_000;
const now = () => NOW;

const V1_DDL = `
CREATE TABLE \`session\` (
	\`id\` text PRIMARY KEY, \`project_id\` text NOT NULL, \`parent_id\` text, \`slug\` text NOT NULL,
	\`directory\` text NOT NULL, \`title\` text NOT NULL, \`version\` text NOT NULL, \`share_url\` text,
	\`summary_additions\` integer, \`summary_deletions\` integer, \`summary_files\` integer,
	\`summary_diffs\` text, \`revert\` text, \`permission\` text, \`time_created\` integer NOT NULL,
	\`time_updated\` integer NOT NULL, \`time_compacting\` integer, \`time_archived\` integer,
	\`workspace_id\` text, \`path\` text, \`agent\` text, \`model\` text, \`cost\` real DEFAULT 0 NOT NULL,
	\`tokens_input\` integer DEFAULT 0 NOT NULL, \`tokens_output\` integer DEFAULT 0 NOT NULL,
	\`tokens_reasoning\` integer DEFAULT 0 NOT NULL, \`tokens_cache_read\` integer DEFAULT 0 NOT NULL,
	\`tokens_cache_write\` integer DEFAULT 0 NOT NULL);
CREATE TABLE \`message\` (\`id\` text PRIMARY KEY, \`session_id\` text NOT NULL,
	\`time_created\` integer NOT NULL, \`time_updated\` integer NOT NULL, \`data\` text NOT NULL);
CREATE TABLE \`part\` (\`id\` text PRIMARY KEY, \`message_id\` text NOT NULL, \`session_id\` text NOT NULL,
	\`time_created\` integer NOT NULL, \`time_updated\` integer NOT NULL, \`data\` text NOT NULL);
CREATE TABLE \`session_message\` (\`id\` text PRIMARY KEY, \`session_id\` text NOT NULL, \`type\` text NOT NULL,
	\`time_created\` integer NOT NULL, \`time_updated\` integer NOT NULL, \`data\` text NOT NULL);`;

/** A 1.x store with one session in /repo: a question, then an answer with reasoning and two tools. */
function v1Fixture(): string {
  const path = join(mkdtempSync(join(tmpdir(), "ocv1-")), "opencode-stable.db");
  const db = new Database(path);
  db.exec(V1_DDL);
  db.prepare(
    `INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated, model)
     VALUES ('ses_1', 'p', 's', '/repo', 't', '1.15.10', ?, ?, ?)`,
  ).run(NOW - 60_000, NOW - 1000, JSON.stringify({ id: "qwen", providerID: "l40s" }));
  const msg = db.prepare(`INSERT INTO message VALUES (?, 'ses_1', ?, ?, ?)`);
  const part = db.prepare(`INSERT INTO part VALUES (?, ?, 'ses_1', ?, ?, ?)`);
  msg.run("msg_01", NOW - 50_000, NOW - 50_000, JSON.stringify({ role: "user", time: { created: NOW - 50_000 } }));
  part.run("prt_01", "msg_01", NOW, NOW, JSON.stringify({ type: "text", text: "list the files please" }));
  msg.run(
    "msg_02",
    NOW - 40_000,
    NOW - 40_000,
    JSON.stringify({
      role: "assistant",
      parentID: "msg_01",
      tokens: { total: 21688, input: 7010, output: 146, reasoning: 0, cache: { write: 0, read: 14532 } },
      modelID: "qwen",
      providerID: "l40s",
    }),
  );
  part.run("prt_02", "msg_02", NOW, NOW, JSON.stringify({ type: "step-start" }));
  part.run("prt_03", "msg_02", NOW, NOW, JSON.stringify({ type: "reasoning", text: "I should run ls." }));
  part.run(
    "prt_04",
    "msg_02",
    NOW,
    NOW,
    JSON.stringify({
      type: "tool",
      tool: "bash",
      callID: "c1",
      state: { status: "completed", input: { command: "ls -A" }, output: "a.txt\nb.txt\n" },
    }),
  );
  part.run(
    "prt_05",
    "msg_02",
    NOW,
    NOW,
    JSON.stringify({
      type: "tool",
      tool: "webfetch",
      callID: "c2",
      state: { status: "error", input: { url: "https://example.invalid" }, error: "StatusCode: 401" },
    }),
  );
  part.run("prt_06", "msg_02", NOW, NOW, JSON.stringify({ type: "text", text: "Two files: a.txt, b.txt" }));
  part.run("prt_07", "msg_02", NOW, NOW, JSON.stringify({ type: "step-finish" }));
  db.close();
  return path;
}

/** A 2.x store: sessions (with their creation time) and user turns. */
function v2Fixture(
  sessions: { id: string; createdAt: number; updatedAt: number; parentId?: string }[],
  turns: Record<string, string[]> = {},
): string {
  const path = join(mkdtempSync(join(tmpdir(), "ocv2-")), "opencode.db");
  const db = new Database(path);
  db.exec(
    `CREATE TABLE session_v2 (id TEXT PRIMARY KEY, directory TEXT NOT NULL, parent_id TEXT,
      time_created INTEGER, time_updated INTEGER, model TEXT);
     CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL,
      seq INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);`,
  );
  for (const s of sessions) {
    db.prepare(`INSERT INTO session_v2 VALUES (?, '/repo', ?, ?, ?, '{}')`).run(
      s.id,
      s.parentId ?? null,
      s.createdAt,
      s.updatedAt,
    );
    (turns[s.id] ?? []).forEach((text, i) =>
      db
        .prepare(`INSERT INTO session_message VALUES (?, ?, 'user', ?, ?, ?, ?)`)
        .run(`${s.id}-${i}`, s.id, i, s.createdAt, s.createdAt, JSON.stringify({ text })),
    );
  }
  db.close();
  return path;
}

async function resolve(path: string, opts: Partial<ResolveOpts>): Promise<string | null> {
  const store = openOpenCodeStore(path)!;
  try {
    return await resolveOpenCodeSession(store, { cwd: "/repo", now, ...opts });
  } finally {
    store.db.close();
  }
}

const WELCOME = `opencode\n  Ask anything... "Fix a TODO in the codebase"\n  Build · qwen l40s\n  ~/repo:main   shift+tab agents   ctrl+p commands`;

describe("findOpenCodeDb", () => {
  it("picks the most recently written opencode*.db of the data dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "ocdir-"));
    for (const name of ["opencode.db", "opencode-stable.db", "other.db"]) writeFileSync(join(dir, name), "");
    utimesSync(join(dir, "opencode.db"), new Date(1000), new Date(1000));
    utimesSync(join(dir, "opencode-stable.db"), new Date(2000), new Date(2000));
    utimesSync(join(dir, "other.db"), new Date(9000), new Date(9000));
    expect(findOpenCodeDb(dir)).toBe(join(dir, "opencode-stable.db"));
    // A fresher WAL makes its database the live one.
    writeFileSync(join(dir, "opencode.db-wal"), "");
    utimesSync(join(dir, "opencode.db-wal"), new Date(3000), new Date(3000));
    expect(findOpenCodeDb(dir)).toBe(join(dir, "opencode.db"));
    // An explicit file is taken as is; nothing at all is null.
    expect(findOpenCodeDb(join(dir, "other.db"))).toBe(join(dir, "other.db"));
    expect(findOpenCodeDb(join(dir, "missing"))).toBeNull();
    expect(findOpenCodeDb(mkdtempSync(join(tmpdir(), "ocempty-")))).toBeNull();
  });
});

describe("opencode 1.x schema (session / message / part)", () => {
  it("reads into the same transcript as 2.x", async () => {
    const page = (await pageOpenCodeHistory(v1Fixture(), { cwd: "/repo", limit: 10, now, startedAt: 0 }))!;
    expect(page.entries.map((e) => e.role)).toEqual(["user", "assistant"]);
    expect(page.entries[0]!.parts).toEqual([{ kind: "text", text: "list the files please" }]);
    const parts = page.entries[1]!.parts;
    expect(parts.map((p) => p.kind)).toEqual(["thinking", "tool", "tool", "text"]);
    expect(parts[1]).toMatchObject({ name: "bash", result: { text: "a.txt\nb.txt\n" } });
    expect(parts[2]).toMatchObject({ name: "webfetch", result: { text: "StatusCode: 401", isError: true } });
  });

  it("feeds the gauge: newest assistant tokens and the session model", async () => {
    expect(await readOpenCodeUsage(v1Fixture(), { cwd: "/repo", now, startedAt: 0 })).toEqual({
      tokens: 7010 + 14532,
      modelId: "qwen",
      providerId: "l40s",
      sessionId: "ses_1",
    });
  });

  it("is told apart from a directory of the data dir", async () => {
    const path = v1Fixture();
    const store = openOpenCodeStore(join(path, ".."))!;
    expect(store.version).toBe(1);
    store.db.close();
  });
});

describe("pane → session", () => {
  const started = NOW - 30_000;

  it("a freshly launched opencode shows no older conversation, then its own from the first message", async () => {
    // Before the first message: the directory only holds an earlier run's session.
    const before = v2Fixture([{ id: "old", createdAt: NOW - 3_600_000, updatedAt: NOW - 60_000 }], {
      old: ["an old question"],
    });
    expect(await resolve(before, { startedAt: started, mirror: WELCOME })).toBeNull();
    // First message sent: opencode files the new session — and it is served.
    const after = v2Fixture(
      [
        { id: "old", createdAt: NOW - 3_600_000, updatedAt: NOW - 60_000 },
        { id: "new", createdAt: NOW - 5000, updatedAt: NOW - 1000 },
      ],
      { old: ["an old question"], new: ["a brand new question"] },
    );
    expect(await resolve(after, { startedAt: started })).toBe("new");
  });

  it("a resumed session is served only when herdr names it", async () => {
    const path = v2Fixture([{ id: "resumed", createdAt: NOW - 3_600_000, updatedAt: NOW - 1000 }]);
    expect(await resolve(path, { startedAt: started })).toBeNull();
    expect(await resolve(path, { startedAt: started, sessionId: "resumed" })).toBe("resumed");
    // A reported id the store does not hold falls back to the directory rule.
    expect(await resolve(path, { startedAt: started, sessionId: "ses_gone" })).toBeNull();
  });

  it("two opencode panes in one repo: each gets its own, a blank one gets nothing", async () => {
    const path = v2Fixture(
      [
        { id: "a", createdAt: NOW - 20_000, updatedAt: NOW - 2000 },
        { id: "b", createdAt: NOW - 10_000, updatedAt: NOW - 3000 },
      ],
      { a: ["refactor the billing module before the audit"], b: ["write the release notes for the spring version"] },
    );
    const shared = { startedAt: started, shared: true };
    expect(await resolve(path, { ...shared, mirror: "> refactor the billing module before the audit" })).toBe("a");
    expect(await resolve(path, { ...shared, mirror: "> write the release notes for the spring version" })).toBe("b");
    // A third pane, just launched in the same repo, on its welcome screen.
    expect(await resolve(path, { ...shared, mirror: WELCOME })).toBeNull();
    // Even when the other pane's session is the only candidate, sharing a directory demands proof.
    const one = v2Fixture([{ id: "a", createdAt: NOW - 20_000, updatedAt: NOW - 2000 }], {
      a: ["refactor the billing module before the audit"],
    });
    expect(await resolve(one, { ...shared, mirror: WELCOME })).toBeNull();
  });

  it("an unknown agent start leaves the decision to the mirror", async () => {
    const path = v2Fixture([{ id: "s", createdAt: NOW - 3_600_000, updatedAt: NOW - 1000 }], {
      s: ["summarise the quarterly report for the finance team"],
    });
    expect(await resolve(path, { startedAt: null })).toBeNull();
    expect(await resolve(path, { startedAt: null, mirror: WELCOME })).toBeNull();
    expect(
      await resolve(path, { startedAt: null, mirror: async () => "summarise the quarterly report for the finance team" }),
    ).toBe("s");
  });
});
