import { describe, expect, it } from "bun:test";

import type { Config } from "./config.ts";
import { BoardDb } from "./db.ts";
import type { HerdrClient } from "./herdr-client.ts";
import { advancePipeline, currentStep, nextRole, pipelineOf, sendBackPrompt, sendBackToWorker, stepPrompt, workerStep } from "./pipeline.ts";

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

// A herdr that records what the swap asked of it. `failStart` makes `agent.start` refuse.
function fakeHerdr(opts: { failStart?: boolean } = {}) {
  const starts: { paneId: string; kind: string; args?: string[] }[] = [];
  const closed: string[] = [];
  let tabs = 0;
  const client = {
    async createTab() {
      return { paneId: `w1:p${++tabs + 1}` };
    },
    async closePane(paneId: string) {
      closed.push(paneId);
    },
    async startAgent(o: { paneId: string; kind: string; args?: string[] }) {
      if (opts.failStart) throw new Error("agent never became ready");
      starts.push(o);
    },
    async getAgent() {
      return { interactive_ready: true, agent_status: "working" };
    },
    async promptAgent() {},
    async sendPaneKeys() {},
  } as unknown as HerdrClient;
  return { client, starts, closed };
}

const cfg = { boardAgentKind: "claude" } as Config;
const noWait = async () => {};

/** A card on step 0 of implementer (kind default) → reviewer (codex, with a model codex cannot take). */
function pipelineCard() {
  const db = new BoardDb(":memory:");
  const t = (key: string) => db.listTemplates().find((x) => x.key === key)!;
  const reviewer = db.updateTemplate(t("reviewer").id, { agentKind: "codex", model: "sonnet" })!;
  const card = db.createCard({ title: "t" });
  db.patchCard(card.id, { pipelineId: db.createFlow({ name: "F", steps: [t("implementer").id, reviewer.id] }).id, workspaceId: "w1", branch: "board/t" });
  const session = db.openSession({ cardId: card.id, paneId: "w1:p1", agentKind: "claude" });
  return { db, card: db.getCard(card.id)!, session, reviewer };
}

describe("advancing a pipeline", () => {
  it("the next role runs with its own kind, not the one the first role ran with (ADR 0026)", async () => {
    const { db, card, session, reviewer } = pipelineCard();
    const h = fakeHerdr();
    await advancePipeline(db, h.client, cfg, card, session, reviewer, "done", undefined, noWait);
    expect(h.starts).toHaveLength(1);
    expect(h.starts[0]!.kind).toBe("codex");
    expect(h.starts[0]!.args).toBeUndefined(); // codex has no model flag: the template's model is not passed
    expect(h.closed).toEqual(["w1:p1"]);
    expect(db.openSessionFor(card.id)?.agentKind).toBe("codex");
    expect(currentStep(db.listEvents(card.id))).toBe(1);
    expect(db.getCard(card.id)!.status).toBe("working");
  });

  it("an explicit kind on the card still wins over the role's", async () => {
    const { db, card, session, reviewer } = pipelineCard();
    db.patchCard(card.id, { agentKind: "opencode" });
    const h = fakeHerdr();
    await advancePipeline(db, h.client, cfg, db.getCard(card.id)!, session, reviewer, null, undefined, noWait);
    expect(h.starts[0]!.kind).toBe("opencode");
  });

  it("a launch that fails counts no step and leaves no session on the shell pane; a retry resumes the same step", async () => {
    const { db, card, session, reviewer } = pipelineCard();
    await expect(advancePipeline(db, fakeHerdr({ failStart: true }).client, cfg, card, session, reviewer, "done", undefined, noWait)).rejects.toThrow(/agent.start/);
    expect(db.openSessionFor(card.id)).toBeNull();
    expect(currentStep(db.listEvents(card.id))).toBe(0);
    expect(db.getCard(card.id)!.status).toBe("ready");
    expect(db.listEvents(card.id).some((e) => e.type === "card.start_failed")).toBe(true);
    // Restarted (the journal is all there is): the same role is still next, and taking it counts step 1.
    expect(nextRole(pipelineOf(db, card), db.listEvents(card.id))?.id).toBe(reviewer.id);
    const again = db.openSession({ cardId: card.id, paneId: "w1:p9", agentKind: "claude" });
    await advancePipeline(db, fakeHerdr().client, cfg, card, again, reviewer, "done", undefined, noWait);
    expect(currentStep(db.listEvents(card.id))).toBe(1);
    expect(nextRole(pipelineOf(db, card), db.listEvents(card.id))).toBeNull();
  });

  it("a send-back goes to the worker role's own kind", async () => {
    const { db, card, session } = pipelineCard();
    db.recordEvent(card.id, "card.pipeline_step", { index: 1 });
    const h = fakeHerdr();
    await sendBackToWorker(db, h.client, cfg, card, session, 0, "gate failed", undefined, noWait);
    expect(h.starts[0]!.kind).toBe("claude");
    expect(currentStep(db.listEvents(card.id))).toBe(0);
  });
});
