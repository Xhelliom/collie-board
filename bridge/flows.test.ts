import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BoardDb, type AgentFlow, type AgentTemplate } from "./db.ts";
import { parseFlowBody, PIPELINE_MAX, resolvePipeline } from "./flows.ts";

const tpl = (id: string) => ({ id }) as AgentTemplate;
const flow = (id: string, steps: string[]) => ({ id, steps }) as AgentFlow;
const T = [tpl("a"), tpl("b"), tpl("c")];
const F = [flow("f1", ["a", "b"]), flow("f2", ["c"]), flow("f3", ["gone"])];
const ids = (c: { templateId?: string | null; pipelineId?: string | null }, p: { templateId?: string | null; pipelineId?: string | null } | null, repo: string | null) =>
  resolvePipeline(
    { templateId: c.templateId ?? null, pipelineId: c.pipelineId ?? null },
    p && { templateId: p.templateId ?? null, pipelineId: p.pipelineId ?? null },
    repo,
    T,
    F,
  ).map((t) => t.id);

describe("resolvePipeline (ADR 0032)", () => {
  it("goes from the card to the repo: card flow, card template, phase flow, phase template, repo flow", () => {
    expect(ids({ pipelineId: "f1", templateId: "c" }, { pipelineId: "f2" }, "f2")).toEqual(["a", "b"]);
    expect(ids({ templateId: "c" }, { pipelineId: "f1" }, "f1")).toEqual(["c"]);
    expect(ids({}, { pipelineId: "f2", templateId: "a" }, "f1")).toEqual(["c"]);
    expect(ids({}, { templateId: "a" }, "f1")).toEqual(["a"]);
    expect(ids({}, null, "f1")).toEqual(["a", "b"]);
    expect(ids({}, null, null)).toEqual([]);
  });

  it("skips what no longer exists instead of failing", () => {
    expect(ids({ pipelineId: "deleted" }, { pipelineId: "f2" }, null)).toEqual(["c"]);
    expect(ids({ pipelineId: "f3" }, null, "f1")).toEqual(["a", "b"]); // a flow whose templates are all gone is no flow
    expect(ids({ templateId: "gone" }, { templateId: "b" }, null)).toEqual(["b"]);
  });
});

describe("parseFlowBody", () => {
  const known = (id: string) => id !== "nope";
  it("a create needs a name and 1 to PIPELINE_MAX existing templates", () => {
    expect(parseFlowBody({ name: " Dev ", steps: ["a"] }, true, known)).toEqual({ ok: true, value: { name: "Dev", steps: ["a"] } });
    expect(parseFlowBody({ steps: ["a"] }, true, known).ok).toBe(false);
    expect(parseFlowBody({ name: "x", steps: [] }, true, known).ok).toBe(false);
    expect(parseFlowBody({ name: "x", steps: Array(PIPELINE_MAX + 1).fill("a") }, true, known).ok).toBe(false);
    expect(parseFlowBody({ name: "x", steps: ["nope"] }, true, known).ok).toBe(false);
    expect(parseFlowBody({ description: "d" }, false, known)).toEqual({ ok: true, value: { description: "d" } });
  });
});

describe("the worker flag (ADR 0031)", () => {
  it("marks the shipped worker roles when it migrates an older database, and only then", () => {
    const dir = mkdtempSync(join(tmpdir(), "flows-worker-"));
    const file = join(dir, "board.db");
    const flags = (db: BoardDb) => Object.fromEntries(db.listTemplates().map((t) => [t.key, t.worker]));
    const first = new BoardDb(file);
    expect(flags(first)).toEqual({ implementer: true, reviewer: false, doc: true, explore: false, fix: true });
    first.close();

    // A database from before the column: drop it, then reopen.
    const raw = new Database(file);
    raw.exec("ALTER TABLE agent_template DROP COLUMN worker");
    raw.close();
    const migrated = new BoardDb(file);
    expect(flags(migrated)).toEqual({ implementer: true, reviewer: false, doc: true, explore: false, fix: true });

    // After that it is the operator's: unticking a shipped role survives a restart.
    const implementer = migrated.listTemplates().find((t) => t.key === "implementer")!;
    migrated.updateTemplate(implementer.id, { worker: false });
    migrated.close();
    expect(flags(new BoardDb(file)).implementer).toBe(false);
  });
});

describe("flows in the board", () => {
  it("ships code, doc and explore over the shipped templates, once", () => {
    const db = new BoardDb(":memory:");
    const byKey = new Map(db.listTemplates().map((t) => [t.key, t.id]));
    const code = db.listFlows().find((f) => f.key === "code")!;
    expect(code.steps).toEqual([byKey.get("implementer")!, byKey.get("reviewer")!]);
    expect(db.listFlows().map((f) => f.key).sort()).toEqual(["code", "doc", "explore"]);
  });

  it("deleting a template takes its step out of every flow that used it", () => {
    const db = new BoardDb(":memory:");
    const [a] = db.listTemplates();
    const mine = db.createTemplate({ name: "Mine", brief: "b" });
    const flow = db.createFlow({ name: "F", steps: [a!.id, mine.id, a!.id] });
    db.deleteTemplate(mine.id);
    expect(db.getFlow(flow.id)!.steps).toEqual([a!.id, a!.id]);
  });

  it("a shipped flow is edited then reset, never deleted; a custom one is released from its users when deleted", () => {
    const db = new BoardDb(":memory:");
    const code = db.listFlows().find((f) => f.key === "code")!;
    db.updateFlow(code.id, { name: "Mine", steps: [code.steps[0]!] });
    expect(db.resetFlow(code.id)).toMatchObject({ steps: code.steps });
    expect(db.deleteFlow(code.id)).toBe("builtin");

    const mine = db.createFlow({ name: "Mine", steps: [code.steps[0]!] });
    const phase = db.createPhase({ repoPath: "/r", name: "P" });
    const card = db.createCard({ title: "t", repoPath: "/r" });
    db.updatePhase(phase.id, { pipelineId: mine.id });
    db.patchCard(card.id, { pipelineId: mine.id });
    db.setRepoFlow("/r", mine.id);
    expect(db.repoFlow("/r")).toBe(mine.id);
    expect(db.deleteFlow(mine.id)).toBe("deleted");
    expect(db.getPhase(phase.id)!.pipelineId).toBeNull();
    expect(db.getCard(card.id)!.pipelineId).toBeNull();
    expect(db.repoFlow("/r")).toBeNull();
    expect(db.deleteFlow(mine.id)).toBe("missing");
  });
});
