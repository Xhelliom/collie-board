import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { buildBackup } from "./backup.ts";
import { BoardDb } from "./db.ts";

// The backup is only as good as its coverage, and a gap is found the day you restore. This pins the
// two inventories against it so a new persisted source cannot be forgotten silently:
//   1. every table board.db really holds is in `backup.db`;
//   2. every bridge module that writes data is either listed below with where its data lands (and
//      that place is in the backup), or the suite fails naming the module.

/** Modules that write, and why the backup already covers (or may ignore) what they write. */
const PERSISTENCE: Record<string, string> = {
  "audit.ts": "state dir file (audit.log) — walked by collectFiles",
  "backup.ts": "the backup itself: safety exports under backups/, restored files",
  "context-window.ts": "state dir file — walked by collectFiles",
  "db.ts": "board.db — row dump via dump()",
  "git.ts": "a repo's .git/info/exclude — the operator's repo, not Collie state",
  "notify-prefs.ts": "state dir file — walked by collectFiles",
  "opencode-transcript.ts": "reads opencode's own database, read-only",
  "opencode-usage.ts": "reads opencode's own database, read-only",
  "push.ts": "state dir file — walked by collectFiles",
  "server.ts": "uploads/ under the state dir — walked by collectFiles",
  "snooze.ts": "state dir file — walked by collectFiles",
  "update.ts": "state dir file — walked by collectFiles",
};

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

test("every table of board.db is in the backup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "collie-coverage-"));
  dirs.push(dir);
  const path = join(dir, "board.db");
  const db = new BoardDb(path);
  const real = new Database(path, { readonly: true });
  const tables = real
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .all()
    .map((t) => t.name);
  real.close();

  const backed = Object.keys((await buildBackup(db, dir)).db);
  const missing = tables.filter((t) => !backed.includes(t));
  expect(missing, `table(s) in board.db but not in the backup: ${missing.join(", ")}`).toEqual([]);
});

test("every file a state-dir writer creates is in the backup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "collie-coverage-"));
  dirs.push(dir);
  const names = ["audit.log", "notify-prefs.json", "push-subscriptions.json", "snooze.json", "update-state.json"];
  for (const n of names) await writeFile(join(dir, n), "{}");
  const backed = (await buildBackup(new BoardDb(join(dir, "board.db")), dir)).files.map((f) => f.path);
  const missing = names.filter((n) => !backed.includes(n));
  expect(missing, `file(s) written to the state dir but not in the backup: ${missing.join(", ")}`).toEqual([]);
});

test("every bridge module that persists data is accounted for", () => {
  const writes = /new Database\(|writeFile(Sync)?\(|appendFile(Sync)?\(|Bun\.write\(/;
  const writers = readdirSync(import.meta.dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .filter((f) => writes.test(readFileSync(join(import.meta.dir, f), "utf8")))
    .map((f) => basename(f));
  const unknown = writers.filter((f) => !(f in PERSISTENCE));
  expect(
    unknown,
    `bridge module(s) persisting data the backup may not cover: ${unknown.join(", ")} — ` +
      `make sure their data is in the backup, then list them in PERSISTENCE (bridge/backup-coverage.test.ts)`,
  ).toEqual([]);
});
