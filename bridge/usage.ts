// How much Claude Code quota is left — the number the dashboard shows.
//
// THE SOURCE, AND WHY NOT THE COPILOT. The card proposed driving `/usage` through the copilot as a
// workaround, "if there's no other way". There is: `claude -p "/usage"` runs the slash command
// head-lessly and prints the same panel as plain text, in ~1.5 s, WITHOUT spending a model turn —
// the command is rendered locally. So this is a subprocess and a regex, not a pane, not a queued
// agent request, not the user's quota being spent to ask how much quota is left. See ADR 0009.
//
// It IS a shell-out, which the fork otherwise confines to git.ts (plus `ps` in proc.ts). Same rules
// apply: argv elements, never a shell, no client-supplied argument anywhere near it — the command
// line here is a constant.
//
// DEGRADES TO NOTHING. No `claude` on PATH, a panel that stops looking like this, a timeout: the
// endpoint answers `null` and the phone shows no gauge. A quota figure that might be wrong is worse
// than no figure, exactly like the context gauge (context.ts).

import { homedir } from "node:os";

/** One of the panel's limit lines. `percent` is what's USED — the UI does the subtraction. */
export interface UsageLimit {
  /** The limit's own name, verbatim: "Current session", "Current week (all models)", … */
  label: string;
  /** Percentage of that limit already consumed, 0–100. */
  percent: number;
  /** When it resets, as the CLI phrased it ("Aug 24, 11:59am (Europe/Paris)"), or null. */
  resetsAt: string | null;
}

export interface ClaudeUsage {
  limits: UsageLimit[];
  /** When this reading was taken (epoch ms). The UI shows its age. */
  checkedAt: number;
}

/** How long a reading stays fresh. A five-hour window doesn't move fast; this is the card's "15 to
 *  30 minutes", taken at the low end so landing on the dashboard rarely shows something stale. */
export const USAGE_TTL_MS = 15 * 60_000;

/** Nothing about `/usage` should take this long. Kill it rather than pin a request open. */
const TIMEOUT_MS = 30_000;

/**
 * The limit lines out of `/usage`'s output. Everything else the panel prints (the header, the
 * "what's contributing" breakdown) is dropped — it isn't a quota figure.
 *
 * Pure + exported: this is the whole fragile part, so it's the part with a test.
 */
export function parseUsage(out: string): UsageLimit[] {
  const limits: UsageLimit[] = [];
  for (const line of out.split("\n")) {
    // "Current session: 53% used · resets Aug 24, 11:59am (Europe/Paris)" — the reset half is
    // optional (a week-scoped model limit at 0% prints without one).
    const m = /^\s*(Current [^:]+):\s*(\d{1,3})%\s+used(?:\s*·\s*resets\s+(.+?))?\s*$/.exec(line);
    if (!m) continue;
    const percent = Number(m[2]);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) continue;
    limits.push({ label: m[1]!, percent, resetsAt: m[3]?.trim() || null });
  }
  return limits;
}

/** Run the CLI. Separate from the parse so the test never spawns anything. */
async function readUsage(): Promise<string | null> {
  try {
    const proc = Bun.spawn(["claude", "-p", "/usage"], {
      // Home, not a repo: `-p` in a worktree would load that project's CLAUDE.md and settings for a
      // command that needs neither.
      cwd: homedir(),
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    });
    const timer = setTimeout(() => proc.kill(), TIMEOUT_MS);
    try {
      const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      return code === 0 ? out : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // No `claude` on PATH is the normal case here, not an error worth logging every 15 minutes.
    return null;
  }
}

/**
 * Cached quota reading. One subprocess at a time — concurrent callers (two phones, or a refresh tap
 * landing on a page load) share the one in flight rather than each starting a CLI.
 */
export class UsageTracker {
  private cached: ClaudeUsage | null = null;
  private inflight: Promise<ClaudeUsage | null> | null = null;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly read: () => Promise<string | null> = readUsage,
  ) {}

  /** The current reading, refreshing it when it's older than the TTL or `force` is set. */
  get(force = false): Promise<ClaudeUsage | null> {
    if (!force && this.cached && this.now() - this.cached.checkedAt < USAGE_TTL_MS) {
      return Promise.resolve(this.cached);
    }
    this.inflight ??= this.refresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async refresh(): Promise<ClaudeUsage | null> {
    const out = await this.read();
    const limits = out === null ? [] : parseUsage(out);
    // A run that produced no limit lines keeps the previous reading rather than blanking the gauge:
    // one hiccup shouldn't erase a number that was true fifteen minutes ago.
    if (limits.length === 0) return this.cached;
    this.cached = { limits, checkedAt: this.now() };
    return this.cached;
  }
}

/**
 * The one tracker the board route uses. Module-scoped on purpose: it has no dependencies to inject,
 * so threading a field through server.ts's BoardContext would widen the upstream diff for nothing.
 */
export const usageTracker = new UsageTracker();
