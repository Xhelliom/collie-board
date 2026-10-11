import { describe, expect, it } from "bun:test";

import { BoardDb } from "./db.ts";
import { currentStep, nextRole, pipelineOf, sendBackPrompt, stepPrompt, workerStep } from "./pipeline.ts";

describe("pipeline (ADR 0031)", () => {
  it("the next role is read from the journal: one card.pipeline_step per step already taken", () => {
    const db = new BoardDb(":memory:");
    const [a, b, c] = ["implementer", "reviewer", "fix"].map((k) => db.listTemplates().find((t) => t.key === k)!);
    const card = db.createCard({ title: "t", repoPath: "/r" });
    db.patchCard(card.id, { pipelineId: db.createFlow({ name: "F", steps: [a!.id, b!.id, c!.id] }).id });
    const pipeline = pipelineOf(db, db.getCard(card.id)!);
    expect(nextRole(pipeline, db.listEvents(card.id))?.key).toBe("reviewer");
    db.recordEvent(card.id, "card.pipeline_step", { index: 1 });
    expect(nextRole(pipeline, db.listEvents(card.id))?.key).toBe("fix");
    db.recordEvent(card.id, "card.pipeline_step", { index: 2 });
    expect(nextRole(pipeline, db.listEvents(card.id))).toBeNull();
    // Sent back to the first role: the card is on step 0 again, so the reviewer comes next once more.
    db.recordEvent(card.id, "card.pipeline_step", { index: 0 });
    expect(currentStep(db.listEvents(card.id))).toBe(0);
    expect(nextRole(pipeline, db.listEvents(card.id))?.key).toBe("reviewer");
  });

  it("a send-back goes to the nearest worker role at or before the current step", () => {
    const db = new BoardDb(":memory:");
    const t = (key: string) => db.listTemplates().find((x) => x.key === key)!;
    const [explore, impl, reviewer, fix] = [t("explore"), t("implementer"), t("reviewer"), t("fix")];
    expect([explore, impl, reviewer].map((x) => x.worker)).toEqual([false, true, false]);
    // explore → implementer → reviewer: a failure on the reviewer goes to the implementer, not the explorer.
    expect(workerStep([explore, impl, reviewer], 2)).toBe(1);
    expect(workerStep([explore, impl, reviewer], 1)).toBe(1); // already on the worker
    // implementer → reviewer → fix: before `fix` it is the implementer's, after it is `fix`'s.
    expect(workerStep([impl, reviewer, fix], 1)).toBe(0);
    expect(workerStep([impl, reviewer, fix], 2)).toBe(2);
    // No worker at or before the step: nothing to send it back to.
    expect(workerStep([explore, reviewer], 1)).toBeNull();
    expect(workerStep([reviewer, impl], 0)).toBeNull();
  });

  it("a send-back tells the first role its work is in the branch and what failed", () => {
    const db = new BoardDb(":memory:");
    const impl = db.listTemplates().find((t) => t.key === "implementer")!;
    const card = db.createCard({ title: "Add X", spec: "Do X", repoPath: "/r" });
    const text = sendBackPrompt(impl, card, "The gate failed: exit 1");
    expect(text.startsWith(impl.brief.trim())).toBe(true);
    expect(text).toContain("already in this branch");
    expect(text).toContain("The gate failed: exit 1");
  });

  it("the next role's prompt carries its brief, the card and what the step before reported", () => {
    const db = new BoardDb(":memory:");
    const reviewer = db.listTemplates().find((t) => t.key === "reviewer")!;
    const card = db.createCard({ title: "Add X", spec: "Do X", repoPath: "/r" });
    const text = stepPrompt(reviewer, card, { name: "Implementer", report: "added 3 tests" });
    expect(text.startsWith(reviewer.brief.trim())).toBe(true);
    expect(text).toContain("Do X");
    expect(text).toContain("The previous step (Implementer) reported:\n\nadded 3 tests");
    expect(stepPrompt(reviewer, card, { name: "Implementer", report: null })).toContain("left no report");
  });
});
