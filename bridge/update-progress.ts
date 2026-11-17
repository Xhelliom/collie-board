// Where an update stands, for Settings → About. The ctl (collie-board-ctl.sh / scripts/ctl.ts) writes
// the step it is on to `update-step` in the plugin config dir — `fetch`, `build`, `restart`, or the
// same followed by ` failed` — and removes it once the update is through. The bridge only reads it.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const UPDATE_STEP_FILE = "update-step";
const STEPS = ["fetch", "build", "restart"] as const;
export type UpdateStep = (typeof STEPS)[number];
export interface UpdateProgress {
  step: UpdateStep;
  failed: boolean;
}

// shortcut: a ctl killed mid-update leaves its file behind; past this age it no longer counts. A
// pid check would be exact, but the update runs under herdr, outside anything the bridge can see.
const FRESH_MS = 30 * 60_000;

/** The file's one line, or null for anything else. Pure. */
export function parseUpdateStep(text: string): UpdateProgress | null {
  const m = /^(fetch|build|restart)( failed)?$/.exec(text.trim());
  return m ? { step: m[1] as UpdateStep, failed: Boolean(m[2]) } : null;
}

/** The update under way or just failed in `configDir`, or null (none, stale, or no config dir). */
export function readUpdateProgress(configDir: string, now = Date.now()): UpdateProgress | null {
  if (!configDir) return null;
  const file = join(configDir, UPDATE_STEP_FILE);
  try {
    if (now - statSync(file).mtimeMs > FRESH_MS) return null;
    return parseUpdateStep(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
