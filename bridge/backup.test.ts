import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BACKUPS_DIR,
  buildBackup,
  collectFiles,
  isSafeRelPath,
  parseBackup,
  restoreBackup,
  writeSafetyBackup,
  type Backup,
} from "./backup.ts";
import { handleBoardRoute } from "./board-routes.ts";
import { BoardDb } from "./db.ts";

// The backup's two halves: the state-dir walk (what gets in, how it's encoded) and the row dump —
// then the same two coming back, including the trust boundary the restore's paths cross.

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

  test("leaves earlier safety exports out, so a backup can't nest its own backups", async () => {
    const dir = await tempDir();
    await mkdir(join(dir, BACKUPS_DIR), { recursive: true });
    await writeFile(join(dir, BACKUPS_DIR, "pre-import-old.json"), "{}");
    const db = new BoardDb(":memory:");

    expect((await buildBackup(db, dir)).files).toEqual([]);
    db.close();
  });
});

describe("isSafeRelPath", () => {
  test("accepts a state-dir path and refuses everything that escapes or overwrites", () => {
    expect(isSafeRelPath("snooze.json")).toBe(true);
    expect(isSafeRelPath("uploads/shot.png")).toBe(true);

    expect(isSafeRelPath("../../.ssh/authorized_keys")).toBe(false);
    expect(isSafeRelPath("uploads/../../etc/passwd")).toBe(false);
    expect(isSafeRelPath("/etc/passwd")).toBe(false);
    expect(isSafeRelPath("uploads\\..\\evil")).toBe(false);
    expect(isSafeRelPath("bad\0.json")).toBe(false);
    expect(isSafeRelPath("board.db")).toBe(false); // restored from `db`, never from bytes
    expect(isSafeRelPath("board.db-wal")).toBe(false);
    expect(isSafeRelPath(`${BACKUPS_DIR}/pre-import.json`)).toBe(false);
    expect(isSafeRelPath("")).toBe(false);
  });
});

describe("parseBackup", () => {
  const good: Backup = {
    kind: "collie-board-backup",
    version: 1,
    exportedAt: "2026-08-05T09:41:12.000Z",
    db: { card: [{ id: "a", title: "t" }] },
    files: [{ path: "snooze.json", encoding: "utf8", content: "{}" }],
  };

  test("accepts a document this build wrote", () => {
    const parsed = parseBackup(structuredClone(good));
    expect(parsed.ok).toBe(true);
  });

  test("refuses anything that isn't one of ours", () => {
    expect(parseBackup(null)).toMatchObject({ ok: false });
    expect(parseBackup({ ...good, kind: "something-else" })).toMatchObject({ ok: false });
    expect(parseBackup({ ...good, db: [] })).toMatchObject({ ok: false });
    expect(parseBackup({ ...good, files: {} })).toMatchObject({ ok: false });
  });

  test("refuses a backup newer than this build rather than restore half of it", () => {
    expect(parseBackup({ ...good, version: 99 })).toMatchObject({
      ok: false,
      error: expect.stringContaining("newer"),
    });
  });

  test("refuses a row carrying something SQLite can't bind", () => {
    expect(parseBackup({ ...good, db: { card: [{ id: { nested: true } }] } })).toMatchObject({
      ok: false,
    });
  });

  test("refuses a path that would escape the state dir", () => {
    const evil = { ...good, files: [{ ...good.files[0]!, path: "../../evil.json" }] };
    expect(parseBackup(evil)).toMatchObject({ ok: false, error: expect.stringContaining("unsafe") });
  });
});

describe("restore", () => {
  test("puts the board and the files back, and writes a safety export first", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "snooze.json"), '{"until":1}');
    const db = new BoardDb(":memory:");
    const before = db.createCard({ title: "before the import" });
    const backup = await buildBackup(db, dir);

    // Move on: a different card, a different snooze.
    db.deleteCard(before.id);
    db.createCard({ title: "after" });
    await writeFile(join(dir, "snooze.json"), '{"until":999}');

    const safety = await writeSafetyBackup(db, dir);
    const result = await restoreBackup(db, dir, backup);

    expect(db.listCards().map((c) => c.title)).toEqual(["before the import"]);
    expect(await readFile(join(dir, "snooze.json"), "utf8")).toBe('{"until":1}');
    expect(result.files).toBe(1);
    expect(result.tables.card).toBe(1);

    // The net: the state as it was a moment before the import, on disk, in the state dir.
    expect(safety.startsWith(join(dir, BACKUPS_DIR))).toBe(true);
    const netted = JSON.parse(await readFile(safety, "utf8")) as Backup;
    expect((netted.db.card as { title: string }[]).map((c) => c.title)).toEqual(["after"]);
    db.close();
  });

  test("writes through a planted symlink's place, not through the symlink", async () => {
    const dir = await tempDir();
    const outside = join(await tempDir(), "outside.json");
    await writeFile(outside, "untouched");
    await symlink(outside, join(dir, "notify-prefs.json"));
    const db = new BoardDb(":memory:");

    await restoreBackup(db, dir, {
      kind: "collie-board-backup",
      version: 1,
      exportedAt: "2026-08-05T09:41:12.000Z",
      db: {},
      files: [{ path: "notify-prefs.json", encoding: "utf8", content: "restored" }],
    });
    db.close();

    expect(await readFile(outside, "utf8")).toBe("untouched");
    expect(await readFile(join(dir, "notify-prefs.json"), "utf8")).toBe("restored");
  });

  test("a table missing from the backup is left alone, not emptied", async () => {
    const dir = await tempDir();
    const db = new BoardDb(":memory:");
    db.setRepoHidden("/home/me/git/thing", true);
    db.createCard({ title: "gone after the restore" });

    db.restore({ card: [] });

    expect(db.listCards()).toEqual([]);
    expect(db.dump().repo_pref).toHaveLength(1);
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("rolls back whole when a row breaks a constraint", async () => {
    const db = new BoardDb(":memory:");
    const card = db.createCard({ title: "keep me" });

    expect(() =>
      // A session whose card_id points nowhere — deferred FKs still refuse it at COMMIT.
      db.restore({ session: [{ id: "s1", card_id: "no-such-card", started_at: 1 }] }),
    ).toThrow();
    expect(db.listCards().map((c) => c.id)).toEqual([card.id]);
    db.close();
  });
});

describe("POST /api/backup/restore", () => {
  // Just enough BoardContext for the two backup routes — they touch db, cfg.stateDir and audit.
  function routeCtx(store: BoardDb, stateDir: string) {
    return {
      db: store,
      cfg: { stateDir },
      audit: { record() {} },
      session: "default",
      guard: () => null,
      device: null,
      json: (data: unknown, status?: number) =>
        new Response(JSON.stringify(data), {
          status: status ?? 200,
          headers: { "content-type": "application/json" },
        }),
      text: (body: string, status: number) => new Response(body, { status }),
    } as never;
  }

  const post = (body: unknown, ctx: never) =>
    handleBoardRoute(
      "/api/backup/restore",
      new Request("http://x/api/backup/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      ctx,
    );

  test("nets the current state before it writes, and says a restart is due", async () => {
    const dir = await tempDir();
    const db = new BoardDb(":memory:");
    db.createCard({ title: "what's on the board now" });
    const backup: Backup = {
      kind: "collie-board-backup",
      version: 1,
      exportedAt: "2026-08-05T09:41:12.000Z",
      db: { card: [{ id: "restored-1", title: "from the file", status: "backlog", position: 0, created_at: 1, updated_at: 1 }] },
      files: [{ path: "snooze.json", encoding: "utf8", content: '{"until":7}' }],
    };

    const res = await post(backup, routeCtx(db, dir));
    const body = (await res!.json()) as { ok: boolean; safetyBackup: string; restartRequired: boolean };

    expect(res!.status).toBe(200);
    expect(body).toMatchObject({ ok: true, restartRequired: true });
    expect(db.listCards().map((c) => c.title)).toEqual(["from the file"]);
    // The net holds what the board looked like a moment earlier — the whole point of the ordering.
    const netted = JSON.parse(await readFile(body.safetyBackup, "utf8")) as Backup;
    expect((netted.db.card as { title: string }[]).map((c) => c.title)).toEqual([
      "what's on the board now",
    ]);
    db.close();
  });

  test("refuses a document that isn't a backup without touching anything", async () => {
    const dir = await tempDir();
    const db = new BoardDb(":memory:");
    const card = db.createCard({ title: "still here afterwards" });

    const res = await post({ kind: "definitely-not" }, routeCtx(db, dir));

    expect(res!.status).toBe(400);
    expect(db.listCards().map((c) => c.id)).toEqual([card.id]);
    // Refused before the safety export, so not even that ran.
    expect(await readdir(dir)).toEqual([]);
    db.close();
  });
});

describe("safety export", () => {
  test("names each one after its instant, so imports don't overwrite each other's net", async () => {
    const dir = await tempDir();
    const db = new BoardDb(":memory:");

    await writeSafetyBackup(db, dir, 1_700_000_000_000);
    await writeSafetyBackup(db, dir, 1_700_000_060_000);
    db.close();

    expect((await readdir(join(dir, BACKUPS_DIR))).sort()).toEqual([
      "pre-import-2023-11-14T22-13-20-000Z.json",
      "pre-import-2023-11-14T22-14-20-000Z.json",
    ]);
  });
});
