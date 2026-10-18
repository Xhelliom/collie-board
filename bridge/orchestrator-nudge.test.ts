import { describe, expect, it } from "bun:test";

import { BoardDb } from "./db.ts";
import { OrchestratorNudger } from "./orchestrator-nudge.ts";
import type { EngineSnapshot } from "./state-engine.ts";

const flush = () => new Promise((r) => setTimeout(r, 0));
const snap = (live: boolean, bridge = "connected") =>
  ({
    bridge,
    shellPanes: [],
    agents: live ? [{ paneId: "o1", workspaceLabel: "orchestrator-r", cwd: "/g/r", status: "idle" }] : [],
  }) as unknown as EngineSnapshot;

function world(prState?: (c: { id: string }) => Promise<{ state: string } | null>) {
  const db = new BoardDb(":memory:");
  const sent: string[] = [];
  const herdr = {
    getAgent: async () => ({ interactive_ready: true, agent_status: "idle" }),
    promptAgent: async (o: { target: string; text: string }) => void sent.push(o.text),
    sendPaneKeys: async () => {},
  } as never;
  const nudger = new OrchestratorNudger(db, herdr, undefined, prState as never);
  const card = db.createCard({ title: "a", repoPath: "/g/r", status: "ready" });
  const run = db.createRun({ repoPath: "/g/r", cardIds: [card.id], foldInCap: 0, name: "lot 1" });
  return { db, sent, nudger, card, run };
}

describe("OrchestratorNudger (ADR 0028)", () => {
  it("tells the orchestrator once when the lead halts a card, even if it says so twice", async () => {
    const w = world();
    w.db.recordRunEvent(w.card.id, "run.halted", { runId: w.run.id, reason: "gate rouge" });
    w.db.recordRunEvent(w.card.id, "run.halted", { runId: w.run.id, reason: "gate rouge" });
    w.nudger.update(snap(true));
    await flush();
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]).toContain("gate rouge");
  });

  it("reports the end of a lot with its merged and blocked cards", async () => {
    const w = world();
    w.db.recordRunEvent(null, "run.finished", { runId: w.run.id });
    w.nudger.update(snap(true));
    await flush();
    expect(w.sent[0]).toContain("lot 1");
    expect(w.sent[0]).toContain("Bloquées ou non mergées");
  });

  it("lists a card merged when GitHub says its PR is MERGED, even halted in the journal", async () => {
    const w = world(async () => ({ state: "merged" }));
    w.db.patchCard(w.card.id, { status: "done", branch: "b" });
    w.db.recordRunEvent(w.card.id, "run.halted", { runId: w.run.id, reason: "x" });
    w.db.recordRunEvent(null, "run.finished", { runId: w.run.id });
    w.nudger.update(snap(true));
    await flush();
    const msg = w.sent.find((m) => m.includes("est terminé"))!;
    expect(msg).toContain("Mergées :");
    expect(msg).not.toContain("Bloquées ou non mergées");
  });

  it("falls back on the journal when GitHub cannot be reached", async () => {
    const w = world(async () => {
      throw new Error("offline");
    });
    w.db.patchCard(w.card.id, { status: "done", branch: "b" });
    w.db.recordRunEvent(null, "run.finished", { runId: w.run.id });
    w.nudger.update(snap(true));
    await flush();
    expect(w.sent[0]).toContain("Mergées :");
  });

  it("asks for a short bilan citing facts, and proposes validating the phase when it ends", async () => {
    const w = world();
    const ph = w.db.createPhase({ repoPath: "/g/r", name: "Phase 1" });
    w.db.patchCard(w.card.id, { status: "done", phaseId: ph.id });
    const run = w.db.createRun({ repoPath: "/g/r", cardIds: [w.card.id], foldInCap: 0, phaseId: ph.id });
    w.db.recordRunEvent(null, "run.finished", { runId: run.id });
    w.nudger.update(snap(true));
    await flush();
    expect(w.sent[0]).toContain("/api/project/facts?repo=/g/r");
    expect(w.sent[0]).toContain("fin de la phase « Phase 1 »");
    expect(w.sent[0]).toContain("pas à toi");
  });

  it("tells the orchestrator when the operator validates or reopens a phase, and where the open steps went", async () => {
    const w = world();
    const ph = w.db.createPhase({ repoPath: "/g/r", name: "Phase 1" });
    const next = w.db.createPhase({ repoPath: "/g/r", name: "Phase 2" });
    w.db.recordEvent(null, "phase.closed", { phaseId: ph.id, moveOpenTo: next.id });
    w.db.recordEvent(null, "phase.reopened", { phaseId: ph.id });
    w.nudger.update(snap(true));
    await flush();
    expect(w.sent[0]).toContain("« Phase 1 » a été validée par l'opérateur");
    expect(w.sent[0]).toContain("allées dans la phase « Phase 2 »");
    expect(w.sent[0]).toContain("découpage de la phase suivante");
    expect(w.sent[1]).toContain("rouverte");
  });

  it("sends nothing, and does not throw, with no live orchestrator or on a disconnected snapshot", async () => {
    const w = world();
    w.db.recordRunEvent(null, "run.finished", { runId: w.run.id });
    w.nudger.update(snap(true, "disconnected"));
    w.nudger.update(snap(false));
    await flush();
    expect(w.sent).toHaveLength(0);
  });
});
