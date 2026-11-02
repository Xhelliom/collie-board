// OpenCode session telemetry — the other computable gauge.
//
// OpenCode keeps its sessions in a sqlite database (schemas 1.x and 2.x: opencode-store.ts), and
// both halves of a gauge are in it, verified against real databases of each version (2.x on
// 2026-09-22, opencode v2.0.12 re-checked and 1.15.10 checked on 2026-11-02):
//   - occupancy: the newest `assistant` message's `data.tokens`
//     (`{input, output, reasoning, cache:{read,write}}` — same shape in both versions);
//   - model: the session row's `model` (`{id, providerID}`), resolved to a window by
//     `context-window.ts`.
//
// Occupancy is input + cache.read + cache.write of the newest assistant message. Output and
// reasoning are excluded the same way Claude's output is: what counts is what the NEXT turn must
// re-read. The pane → session link is opencode-store.ts's, the same one the reading view uses: a
// gauge that might be another pane's is worse than no gauge.

import { join } from "node:path";

import { messageRows, openOpenCodeStore, resolveOpenCodeSession, getSession, type ResolveOpts } from "./opencode-store.ts";

export { OPENCODE_LIVE_MS } from "./opencode-store.ts";

export interface OpenCodeUsage {
  /** input + cache.read + cache.write of the newest assistant message. */
  tokens: number;
  /** The session's `model`, e.g. `{id: "muse-spark-1.3-…", providerID: "opencode"}` — nulls when absent. */
  modelId: string | null;
  providerId: string | null;
  /** The session this was read from — for logs, never shown. */
  sessionId: string;
}

/**
 * OpenCode's data directory — the store file inside is picked at read time (opencode-store.ts),
 * since its name depends on the version and channel. `$XDG_DATA_HOME` first, as opencode does; the
 * Windows beta keeps app data under `%LOCALAPPDATA%` (unverified).
 */
export function defaultOpenCodeDbPath(
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
  home: string = process.env.HOME ?? "",
): string {
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    return join(localAppData, "opencode");
  }
  return join(env.XDG_DATA_HOME || join(home, ".local", "share"), "opencode");
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

/**
 * Occupancy + model for the pane's session, or null when there is no safe answer: no database, no
 * session that is provably this pane's, or no assistant message carrying tokens yet. Never throws.
 */
export async function readOpenCodeUsage(
  dbPath: string,
  opts: ResolveOpts,
): Promise<OpenCodeUsage | null> {
  const store = openOpenCodeStore(dbPath);
  if (!store) return null;
  try {
    const sessionId = await resolveOpenCodeSession(store, opts);
    if (!sessionId) return null;
    const rows = messageRows(store, sessionId, { tail: 5, assistant: true }).reverse();
    for (const { data } of rows) {
      let parsed: { tokens?: unknown };
      try {
        parsed = JSON.parse(data) as typeof parsed;
      } catch {
        continue;
      }
      const tokens = parsed?.tokens;
      if (tokens === null || typeof tokens !== "object") continue;
      const t = tokens as Record<string, unknown>;
      const cache = (t.cache ?? {}) as Record<string, unknown>;
      const occupancy = num(t.input) + num(cache.read) + num(cache.write);
      if (occupancy === 0) continue;
      let modelId: string | null = null;
      let providerId: string | null = null;
      try {
        const model = JSON.parse(getSession(store, sessionId)?.model ?? "null") as Record<string, unknown> | null;
        modelId = text(model?.id);
        providerId = text(model?.providerID);
      } catch {
        // A session without a parseable model still yields its tokens; the window falls back.
      }
      return { tokens: occupancy, modelId, providerId, sessionId };
    }
    return null;
  } catch {
    return null;
  } finally {
    store.db.close();
  }
}
