import { describe, expect, it } from "bun:test";

import {
  checkPrompt,
  conflictPrompt,
  toCheckDecision,
  toConflictDecision,
  toTriageDecision,
  triagePrompt,
} from "./lead.ts";

const brief = {
  title: "Add the lead",
  spec: "A second role beside the copilot.",
  acceptance: ["prompts are pure", "no path to push"],
  worktree: "/wt/card",
  base: "main",
  outPath: ".board/out/x.json",
};

describe("lead prompts", () => {
  it("check reads the checkout, never acts, and names the answer file", () => {
    const p = checkPrompt({ ...brief, statSummary: " a.ts | 3 +++" });
    expect(p).toContain("git -C /wt/card diff main...HEAD");
    expect(p).toContain("- no path to push");
    expect(p).toContain(" a.ts | 3 +++");
    expect(p).toContain("do not commit");
    expect(p).toContain(".board/out/x.json");
    expect(p).toContain('"decision": "finished | prompt"');
  });

  it("triage lists follow-ups by index, with the review's verdict and notes", () => {
    const p = triagePrompt({
      ...brief,
      verdict: "drift",
      notes: "went another way",
      followUps: [{ title: "Doc it" }, { title: "Test it", spec: "cover the parser" }],
    });
    expect(p).toContain("The review's verdict: drift");
    expect(p).toContain("went another way");
    expect(p).toContain("0. Doc it");
    expect(p).toContain("1. Test it — cover the parser");
    expect(p).toContain("keep | fold | drop");
  });

  it("conflict re-check names the conflicting files and can halt", () => {
    const p = conflictPrompt({ ...brief, conflicts: ["bridge/x.ts"] });
    expect(p).toContain("- bridge/x.ts");
    expect(p).toContain("resolved | prompt | halt");
  });

  it("check on an explore card judges the conclusion, not the diff", () => {
    const code = checkPrompt({ ...brief, statSummary: "" });
    const explore = checkPrompt({ ...brief, statSummary: "", category: "explore" });
    expect(code).toContain("every acceptance criterion holds in the code");
    expect(explore).not.toContain("every acceptance criterion holds in the code");
    expect(explore).toContain("the conclusion answers the card's question");
    expect(explore).toContain("cards it proposed are defensible");
    expect(checkPrompt({ ...brief, statSummary: "", category: "bug" })).toBe(code);
  });

  it("is pure — same input, same prompt", () => {
    expect(checkPrompt({ ...brief, statSummary: "" })).toBe(checkPrompt({ ...brief, statSummary: "" }));
  });
});

describe("lead answers", () => {
  it("parses a check", () => {
    expect(toCheckDecision({ decision: "finished", reason: "all criteria hold" })).toEqual({
      decision: "finished",
      reason: "all criteria hold",
    });
    expect(toCheckDecision({ decision: "prompt", prompt: "commit", reason: "uncommitted" })).toEqual({
      decision: "prompt",
      prompt: "commit",
      reason: "uncommitted",
    });
  });

  it("invalid JSON is an error, never a decision", () => {
    for (const bad of [null, "finished", [], 3, {}]) {
      expect(() => toCheckDecision(bad)).toThrow();
      expect(() => toConflictDecision(bad)).toThrow();
      expect(() => toTriageDecision(bad, 0)).toThrow();
    }
    expect(() => toCheckDecision({ decision: "merge", reason: "x" })).toThrow();
    expect(() => toCheckDecision({ decision: "prompt", reason: "x" })).toThrow(); // no message
    expect(() => toConflictDecision({ decision: "push", reason: "x" })).toThrow();
  });

  it("every decision carries a non-empty reason", () => {
    expect(() => toCheckDecision({ decision: "finished" })).toThrow();
    expect(() => toCheckDecision({ decision: "finished", reason: "  " })).toThrow();
    expect(() => toConflictDecision({ decision: "halt", reason: "" })).toThrow();
    expect(() => toTriageDecision({ verdict: { accept: true }, followUps: [] }, 0)).toThrow();
    expect(() =>
      toTriageDecision(
        { verdict: { accept: true, reason: "ok" }, followUps: [{ index: 0, action: "drop", reason: "" }] },
        1,
      ),
    ).toThrow();
  });

  it("triage decides every follow-up exactly once", () => {
    const ok = {
      verdict: { accept: true, reason: "drift is a better path" },
      followUps: [
        { index: 1, action: "fold", reason: "belongs here" },
        { index: 0, action: "drop", reason: "already done" },
      ],
    };
    expect(toTriageDecision(ok, 2).followUps.map((f) => f.index)).toEqual([0, 1]);
    expect(() => toTriageDecision(ok, 3)).toThrow(); // one left undecided
    expect(() => toTriageDecision(ok, 1)).toThrow(); // index 1 out of range
    const twice = { ...ok, followUps: [ok.followUps[1], ok.followUps[1]] };
    expect(() => toTriageDecision(twice, 2)).toThrow();
    const unknown = { ...ok, followUps: [{ index: 0, action: "merge", reason: "x" }] };
    expect(() => toTriageDecision(unknown, 1)).toThrow();
  });
});

describe("the lead has no path to act", () => {
  it("imports nothing but the copilot's plumbing", async () => {
    const src = await Bun.file(new URL("./lead.ts", import.meta.url)).text();
    const imports = [...src.matchAll(/from "(\.[^"]+)"/g)].map((m) => m[1]);
    expect(imports).toEqual(["./copilot.ts"]);
  });
});
