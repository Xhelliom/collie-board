import { describe, expect, it } from "bun:test";

import { BoardDb } from "./db.ts";
import { nextRole, pipelineOf, stepPrompt } from "./pipeline.ts";

describe("pipeline (ADR 0031)", () => {
  it("the next role is read from the journal: one card.pipeline_step per step already taken", () => {
    const db = new BoardDb(":memory:");
    const [a, b, c] = ["implementer", "reviewer", "fix"].map((k) => db.listTemplates().find((t) => t.key === k)!);
    const card = db.createCard({ title: "t", repoPath: "/r" });
    db.patchCard(card.id, { pipelineId: db.createFlow({ name: "F", steps: [a!.id, b!.id, c!.id] }).id });
    const pipeline = pipelineOf(db, db.getCard(card.id)!);
    expect(nextRole(pipeline, db.listEvents(card.id))?.key).toBe("reviewer");
    db.recordEvent(card.id, "card.pipeline_step", {});
    expect(nextRole(pipeline, db.listEvents(card.id))?.key).toBe("fix");
    db.recordEvent(card.id, "card.pipeline_step", {});
    expect(nextRole(pipeline, db.listEvents(card.id))).toBeNull();
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
