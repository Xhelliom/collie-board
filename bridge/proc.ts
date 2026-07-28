// When a process started, from /proc. Linux only, by design.
//
// This exists for ONE job: tying a pane's agent to its own transcript file when herdr reports no
// `agent_session` — which is the default, because that field only appears once the optional
// `herdr integration install <agent>` hook is in place. A session log is created within seconds of
// the process that writes it (measured here: process 18:45:30, log born 18:45:37), so the start
// time is enough to pick the right file out of a directory holding dozens.
//
// Everything about this degrades rather than fails: on macOS or Windows there is no /proc, the
// function returns null, and the caller falls back to "newest log in the directory" — a worse
// answer for the rare case of two agents in one directory, never a crash.

import { readFileSync } from "node:fs";

/** Ticks per second for the values in /proc/<pid>/stat. Linux fixes this at 100 in practice. */
const CLOCK_TICKS_PER_SEC = 100;

/** Boot time (epoch seconds), read once — it cannot change while we run. */
let bootTimeSec: number | null | undefined;

function bootTime(): number | null {
  if (bootTimeSec !== undefined) return bootTimeSec;
  try {
    const line = readFileSync("/proc/stat", "utf8")
      .split("\n")
      .find((l) => l.startsWith("btime "));
    bootTimeSec = line ? Number(line.slice(6).trim()) || null : null;
  } catch {
    bootTimeSec = null;
  }
  return bootTimeSec;
}

/**
 * Parse field 22 (`starttime`, in clock ticks since boot) out of a /proc/<pid>/stat line.
 *
 * Split on the LAST `)`, never on whitespace: field 2 is the executable name in parentheses and it
 * can contain spaces and parens of its own, which is the classic way this parse goes wrong.
 *
 * Pure + exported — the only interesting part is that split.
 */
export function parseStartTicks(stat: string): number | null {
  const close = stat.lastIndexOf(")");
  if (close < 0) return null;
  // After the name, field 3 is state; starttime is field 22, so index 19 of what follows.
  const fields = stat.slice(close + 1).trim().split(/\s+/);
  const ticks = Number(fields[19]);
  return Number.isFinite(ticks) ? ticks : null;
}

/** When `pid` started, as epoch milliseconds, or null when it can't be determined. */
export function processStartedAt(pid: number): number | null {
  const boot = bootTime();
  if (boot === null) return null;
  try {
    const ticks = parseStartTicks(readFileSync(`/proc/${pid}/stat`, "utf8"));
    if (ticks === null) return null;
    return (boot + ticks / CLOCK_TICKS_PER_SEC) * 1000;
  } catch {
    return null; // no /proc, or the process is already gone
  }
}
