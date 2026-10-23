#!/usr/bin/env bun
// Claude Code UserPromptSubmit hook: what moved in the orchestrator's repo since its last turn, read
// from `GET /api/orchestrator/since` and printed as context for the turn. Silent everywhere else — the
// bridge answers 204 to any pane that is not an orchestrator — and when nothing moved. Never blocks:
// every failure exits 0 with nothing printed. The cursor (a ts) lives in a file per pane.
// Bun, not bash + curl + jq: the same file runs on Windows, where Git Bash has no jq.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type Env = Record<string, string | undefined>;

/** The summary to print, or "" — never throws. `fetchImpl` is the test's seam. */
export async function sinceHook(env: Env, fetchImpl: typeof fetch = fetch): Promise<string> {
  const pane = env.HERDR_PANE_ID;
  if (!pane) return "";
  const base = env.COLLIE_BOARD_URL || `http://127.0.0.1:${env.COLLIE_BOARD_PORT || "8788"}`;
  const headers: Record<string, string> = { "x-collie-pane": pane };
  if (env.COLLIE_BOARD_DEVICE_HEADER && env.COLLIE_BOARD_DEVICE) {
    headers[env.COLLIE_BOARD_DEVICE_HEADER] = env.COLLIE_BOARD_DEVICE;
  }
  // A pane id is `w1:p2`, and `:` is not a file-name character on Windows.
  const name = `since-${pane.replace(/[:\\/]/g, "_")}`;
  const file = join(env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "collie-board", name);
  try {
    let since = "";
    try {
      since = readFileSync(file, "utf8").trim();
    } catch {}
    const res = await fetchImpl(`${base}/api/orchestrator/since?since=${encodeURIComponent(since)}`, {
      headers,
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return "";
    const text = await res.text();
    if (!text) return "";
    const r = JSON.parse(text) as { cursor?: unknown; summary?: unknown };
    if (r.cursor != null && r.cursor !== "") {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${r.cursor}\n`);
    }
    return typeof r.summary === "string" ? r.summary : "";
  } catch {
    return "";
  }
}

if (import.meta.main) {
  const out = await sinceHook(process.env);
  if (out) console.log(out);
}
