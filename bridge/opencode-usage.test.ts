// OpenCode session telemetry against a throwaway sqlite file: the pane → session link is by
// directory with a single-live-candidate rule, and occupancy is the newest assistant message's
// tokens — verified against the live db's shape, pinned here in a fixture.
import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";

import {
  OPENCODE_LIVE_MS,
  defaultOpenCodeDbPath,
  readOpenCodeUsage,
} from "./opencode-usage.ts";

function msg(seq: number, tokens: unknown): [string, number, string] {
  return ["assistant", seq, JSON.stringify({ tokens })];
}

/** A minimal opencode.db: sessions plus their messages. Times are ms-epoch like the real store. */
function fixture(
  sessions: {
    id: string;
    directory: string;
    updatedAgoMs: number;
    modelText?: string;
  }[],
  messages: Record<string, [string, number, string][]>,
  now: number,
): string {
  const path = join(mkdtempSync(join(tmpdir(), "ocdb-")), "opencode.db");
  const db = new Database(path);
  db.exec(
    `CREATE TABLE session_v2 (id TEXT PRIMARY KEY, directory TEXT NOT NULL,
      parent_id TEXT, time_created INTEGER, time_updated INTEGER, model TEXT);
     CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
      type TEXT NOT NULL, seq INTEGER NOT NULL, time_created INTEGER DEFAULT 0, data TEXT NOT NULL);`,
  );
  const addSession = db.prepare(
    `INSERT INTO session_v2 (id, directory, time_created, time_updated, model)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const addMessage = db.prepare(
    `INSERT INTO session_message (id, session_id, type, seq, data) VALUES (?, ?, ?, ?, ?)`,
  );
  for (const s of sessions) {
    addSession.run(
      s.id,
      s.directory,
      now - s.updatedAgoMs - 1000,
      now - s.updatedAgoMs,
      s.modelText ?? JSON.stringify({ id: "m", providerID: "opencode" }),
    );
    for (const [type, seq, data] of messages[s.id] ?? []) {
      addMessage.run(`${s.id}-${seq}`, s.id, type, seq, data);
    }
  }
  db.close();
  return path;
}

const TOKENS = {
  input: 6000,
  output: 27,
  reasoning: 26,
  cache: { read: 3456, write: 100 },
};

describe("readOpenCodeUsage", () => {
  const now = () => 1_800_000_000_000;

  it("reads the newest assistant message's tokens plus the session model", async () => {
    const path = fixture(
      [{ id: "s1", directory: "/repo", updatedAgoMs: 1000 }],
      {
        s1: [
          msg(1, { input: 100, output: 5, cache: { read: 0, write: 0 } }),
          msg(2, TOKENS),
          ["user", 3, JSON.stringify({ text: "hi" })],
        ],
      },
      now(),
    );
    // input + cache.read + cache.write of the NEWEST assistant message; output/reasoning excluded.
    expect(
      await readOpenCodeUsage(path, { cwd: "/repo", now, startedAt: 0 }),
    ).toEqual({
      tokens: 6000 + 3456 + 100,
      modelId: "m",
      providerId: "opencode",
      sessionId: "s1",
    });
  });

  it("returns null for a missing db, an unknown directory, or no tokened message yet", async () => {
    expect(
      await readOpenCodeUsage("/nonexistent/opencode.db", {
        cwd: "/repo",
        now,
        startedAt: 0,
      }),
    ).toBeNull();
    const path = fixture(
      [{ id: "s1", directory: "/repo", updatedAgoMs: 1000 }],
      { s1: [["user", 1, JSON.stringify({ text: "hi" })]] },
      now(),
    );
    expect(
      await readOpenCodeUsage(path, { cwd: "/elsewhere", now, startedAt: 0 }),
    ).toBeNull();
    expect(
      await readOpenCodeUsage(path, { cwd: "/repo", now, startedAt: 0 }),
    ).toBeNull();
  });

  it("refuses when two sessions in one directory are both live", async () => {
    const path = fixture(
      [
        { id: "s1", directory: "/repo", updatedAgoMs: 1000 },
        { id: "s2", directory: "/repo", updatedAgoMs: 2000 },
      ],
      { s1: [msg(1, TOKENS)], s2: [msg(1, TOKENS)] },
      now(),
    );
    expect(
      await readOpenCodeUsage(path, { cwd: "/repo", now, startedAt: 0 }),
    ).toBeNull();
  });

  it("picks the live session when the other one is stale", async () => {
    const path = fixture(
      [
        {
          id: "old",
          directory: "/repo",
          updatedAgoMs: OPENCODE_LIVE_MS + 1000,
        },
        { id: "live", directory: "/repo", updatedAgoMs: 1000 },
      ],
      { old: [msg(1, TOKENS)], live: [msg(1, TOKENS)] },
      now(),
    );
    expect(
      (await readOpenCodeUsage(path, { cwd: "/repo", now, startedAt: 0 }))
        ?.sessionId,
    ).toBe("live");
  });

  it("skips unparsable messages and tolerates a missing model", async () => {
    const path = fixture(
      [
        {
          id: "s1",
          directory: "/repo",
          updatedAgoMs: 1000,
          modelText: "garbage",
        },
      ],
      { s1: [["assistant", 2, "not json"], msg(1, TOKENS)] },
      now(),
    );
    const seen = (await readOpenCodeUsage(path, {
      cwd: "/repo",
      now,
      startedAt: 0,
    }))!;
    expect(seen.tokens).toBe(6000 + 3456 + 100);
    expect(seen.modelId).toBeNull();
    expect(seen.providerId).toBeNull();
  });

  it("follows the session herdr reports, and never one older than the agent", async () => {
    const path = fixture(
      [{ id: "s1", directory: "/repo", updatedAgoMs: 1000 }],
      { s1: [msg(1, TOKENS)] },
      now(),
    );
    // Created before the agent in the pane started: an earlier run's conversation, not this one.
    expect(
      await readOpenCodeUsage(path, { cwd: "/repo", now, startedAt: now() + 10_000 }),
    ).toBeNull();
    // Unless herdr names it — a resumed session.
    expect(
      (
        await readOpenCodeUsage(path, {
          sessionId: "s1",
          cwd: "/repo",
          now,
          startedAt: now(),
        })
      )?.sessionId,
    ).toBe("s1");
  });
});

describe("defaultOpenCodeDbPath", () => {
  it("is opencode's data dir, XDG_DATA_HOME first", () => {
    expect(defaultOpenCodeDbPath("linux", {}, "/home/u")).toBe(
      "/home/u/.local/share/opencode",
    );
    expect(
      defaultOpenCodeDbPath("linux", { XDG_DATA_HOME: "/data" }, "/home/u"),
    ).toBe("/data/opencode");
  });
});
