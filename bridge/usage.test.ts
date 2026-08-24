// The `/usage` panel parse and the tracker's caching. The subprocess is injected, so nothing here
// spawns a CLI.
import { describe, expect, it } from "bun:test";

import { parseUsage, UsageTracker, USAGE_TTL_MS } from "./usage.ts";

/** Verbatim output of `claude -p "/usage"`, captured 2026-08-24. */
const PANEL = `You are currently using your subscription to power your Claude Code usage

Current session: 53% used · resets Aug 24, 11:59am (Europe/Paris)
Current week (all models): 15% used · resets Aug 26, 4:59pm (Europe/Paris)
Current week (Fable): 0% used

What's contributing to your limits usage?
Approximate, based on local sessions on this machine — does not include other devices or claude.ai.

Last 24h · 914 requests · 22 sessions
  60% of your usage was while 4+ sessions ran in parallel
  35% of your usage was at >150k context
`;

describe("parseUsage", () => {
  it("keeps the limit lines and nothing else", () => {
    expect(parseUsage(PANEL)).toEqual([
      { label: "Current session", percent: 53, resetsAt: "Aug 24, 11:59am (Europe/Paris)" },
      { label: "Current week (all models)", percent: 15, resetsAt: "Aug 26, 4:59pm (Europe/Paris)" },
      { label: "Current week (Fable)", percent: 0, resetsAt: null },
    ]);
  });

  it("finds nothing in output that isn't the panel", () => {
    // The "60% of your usage was …" breakdown lines are the trap: they carry a percentage and the
    // word "usage", and they are not limits.
    expect(parseUsage("error: not logged in\n  60% of your usage was at >150k context")).toEqual([]);
  });
});

describe("UsageTracker", () => {
  const tracker = (out: string | null, clock: { t: number }) => {
    let runs = 0;
    const t = new UsageTracker(
      () => clock.t,
      async () => {
        runs++;
        return out;
      },
    );
    return { t, runs: () => runs };
  };

  it("caches within the TTL, re-reads after it, and refreshes on demand", async () => {
    const clock = { t: 1_000 };
    const { t, runs } = tracker(PANEL, clock);

    expect((await t.get())?.limits[0]?.percent).toBe(53);
    await t.get();
    expect(runs()).toBe(1);

    expect((await t.get(true))?.checkedAt).toBe(1_000);
    expect(runs()).toBe(2);

    clock.t += USAGE_TTL_MS + 1;
    await t.get();
    expect(runs()).toBe(3);
  });

  it("keeps the last good reading when a run comes back empty", async () => {
    const clock = { t: 0 };
    let out: string | null = PANEL;
    const t = new UsageTracker(
      () => clock.t,
      async () => out,
    );

    await t.get();
    out = null;
    expect((await t.get(true))?.limits).toHaveLength(3);
  });

  it("answers null when there was never a reading", async () => {
    const { t } = tracker(null, { t: 0 });
    expect(await t.get()).toBeNull();
  });
});
