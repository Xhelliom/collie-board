import { describe, expect, it } from "bun:test";

import { sinceChanges, type SinceInput } from "./since.ts";

const REPO = "/r";
const line = (ts: number, action: string, detail: Record<string, unknown>) => JSON.stringify({ ts: new Date(ts).toISOString(), action, detail });
const base = (over: Partial<SinceInput>): SinceInput => ({
  auditLines: [],
  events: [],
  repo: REPO,
  pane: "orch",
  since: 1_000,
  repoOf: (d) => (d.cardId === "c1" ? REPO : d.cardId === "x" ? "/other" : null),
  labelOf: (d) => (d.cardId === "c1" ? "Ma carte" : null),
  ...over,
});

describe("sinceChanges", () => {
  it("says nothing and keeps the cursor when nothing moved", () => {
    expect(sinceChanges(base({}))).toEqual({ cursor: 1_000, count: 0, summary: "" });
  });

  it("keeps the repo's gestures newer than the cursor, minus the orchestrator's own", () => {
    const r = sinceChanges(
      base({
        auditLines: [
          line(900, "card.patch", { cardId: "c1" }), // before the cursor
          line(2_000, "card.patch", { cardId: "c1", status: "todo" }),
          line(3_000, "card.patch", { cardId: "c1", pane: "orch" }), // its own
          line(4_000, "card.create", { cardId: "x", title: "ailleurs" }), // another repo
          line(5_000, "roadmap.decision", { repoPath: REPO, id: "d1", status: "decided" }),
          line(6_000, "orchestrator.memory", { repoPath: REPO }),
          line(7_000, "card.create", { cardId: "c2", title: "Par un agent", pane: "p9" }),
          "{partial",
        ],
        repoOf: (d) => (d.cardId === "c1" || d.cardId === "c2" ? REPO : d.cardId === "x" ? "/other" : null),
        events: [{ id: 1, cardId: "c1", type: "card.pr_merged", payload: { url: "u" }, ts: 8_000 }],
      }),
    );
    expect(r.count).toBe(4);
    expect(r.cursor).toBe(8_000);
    expect(r.summary).toContain('card.patch « Ma carte » {"status":"todo"}');
    expect(r.summary).toContain("roadmap.decision");
    expect(r.summary).toContain("card.create « Par un agent » (agent p9)");
    expect(r.summary).toContain("card.pr_merged « Ma carte »");
    expect(r.summary).not.toContain("ailleurs");
    expect(r.summary).not.toContain("orchestrator.memory");
  });
});
