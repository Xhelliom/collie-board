import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildBackup, collectFiles } from "./backup.ts";
import { BoardDb } from "./db.ts";

// The backup's two halves: the state-dir walk (what gets in, how it's encoded) and the row dump.

const dirs: string[] = [];
async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "collie-backup-"));
  dirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe("collectFiles", () => {
  test("walks the state dir, keeps text as text and binary as base64, skips the database", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "snooze.json"), '{"until":42}');
    await writeFile(join(dir, "audit.log"), '{"action":"reply"}\n');
    await writeFile(join(dir, "board.db"), "SQLite format 3\0");
    await writeFile(join(dir, "board.db-wal"), "wal");
    await mkdir(join(dir, "uploads"), { recursive: true });
    await writeFile(join(dir, "uploads", "shot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const files = await collectFiles(dir);
    const paths = files.map((f) => f.path);

    expect(paths).toEqual(["audit.log", "snooze.json", "uploads/shot.png"]);
    expect(files[1]).toEqual({ path: "snooze.json", encoding: "utf8", content: '{"until":42}' });
    expect(files[2]!.encoding).toBe("base64");
    expect(Buffer.from(files[2]!.content, "base64")).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  test("a state dir that doesn't exist yet is empty, not an error", async () => {
    expect(await collectFiles(join(await tempDir(), "nope"))).toEqual([]);
  });
});

describe("buildBackup", () => {
  test("carries every table and the state dir's files", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "notify-prefs.json"), "{}");
    const db = new BoardDb(":memory:");
    const card = db.createCard({ title: "Back it up" });

    const backup = await buildBackup(db, dir, 1_700_000_000_000);
    db.close();

    expect(backup.kind).toBe("collie-board-backup");
    expect(backup.exportedAt).toBe("2023-11-14T22:13:20.000Z");
    // Every table, not just the ones with rows — a restore needs to know `repo_pref` was empty.
    expect(Object.keys(backup.db).sort()).toEqual(["card", "event", "repo_pref", "review", "session"]);
    expect(backup.db.card).toHaveLength(1);
    expect((backup.db.card![0] as { id: string; title: string }).title).toBe("Back it up");
    expect((backup.db.card![0] as { id: string }).id).toBe(card.id);
    expect(backup.files.map((f) => f.path)).toEqual(["notify-prefs.json"]);
  });
});
