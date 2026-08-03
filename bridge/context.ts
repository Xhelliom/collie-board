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
import { latestUsage, resolveWithoutSession, type TranscriptSource } from "./transcript.ts";
import { processStartedAt } from "./proc.ts";
import type { AgentView } from "./types.ts";

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
 * Tracks context occupancy for every AGENT PANE in the herd — card-backed or launched by hand — and
 * reports it to the pane snapshot (so any screen can show a gauge), to the board (for the panes that
 * do back a card), and to herdr (so the TUI shows the same number).
 *
 * Driven by the same snapshot poll as everything else — there is no timer in here — but throttled
 * per pane, so the expensive part (a transcript read) happens on ITS own cadence.
 *
 * THE COST OF READING EVERY PANE, measured 2026-07-30 on this machine's ~/.claude/projects (378 logs,
 * 0.3–18 MB), per pane per REFRESH_MS: `resolve` 1–5 ms, `load` 0.3–60 ms, `latestUsage` 1–44 ms —
 * median 10–23 ms, worst 110 ms on the 18 MB outlier. A twelve-agent herd therefore spends ~230–320 ms
 * every 30 s, i.e. ~1 % of one core. That is cheap enough to read the whole herd, so the narrower
 * "open pane + card panes" variant isn't built: it would need the bridge to track which pane the phone
 * has open, which is more state and more code than the reads it would save.
 */
export class ContextTracker {
  /** paneId → last time we read its transcript. */
  private readonly lastRead = new Map<string, number>();

  /**
   * paneId → last known occupancy. IN MEMORY ONLY: for a pane with no card this is runtime state, and
   * the fork's rule is that runtime state never reaches the database (`card` durable, `session`
   * ephemeral). Served with the snapshot by {@link enrich}; dropped when the pane goes away.
   */
  private readonly occupancy = new Map<string, { pct: number; tokens: number }>();

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
    // Agent-bearing panes only. A bare shell has no agent and therefore no transcript, so scanning
    // one by cwd would only ever find some OTHER agent's log — a wrong number, which is worse than
    // none. That also means a card whose agent has exited stops refreshing, as it should.
    const live = new Set(snap.agents.map((p) => p.paneId));

    // Forget panes that are gone, so neither map can grow for the process's lifetime.
    for (const paneId of [...this.lastRead.keys()]) {
      if (!live.has(paneId)) {
        this.lastRead.delete(paneId);
        this.occupancy.delete(paneId);
      }
    }

    // The card layer is now a LOOKUP, not the iteration source: it says which panes also deserve a
    // durable write, and carries the session id herdr may not report for the pane itself.
    const sessionByPane = new Map(
      this.db
        .listOpenSessions()
        .filter((s) => s.paneId !== null)
        .map((s) => [s.paneId!, s] as const),
    );

    // One pass, so the "which session id do we read from" rule is written ONCE and the throttle
    // compares every pane against the same instant.
    const now = this.now();
    const due = snap.agents.flatMap((pane) => {
      // Level 3 by construction: an agent whose transcript format we can't read gets no gauge, and
      // no wasted filesystem scan either.
      if (!adapterFor(this.adapters, pane.agent).context) return [];
      const last = this.lastRead.get(pane.paneId);
      if (last !== undefined && now - last < REFRESH_MS) return [];
      const session = sessionByPane.get(pane.paneId);
      // The pane's own id first — it's the live one; the card's is the fallback for a session whose
      // id herdr reported once and no longer does. Neither, and no cwd, leaves nothing to resolve from.
      const sessionId = pane.agentSessionId ?? session?.agentSessionId ?? null;
      if (sessionId === null && !pane.cwd) return [];
      return [{ pane, session, sessionId }];
    });

    await Promise.all(
      due.map(async ({ pane, session, sessionId }) => {
        const paneId = pane.paneId;
        this.lastRead.set(paneId, now);
        try {
          const path = sessionId
            ? await this.source.resolve(sessionId)
            : await this.resolveWithoutIntegration(paneId, pane.cwd);
          if (path === null) return; // level 3: no log for this agent, and that is fine
          const { text } = await this.source.load(path);
          const usage = latestUsage(text);
          if (!usage) return;
          const pct = contextPercent(usage.tokens, this.windowTokens);
          // Durable ONLY for a pane backing a card — that number is part of the card's record (the
          // card screen and the handoff hint read it). A pane with no card writes nothing.
          if (session) this.db.patchSession(session.id, { ctxTokens: usage.tokens, ctxPct: pct });
          if (pct === null) return; // a token count we can't turn into a percentage is no gauge
          this.occupancy.set(paneId, { pct, tokens: usage.tokens });
          await this.report(paneId, pct);
        } catch {
          // Level 3. Keep the last known figure rather than blanking a gauge on one bad read.
        }
      }),
    );
  }

  /**
   * Overlay the occupancy we hold in memory onto snapshot panes, so every pane screen and every home
   * tile can show the gauge — not just the ones backing a card (UI_AUDIT.md G3). A pane we have no
   * figure for is returned untouched, so "absent stays absent" and the UI simply renders no gauge.
   */
  enrich(panes: AgentView[]): AgentView[] {
    if (this.occupancy.size === 0) return panes;
    return panes.map((p) => {
      const seen = this.occupancy.get(p.paneId);
      return seen === undefined ? p : { ...p, ctxPct: seen.pct, ctxTokens: seen.tokens };
    });
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
    // The mechanism lives in transcript.ts, next to the two resolutions it picks between — the history
    // route needs the identical rule, and two copies of "which log is this pane's" is exactly the kind
    // of duplicate that drifts into showing two different conversations for one pane.
    return resolveWithoutSession({
      source: this.source,
      paneProcess: (id) => this.herdr.paneProcess(id),
      startedAt: processStartedAt,
      paneId,
      cwd,
    });
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
