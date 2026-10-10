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

function world() {
  const db = new BoardDb(":memory:");
  const sent: string[] = [];
  const herdr = {
    getAgent: async () => ({ interactive_ready: true, agent_status: "idle" }),
    promptAgent: async (o: { target: string; text: string }) => void sent.push(o.text),
    sendPaneKeys: async () => {},
  } as never;
  const nudger = new OrchestratorNudger(db, herdr);
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

  it("sends nothing, and does not throw, with no live orchestrator or on a disconnected snapshot", async () => {
    const w = world();
    w.db.recordRunEvent(null, "run.finished", { runId: w.run.id });
    w.nudger.update(snap(true, "disconnected"));
    w.nudger.update(snap(false));
    await flush();
    expect(w.sent).toHaveLength(0);
  });
});
