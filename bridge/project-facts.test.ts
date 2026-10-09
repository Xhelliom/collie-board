import { describe, expect, it } from "bun:test";

import type { BoardEvent } from "./db.ts";
import { foldFacts } from "./project-facts.ts";

let n = 0;
const ev = (type: string, payload: unknown = {}, ts = ++n): BoardEvent => ({ id: ++n, cardId: "c", type, payload, ts });

describe("foldFacts", () => {
  it("reads a finished card's story out of its journal", () => {
    const f = foldFacts("c", [
      ev("session.opened", {}, 1000),
      ev("run.gate", { ok: false, command: "make" }),
      ev("run.decision", { decision: "prompt", reason: "red" }),
      ev("card.operator_said", { text: "use the helper" }),
      ev("run.gate", { ok: true, command: "make" }),
      ev("run.decision", { decision: "finished", reason: "all criteria hold" }),
      ev("review.created", { verdict: "partial" }),
      ev("run.triaged", { verdict: "partial", accept: true, reason: "false alarm" }),
      ev("card.pr_opened", { url: "https://x/pull/1" }),
      ev("card.automerge_refused", { error: "no" }),
      ev("session.closed", {}, 5000),
    ]);
    expect(f.gate).toMatchObject({ ok: true, command: "make" });
    expect(f.lead).toMatchObject({ decision: "finished", reason: "all criteria hold" });
    expect(f.sentBack).toBe(1);
    expect(f.operatorSaid).toBe(1);
    expect(f.review).toBe("partial");
    expect(f.triage).toMatchObject({ accept: true, verdict: "partial" });
    expect(f.pr).toEqual({ url: "https://x/pull/1", state: "open", autoMerge: "refused" });
    expect([f.startedAt, f.endedAt]).toEqual([1000, 5000]);
  });

  it("folds oldest first whatever order it is handed, and a merge ends the PR", () => {
    const events = [ev("card.pr_merged"), ev("card.pr_opened", { url: "u" })];
    events[0]!.id = 99;
    expect(foldFacts("c", events).pr).toEqual({ url: "u", state: "merged" });
  });

  it("an empty journal is all nulls", () => {
    expect(foldFacts("c", [])).toMatchObject({ gate: null, lead: null, pr: null, sentBack: 0, startedAt: null });
  });
});
