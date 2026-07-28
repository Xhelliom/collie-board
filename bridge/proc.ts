// When a process started.
//
// This exists for ONE job: tying a pane's agent to its own transcript file when herdr reports no
// `agent_session` — which is the default, because that field only appears once the optional
// `herdr integration install <agent>` hook is in place. A session log is created within seconds of
// the process that writes it (measured: process 18:45:30, log born 18:45:37), so the start time is
// enough to pick the right file out of a directory holding dozens.
//
// TWO WAYS TO ASK, because Collie runs on Linux and macOS:
//
//   - `/proc/<pid>/stat` on Linux. A file read, no subprocess, exact.
//   - `ps -o etime=` everywhere else. macOS has no procfs, and its `birthtime` support is actually
//     BETTER than Linux's (native on APFS/HFS+), so it would be perverse to give up there for want
//     of a start time. `etime` — elapsed seconds since start — is used rather than `lstart` because
//     `lstart` is LOCALE-DEPENDENT: on this machine it prints "mar. juil. 28 14:43:55 2026", which
//     is not something to write a parser against.
//
// Everything degrades rather than fails: no answer at all → the caller falls back to "newest log in
// the directory", a worse answer for the rare case of two agents in one directory, never a crash.

import { readFileSync } from "node:fs";

/**
 * Ticks per second for the values in /proc/<pid>/stat — `sysconf(_SC_CLK_TCK)`, which no JS runtime
 * exposes. This is USER_HZ, not the kernel's CONFIG_HZ: the kernel scales its numbers to USER_HZ
 * before putting them in procfs precisely so this constant can be stable, and it is 100 on x86,
 * x86_64, arm and arm64 — every realistic target. A couple of historical architectures used 1024.
 *
 * Getting it wrong is SAFE by construction, which is why hardcoding it is acceptable: too small a
 * divisor puts the computed start time in the future, the guard below rejects it, and the caller
 * falls back to the by-directory guess. It can never silently produce a wrong-but-plausible answer.
 */
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

/**
 * Parse `ps -o etime=` — elapsed time since the process started, as seconds.
 *
 * Three shapes, and no others: `MM:SS`, `HH:MM:SS`, `DD-HH:MM:SS`. Pure + exported, because it is
 * the only parsing in the macOS path and it is trivially wrong if you assume a fixed field count.
 */
export function parseEtime(raw: string): number | null {
  // A strict shape, deliberately: splitting on ":" and "-" by hand accepted "-1:00" as 60 seconds,
  // because an empty days field parsed as 0. The grammar is small enough to just state.
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(raw.trim());
  if (!m) return null;
  const [, d = "0", h = "0", min, sec] = m;
  return ((Number(d) * 24 + Number(h)) * 60 + Number(min)) * 60 + Number(sec);
}

/** Linux: read it straight out of procfs. Null when there is no /proc or the pid is gone. */
function startedAtFromProc(pid: number): number | null {
  const boot = bootTime();
  if (boot === null) return null;
  try {
    const ticks = parseStartTicks(readFileSync(`/proc/${pid}/stat`, "utf8"));
    if (ticks === null) return null;
    const startedAt = (boot + ticks / CLOCK_TICKS_PER_SEC) * 1000;
    // A process cannot have started in the future or before boot. Either means our tick rate is
    // wrong for this architecture — say "unknown" rather than hand back a confident bad number.
    if (startedAt > Date.now() + 60_000 || startedAt < boot * 1000) return null;
    return startedAt;
  } catch {
    return null;
  }
}

/** Everywhere else (macOS): ask `ps`. One subprocess, on a path that runs every 30 s at most. */
async function startedAtFromPs(pid: number): Promise<number | null> {
  try {
    const proc = Bun.spawn(["ps", "-o", "etime=", "-p", String(pid)], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) return null;
    const elapsed = parseEtime(out);
    return elapsed === null ? null : Date.now() - elapsed * 1000;
  } catch {
    return null;
  }
}

/** When `pid` started, as epoch milliseconds, or null when it can't be determined. */
export async function processStartedAt(pid: number): Promise<number | null> {
  return startedAtFromProc(pid) ?? (await startedAtFromPs(pid));
}
