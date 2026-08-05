import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { BoardDb } from "./db.ts";

// One-file backup of everything Collie Board persists.
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

export const BACKUP_KIND = "collie-board-backup";
export const BACKUP_VERSION = 1;

/** Rebuilt from the row dump above — their bytes are deliberately skipped. */
const DB_FILES = /^board\.db(-wal|-shm)?$/;

/** Kept as text so the backup stays greppable; everything else (uploads) rides as base64. */
const TEXT_FILES = /\.(json|jsonl|log|txt|md|toml)$/i;

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
