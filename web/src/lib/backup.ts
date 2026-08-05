import { ApiError, withTimeout } from "./api";

// The client half of the backup (bridge/backup.ts owns the format). The bridge can only dump what
// it stores; the appearance and display preferences live in this browser's localStorage, so the
// file is assembled HERE — fetch the server document, staple the `collie:` keys on, save it.

const BACKUP_PATH = "/api/backup";

/** Every browser-side preference is namespaced `collie:` — that prefix IS the selector. */
const CLIENT_PREFIX = "collie:";

/**
 * A backup can carry every uploaded image, so it gets a far longer leash than lib/api's 10 s GET
 * budget — which is why this fetches by hand rather than through `apiRequest`.
 */
const BACKUP_TIMEOUT_MS = 60_000;

export interface BackupFile {
  path: string;
  encoding: "utf8" | "base64";
  content: string;
}

export interface Backup {
  kind: string;
  version: number;
  exportedAt: string;
  db: Record<string, unknown[]>;
  files: BackupFile[];
  /** This browser's prefs — added client-side, absent from the server's response. */
  client?: Record<string, string>;
}

/** This browser's Collie preferences: theme, display prefs, push opt-out, board repo scope. */
export function collectClientPrefs(): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof localStorage === "undefined") return out;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(CLIENT_PREFIX)) continue;
    const value = localStorage.getItem(key);
    if (value !== null) out[key] = value;
  }
  return out;
}

/** `collie-board-backup-2026-08-05.json` — dated so successive backups don't overwrite each other. */
export function backupFilename(exportedAt: string): string {
  return `collie-board-backup-${exportedAt.slice(0, 10)}.json`;
}

/** Hand a blob to the browser's own download machinery. Kept apart so the rest stays testable. */
function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  // In the DOM before the click, and the URL revoked a tick later — Safari cancels a download whose
  // object URL is revoked in the same task.
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

/** Fetch the durable state, fold in this browser's prefs, and save it. Returns the filename. */
export async function downloadBackup(): Promise<string> {
  const res = await fetch(BACKUP_PATH, { signal: withTimeout(null, BACKUP_TIMEOUT_MS) });
  if (!res.ok) throw new ApiError(`${BACKUP_PATH} → ${res.status}`, res.status);
  const backup = (await res.json()) as Backup;
  const doc: Backup = { ...backup, client: collectClientPrefs() };
  const filename = backupFilename(backup.exportedAt);
  save(new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }), filename);
  return filename;
}
