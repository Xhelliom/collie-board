import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { BoardDb } from "./db.ts";

// One-file backup of everything Collie Board persists, and the restore that reads it back.
//
// FORMAT: a single JSON document (see README → "Back up your data"). Two halves, because the state
// dir has two kinds of thing in it:
//   - `db`   — every row of every table in board.db, keyed by table name. NOT the file's bytes: the
//              database is open with WAL, so copying it mid-write would capture a torn page and
//              leave the tail in the -wal sibling. A row dump is consistent, readable and survives
//              a schema that grows a column.
//   - `files` — everything else under the state dir, walked recursively: notify-prefs.json,
//              snooze.json, push-subscriptions.json, update-state.json, audit.log, the copilot's
//              scratch and the uploads. Enumerating nothing by name is the point — a state file
//              added later lands in the backup without anyone remembering to list it here.
// The client adds a third half (`client`: the browser's `collie:` prefs) before saving the file;
// those never reach the bridge. JSON, not a tarball: no dependency, no shelling out to tar, and a
// backup you can read with `jq` when you need to know what was in it.
//
// RESTORING is the dangerous direction, so it is the paranoid one: the document is validated whole
// before anything is touched, the CURRENT state is exported to `backups/` first (no filet, no
// import), and every path in `files` is checked against {@link isSafeRelPath} — a backup is
// operator-supplied input that gets written straight into a 0700 directory.

export const BACKUP_KIND = "collie-board-backup";
export const BACKUP_VERSION = 1;

/** Rebuilt from the row dump — their bytes are skipped on the way out and refused on the way in. */
const DB_FILES = /^board\.db(-wal|-shm)?$/;

/** Kept as text so the backup stays greppable; everything else (uploads) rides as base64. */
const TEXT_FILES = /\.(json|jsonl|log|txt|md|toml)$/i;

/**
 * Where a pre-import safety export lands, under the state dir. Excluded from the walk in both
 * directions — a backup of the backups doubles in size every time you take one.
 */
export const BACKUPS_DIR = "backups";

export interface BackupFile {
  /** Path relative to the state dir, always `/`-separated. */
  path: string;
  encoding: "utf8" | "base64";
  content: string;
}

export interface Backup {
  kind: typeof BACKUP_KIND;
  version: number;
  exportedAt: string;
  db: Record<string, unknown[]>;
  files: BackupFile[];
}

/**
 * Read every regular file under `dir`, recursively, as {@link BackupFile}s sorted by path.
 *
 * Best-effort like the uploads sweep: an unreadable directory or a file that vanishes mid-walk is
 * skipped, never fatal — a backup that misses one scratch file beats a backup that 500s. Symlinks
 * are skipped too (`isFile()` is false for them), which also keeps the walk inside the state dir.
 */
export async function collectFiles(dir: string, prefix = ""): Promise<BackupFile[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: BackupFile[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!prefix && entry.name === BACKUPS_DIR) continue;
      out.push(...(await collectFiles(join(dir, entry.name), path)));
      continue;
    }
    if (!entry.isFile() || DB_FILES.test(entry.name)) continue;
    try {
      const bytes = await readFile(join(dir, entry.name));
      const encoding = TEXT_FILES.test(entry.name) ? "utf8" : "base64";
      out.push({ path, encoding, content: bytes.toString(encoding) });
    } catch {
      /* vanished or unreadable between readdir and read — skip */
    }
  }
  return out;
}

/** The whole durable state, ready to be serialised. `now` is injected so tests are deterministic. */
export async function buildBackup(
  db: BoardDb,
  stateDir: string,
  now: number = Date.now(),
): Promise<Backup> {
  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: new Date(now).toISOString(),
    db: db.dump(),
    files: await collectFiles(stateDir),
  };
}

// ── restore ──────────────────────────────────────────────────────────────────

/**
 * Whether a `files[].path` from an untrusted document may be written under the state dir.
 *
 * This is the trust boundary: the document is a file the operator picked on their phone, and its
 * paths are joined onto a directory holding push keys and card specs. Refused: absolute paths,
 * anything with a `..` or `.` segment, backslashes and NULs (a Windows-flavoured escape), the
 * database files (they are restored from `db`, not from bytes), and the safety-backup directory.
 */
export function isSafeRelPath(path: string): boolean {
  if (!path || path.length > 255) return false;
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0")) return false;
  const parts = path.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return false;
  if (parts[0] === BACKUPS_DIR) return false;
  return !DB_FILES.test(parts[parts.length - 1]!);
}

/** A row is written straight into SQL, so every value has to be something SQLite can bind. */
function isScalarRow(row: unknown): row is Record<string, unknown> {
  if (typeof row !== "object" || row === null || Array.isArray(row)) return false;
  return Object.values(row).every(
    (v) => v === null || ["string", "number", "boolean"].includes(typeof v),
  );
}

/**
 * Validate an untrusted JSON document into a {@link Backup}, or say why it isn't one. Pure, and the
 * only thing standing between a file off a phone and a `DELETE FROM card` — so it checks the shape
 * WHOLE (every table, every row, every path) before the caller touches anything.
 */
export function parseBackup(v: unknown): { ok: true; value: Backup } | { ok: false; error: string } {
  if (typeof v !== "object" || v === null) return { ok: false, error: "not a backup file" };
  const o = v as Record<string, unknown>;
  if (o.kind !== BACKUP_KIND) return { ok: false, error: "not a Collie Board backup" };
  if (typeof o.version !== "number" || !Number.isInteger(o.version) || o.version < 1) {
    return { ok: false, error: "bad version" };
  }
  // A NEWER backup may carry a shape this build doesn't know how to write back — refuse rather
  // than restore half of it. Older ones are fine: the restore ignores what it doesn't recognise.
  if (o.version > BACKUP_VERSION) {
    return { ok: false, error: `backup version ${o.version} is newer than this Collie Board` };
  }
  if (typeof o.exportedAt !== "string") return { ok: false, error: "bad exportedAt" };

  if (typeof o.db !== "object" || o.db === null || Array.isArray(o.db)) {
    return { ok: false, error: "bad db" };
  }
  for (const [table, rows] of Object.entries(o.db as Record<string, unknown>)) {
    if (!Array.isArray(rows)) return { ok: false, error: `bad db.${table}` };
    if (!rows.every(isScalarRow)) return { ok: false, error: `bad row in db.${table}` };
  }

  if (!Array.isArray(o.files)) return { ok: false, error: "bad files" };
  for (const f of o.files) {
    if (typeof f !== "object" || f === null) return { ok: false, error: "bad file entry" };
    const file = f as Record<string, unknown>;
    if (typeof file.path !== "string" || !isSafeRelPath(file.path)) {
      return { ok: false, error: `unsafe path: ${String(file.path)}` };
    }
    if (file.encoding !== "utf8" && file.encoding !== "base64") {
      return { ok: false, error: `bad encoding for ${file.path}` };
    }
    if (typeof file.content !== "string") return { ok: false, error: `bad content for ${file.path}` };
  }

  return { ok: true, value: o as unknown as Backup };
}

/**
 * Export the CURRENT state to `<stateDir>/backups/pre-import-<ts>.json` and return its path.
 *
 * The safety net, taken before a restore overwrites anything. Written on the HOST, not downloaded:
 * a file the browser may or may not have finished saving is not a net. Owner-only, like everything
 * else in the state dir. A failure here is fatal to the import by design — see the route.
 */
export async function writeSafetyBackup(
  db: BoardDb,
  stateDir: string,
  now: number = Date.now(),
): Promise<string> {
  const backup = await buildBackup(db, stateDir, now);
  const dir = join(stateDir, BACKUPS_DIR);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // `:` is legal here but not on Windows, and this file is meant to be copied off the host.
  const stamp = backup.exportedAt.replace(/[:.]/g, "-");
  const path = join(dir, `pre-import-${stamp}.json`);
  await writeFile(path, JSON.stringify(backup), { mode: 0o600 });
  return path;
}

export interface RestoreResult {
  /** Rows written, per table. */
  tables: Record<string, number>;
  /** Files written under the state dir. */
  files: number;
}

/**
 * Write a validated backup back over the live state: tables first (one transaction), then files.
 *
 * MERGE, not wipe. A table present in the document replaces that table's contents; a table absent
 * from it is left alone. Files are overwritten by path and nothing is deleted — the state dir may
 * hold things a restore has no business removing (an in-flight upload, a newer audit line), and
 * with the safety export already on disk, the less destructive half of that trade is the right one.
 */
export async function restoreBackup(
  db: BoardDb,
  stateDir: string,
  backup: Backup,
): Promise<RestoreResult> {
  const tables = db.restore(backup.db);
  for (const file of backup.files) {
    const abs = join(stateDir, file.path);
    await mkdir(dirname(abs), { recursive: true, mode: 0o700 });
    // Unlink first: writeFile follows a symlink, and the target may not be one we planted.
    await rm(abs, { force: true });
    await writeFile(abs, Buffer.from(file.content, file.encoding), { mode: 0o600 });
  }
  return { tables, files: backup.files.length };
}
