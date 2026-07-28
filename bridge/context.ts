// Context telemetry — how full is this agent's window, and is it time to hand off.
//
// THREE LEVELS, per the design, and the gauge is a CONFORT not a prerequisite: the handoff button is
// always available, so a session with no number attached is still fully usable.
//
//   1. The transcript. Collie already resolves and parses an agent's on-disk session log
//      (transcript.ts) because a TUI on the alternate screen has no scrollback. The occupancy is one
//      field that parser drops — so this is an extension of existing code, not a new subsystem.
//   2. A heuristic (transitions + output volume). NOT BUILT. It can only produce a number that looks
//      authoritative and isn't; on the one agent that keeps no transcript it would be the sole input
//      to a "should I hand off" decision, which is exactly where a wrong number costs the most. Level
//      3 is the honest degradation.
//   3. Nothing. `ctxPct` stays null, the phone shows no gauge, Handoff still works.
//
// The number is pushed back into herdr with `pane.report_metadata`, where it renders as `$ctx` in the
// Agents sidebar — so the gauge is visible in the TUI too, not only in the phone app. TTL'd, so a
// bridge that stops reporting leaves no stale figure behind rather than a lie that never expires.

import { adapterFor, type AgentAdapter } from "./adapters.ts";
import type { BoardDb } from "./db.ts";
import type { HerdrClient } from "./herdr-client.ts";
import type { EngineSnapshot } from "./state-engine.ts";
import { latestUsage, type TranscriptSource } from "./transcript.ts";
import { processStartedAt } from "./proc.ts";

/**
 * How often one session's transcript is re-read. The snapshot poll ticks every 1.5 s; re-reading a
 * multi-megabyte log at that rate to move a percentage by one point would be absurd. A context
 * window fills over minutes, so this is deliberately slow.
 */
const REFRESH_MS = 30_000;

/** How long herdr should keep showing the number if we stop reporting. Two refresh windows. */
const METADATA_TTL_MS = 90_000;

/** The `source` herdr attributes the metadata to (it namespaces reporters). */
const METADATA_SOURCE = "collie-board";

/** Round a ratio to a whole percent, clamped — a transcript can out-run a mis-set window size. */
export function contextPercent(tokens: number, windowTokens: number): number | null {
  if (!Number.isFinite(tokens) || tokens <= 0) return null;
  if (!Number.isFinite(windowTokens) || windowTokens <= 0) return null;
  return Math.min(100, Math.round((tokens / windowTokens) * 100));
}

/**
 * Tracks context occupancy for every card with a running agent, and reports it both to the board
 * (so the card can show a gauge) and to herdr (so the TUI can).
 *
 * Driven by the same snapshot poll as everything else — there is no timer in here — but throttled
 * per pane, so the expensive part (a transcript read) happens on ITS own cadence.
 */
export class ContextTracker {
  /** paneId → last time we read its transcript. */
  private readonly lastRead = new Map<string, number>();

  constructor(
    private readonly db: BoardDb,
    private readonly herdr: HerdrClient,
    private readonly source: TranscriptSource,
    private readonly windowTokens: number,
    /** Per-agent divergence — an agent with no readable transcript is skipped entirely. */
    private readonly adapters: Record<string, AgentAdapter> = {},
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Refresh whatever is due. Best-effort throughout: a failed transcript read or a failed metadata
   * push must never disturb the poll loop that called us — the gauge is a comfort, and level 3 is a
   * supported outcome, not an error.
   */
  async update(snap: EngineSnapshot): Promise<void> {
    if (snap.bridge === "disconnected") return;
    const live = new Set([...snap.agents, ...snap.shellPanes].map((p) => p.paneId));

    // Forget panes that are gone, so the throttle map can't grow for the process's lifetime.
    for (const paneId of [...this.lastRead.keys()]) {
      if (!live.has(paneId)) this.lastRead.delete(paneId);
    }

    // The pane's cwd is the second way in when herdr reports no agent_session (the default without
    // `herdr integration install claude`) — see TranscriptSource.resolveByCwd.
    const cwdOf = new Map([...snap.agents, ...snap.shellPanes].map((p) => [p.paneId, p.cwd]));

    const due = this.db.listOpenSessions().filter((s) => {
      if (!s.paneId || !live.has(s.paneId)) return false;
      // Level 3 by construction: an agent whose transcript format we can't read gets no gauge, and
      // no wasted filesystem scan either.
      if (s.agentKind && !adapterFor(this.adapters, s.agentKind).context) return false;
      if (!s.agentSessionId && !cwdOf.get(s.paneId)) return false;
      const last = this.lastRead.get(s.paneId);
      return last === undefined || this.now() - last >= REFRESH_MS;
    });

    await Promise.all(
      due.map(async (session) => {
        const paneId = session.paneId!;
        this.lastRead.set(paneId, this.now());
        try {
          const path = session.agentSessionId
            ? await this.source.resolve(session.agentSessionId)
            : await this.resolveWithoutIntegration(paneId, cwdOf.get(paneId)!);
          if (path === null) return; // level 3: no log for this agent, and that is fine
          const { text } = await this.source.load(path);
          const usage = latestUsage(text);
          if (!usage) return;
          const pct = contextPercent(usage.tokens, this.windowTokens);
          this.db.patchSession(session.id, { ctxTokens: usage.tokens, ctxPct: pct });
          if (pct !== null) await this.report(paneId, pct);
        } catch {
          // Level 3. Keep the last known figure rather than blanking a gauge on one bad read.
        }
      }),
    );
  }

  /**
   * Find a pane's transcript when herdr reports no `agent_session` — i.e. whenever the optional
   * `herdr integration install <agent>` hook isn't in place, which is the default.
   *
   * Ask herdr for the pane's foreground PID, read that process's start time, and pick the log born
   * closest after it. Exact even with two agents live in the same directory, where "newest file in
   * the folder" is a coin flip — and a coin flip here means reporting another session's context.
   * Everything degrades: no pid, no /proc, no birth times → the by-directory guess.
   */
  private async resolveWithoutIntegration(paneId: string, cwd: string): Promise<string | null> {
    try {
      const proc = await this.herdr.paneProcess(paneId);
      const startedAt = proc ? await processStartedAt(proc.pid) : null;
      if (proc && startedAt !== null) {
        return await this.source.resolveForProcess(proc.cwd || cwd, startedAt);
      }
    } catch {
      // herdr couldn't tell us, or this platform has no /proc — fall through.
    }
    return this.source.resolveByCwd(cwd);
  }

  /** Push `$ctx` onto the pane so herdr's own Agents sidebar shows the same number the phone does. */
  private async report(paneId: string, pct: number): Promise<void> {
    try {
      await this.herdr.reportPaneMetadata({
        paneId,
        source: METADATA_SOURCE,
        tokens: { ctx: `${pct}%` },
        ttlMs: METADATA_TTL_MS,
      });
    } catch {
      // An older herdr may not know the method; the phone-side gauge is unaffected either way.
    }
  }
}
