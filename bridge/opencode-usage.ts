// OpenCode session telemetry — the other computable gauge.
//
// OpenCode keeps its sessions in a sqlite database (`session_v2` + `session_message`), and both
// halves of a gauge are in it, verified 2026-09-22 against the live `~/.local/share/opencode/`:
//   - occupancy: the newest `assistant` message's `data.tokens`
//     (`{input, output, reasoning, cache:{read,write}}`);
//   - model: `session_v2.model` (`{id, providerID}`), resolved to a window by `context-window.ts`.
//
// Two deliberate asymmetries with the Claude path (`transcript.ts`):
//   - occupancy is input + cache.read + cache.write of the newest assistant message. Output and
//     reasoning are excluded the same way Claude's output is: what counts is what the NEXT turn
//     must re-read. (Whether a provider double-counts reasoning inside input is unverified —
//     see the note, and the gauge errs low rather than high.)
//   - the pane → session link is by DIRECTORY (`session_v2.directory`), not by session id, because
//     herdr reports no `agent_session` for opencode panes. One directory can hold several sessions
//     (relaunch, fork), so the single-live-candidate rule below refuses rather than guesses: two
//     sessions updated within LIVE_MS means "two live panes in one directory", and a gauge that
//     might be the other pane's is worse than no gauge.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";

/** A session updated more recently than this counts as live for the ambiguity rule. */
export const OPENCODE_LIVE_MS = 10 * 60 * 1000;

export interface OpenCodeUsage {
  /** input + cache.read + cache.write of the newest assistant message. */
  tokens: number;
  /** `session_v2.model`, e.g. `{id: "muse-spark-1.3-…", providerID: "opencode"}` — nulls when absent. */
  modelId: string | null;
  providerId: string | null;
  /** The session this was read from — for logs, never shown. */
  sessionId: string;
}

/**
 * Where OpenCode keeps its session database. Pure so both branches are unit-testable on any
 * platform. `~/.local/share` follows XDG on Unix; the Windows beta keeps app data under
 * `%LOCALAPPDATA%` (unverified — nobody has run this path on Windows yet).
 */
export function defaultOpenCodeDbPath(
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
  home: string = process.env.HOME ?? "",
): string {
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    return join(localAppData, "opencode", "opencode.db");
  }
  return join(home, ".local", "share", "opencode", "opencode.db");
}

interface SessionRow {
  id: string;
  time_updated: number;
  model: string | null;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

/**
 * Occupancy + model for the session backing `cwd`, or null when there is no safe answer: no
 * database, no session in that directory, two live sessions (ambiguous), or no assistant message
 * carrying tokens yet. Never throws — level 3 is a supported outcome, not an error.
 */
export function readOpenCodeUsage(
  dbPath: string,
  cwd: string,
  now: () => number = Date.now,
): OpenCodeUsage | null {
  try {
    if (!cwd || !existsSync(dbPath)) return null;
    const db = new Database(dbPath, { readonly: true });
    try {
      const sessions = db
        .query<SessionRow, [string, string]>(
          `SELECT id, time_updated, model FROM session_v2
           WHERE directory = $a OR directory = $b ORDER BY time_updated DESC`,
        )
        .all(cwd, cwd.endsWith("/") ? cwd.slice(0, -1) : `${cwd}/`);
      if (sessions.length === 0) return null;
      const at = now();
      const live = sessions.filter(
        (s) => Number.isFinite(s.time_updated) && at - s.time_updated < OPENCODE_LIVE_MS,
      );
      // Two live sessions in one directory: two panes, one gauge — refuse.
      if (live.length >= 2) return null;
      const session = sessions[0]!;
      const messages = db
        .query<{ data: string }, [string]>(
          `SELECT data FROM session_message WHERE session_id = $id AND type = 'assistant'
           ORDER BY seq DESC LIMIT 5`,
        )
        .all(session.id);
      for (const { data } of messages) {
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
          const model = JSON.parse(session.model ?? "null") as Record<string, unknown> | null;
          modelId = text(model?.id);
          providerId = text(model?.providerID);
        } catch {
          // A session without a parseable model still yields its tokens; the window falls back.
        }
        return { tokens: occupancy, modelId, providerId, sessionId: session.id };
      }
      return null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}
