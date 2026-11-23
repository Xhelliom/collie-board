import { describe, expect, it } from "bun:test";

import { BoardDb } from "./db.ts";
import { GESTURE_ACK, OrchestratorNudger, gestureLine } from "./orchestrator-nudge.ts";
import { DEFAULT_BUDGET } from "./goal-routes.ts";
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
  it("leaves a halt to halted-wake.ts, which repeats it until it is heard", async () => {
    const w = world();
    w.db.recordRunEvent(w.card.id, "run.halted", { runId: w.run.id, reason: "gate rouge" });
    w.nudger.update(snap(true));
    await flush();
    expect(w.sent).toHaveLength(0);
  });

  it("does not wake on a merge still waiting on GitHub, but does on the refusal that follows", async () => {
    const w = world();
    w.db.recordRunEvent(w.card.id, "run.merge", { runId: w.run.id, merged: false, wait: true, reason: "GitHub has registered no check on this PR yet — waiting" });
    w.nudger.update(snap(true));
    await flush();
    expect(w.sent).toHaveLength(0);
    w.db.recordRunEvent(w.card.id, "run.merge", { runId: w.run.id, merged: false, reason: "the check ci failed — not merging" });
    w.nudger.update(snap(true));
    await flush();
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]).toContain("ci failed");
  });

  it("reports the end of a lot with its merged and blocked cards", async () => {
    const w = world();
    w.db.recordRunEvent(null, "run.finished", { runId: w.run.id });
    w.nudger.update(snap(true));
    await flush();
    expect(w.sent[0]).toContain("lot 1");
    expect(w.sent[0]).toContain("Bloquées ou non mergées");
  });

  it("cites the lot's tokens and the week gauge before/after — « inconnu » when a reading is missing", async () => {
    const w = world();
    w.db.recordRunEvent(null, "run.quota", { runId: w.run.id, at: "start", percent: 40 });
    w.db.recordRunEvent(null, "run.quota", { runId: w.run.id, at: "end", percent: null, tokens: 1234 });
    w.db.recordRunEvent(null, "run.finished", { runId: w.run.id });
    w.nudger.update(snap(true));
    await flush();
    expect(w.sent[0]).toContain("1");
    expect(w.sent[0]).toMatch(/Consommé : 1.234 tokens ; jauge de la semaine 40 % → inconnu .*pendant le lot/);
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
    expect(w.sent[0]).toContain("tiens la recette");
    expect(w.sent[0]).toContain("/api/recette?repo=/g/r");
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
  describe("end of a lot with nothing planned next", () => {
    const endWith = async (autonomy: { enabled: boolean; startWhenIdle: boolean } | null) => {
      const w = world();
      if (autonomy) w.db.setAutonomy("/g/r", { ...autonomy, maxChain: null, stopOnRed: false, maxRounds: 5 });
      w.db.recordRunEvent(null, "run.finished", { runId: w.run.id });
      w.nudger.update(snap(true));
      await flush();
      return w.sent[0]!;
    };

    it("autonomy off: says the bridge will refuse a launch, and to propose", async () => {
      const text = await endWith(null);
      expect(text).toContain("le bridge te refusera un lancement");
      expect(text).not.toContain("Ne lance rien");
    });

    it("autonomy on with startWhenIdle: prepare the next lot, then launch it yourself", async () => {
      const text = await endWith({ enabled: true, startWhenIdle: true });
      expect(text).toContain("Aucun lot planifié : prépare le suivant.");
      expect(text).toContain("lance-le toi-même");
      expect(text).not.toContain("Ne lance rien");
    });

    it("autonomy on without startWhenIdle: prepare it and propose it to the operator", async () => {
      const text = await endWith({ enabled: true, startWhenIdle: false });
      expect(text).toContain("Aucun lot planifié : prépare le suivant.");
      expect(text).toContain("propose-le à l'opérateur");
      expect(text).not.toContain("Ne lance rien");
    });

    it("under an active objective, neither the end of lot nor goal.created says « Ne lance rien »", async () => {
      const wake = async (type: "goal.created" | "run.finished") => {
        const w = world();
        if (type === "goal.created") {
          // goal.created only wakes with no lot of the repo open: close world()'s lot first.
          w.db.recordRunEvent(null, "run.finished", { runId: w.run.id });
          w.nudger.update(snap(true));
          await flush();
          w.sent.length = 0;
        }
        const g = w.db.createGoal({ repoPath: "/g/r", text: "v1", criteria: ["CI verte"], budget: DEFAULT_BUDGET })!;
        if (type === "goal.created") w.db.recordEvent(null, type, { goalId: g.id });
        else w.db.recordRunEvent(null, type, { runId: w.run.id });
        w.nudger.update(snap(true));
        for (let i = 0; i < 5 && !w.sent.length; i++) await flush();
        return w.sent;
      };
      const sent = [...(await wake("goal.created")), ...(await wake("run.finished"))];
      expect(sent).toHaveLength(2);
      for (const t of sent) expect(t).not.toContain("Ne lance rien");
    });
  });
});

describe("the operator's gestures reach the orchestrator", () => {
  const heard = async (w: ReturnType<typeof world>, action: string, detail: Record<string, unknown>, live = true) => {
    w.nudger.heard({ action, detail });
    w.nudger.update(snap(live));
    await flush();
  };

  it("tells a lot launched or resumed by the operator, and asks for one line back", async () => {
    const w = world();
    await heard(w, "run.launch", { runId: w.run.id });
    await heard(w, "run.resume", { runId: w.run.id, resumed: 2 });
    expect(w.sent).toHaveLength(2);
    expect(w.sent[0]).toContain("a lancé le lot « lot 1 »");
    expect(w.sent[0]).toEndWith(GESTURE_ACK);
    expect(w.sent[1]).toContain("repris (2 carte(s) relancée(s)) le lot « lot 1 »");
  });

  it("never tells the orchestrator its own gesture", async () => {
    const w = world();
    await heard(w, "run.launch", { runId: w.run.id, autonomous: true, reason: "idle" });
    await heard(w, "run.resume", { runId: w.run.id, resumed: 1, autonomous: true });
    await heard(w, "goal.edit", { goalId: "g", repoPath: "/g/r", pane: "o1" });
    expect(w.sent).toHaveLength(0);
  });

  it("sends nothing when no orchestrator lives on the repo, and does not keep it for later", async () => {
    const w = world();
    await heard(w, "run.launch", { runId: w.run.id }, false);
    w.nudger.update(snap(true));
    await flush();
    expect(w.sent).toHaveLength(0);
  });

  it("tells each move of the objective, but not one the objective's own wake already says", () => {
    const w = world();
    // No lot running on /g/s: goal.created wakes it with the plan to make — no second message.
    const idle = w.db.createGoal({ repoPath: "/g/s", text: "rien", criteria: ["ok"], budget: DEFAULT_BUDGET }, "active", null)!;
    expect(gestureLine(w.db, { action: "goal.create", detail: { goalId: idle.id, repoPath: "/g/s" } })).toBeNull();
    // « lot 1 » runs on /g/r: its end will wake it, so the objective is told now.
    const g = w.db.createGoal({ repoPath: "/g/r", text: "zéro bug", criteria: ["ok"], budget: DEFAULT_BUDGET }, "active", null)!;
    expect(gestureLine(w.db, { action: "goal.create", detail: { goalId: g.id, repoPath: "/g/r" } })?.text).toBe("L'opérateur a posé l'objectif « zéro bug ».");
    for (const [action, verb] of [["goal.edit", "modifié"], ["goal.pause", "mis en pause"], ["goal.abandon", "abandonné"], ["goal.activate", "activé"]])
      expect(gestureLine(w.db, { action: action!, detail: { goalId: g.id, repoPath: "/g/r" } })?.text).toContain(`a ${verb} l'objectif`);
    expect(gestureLine(w.db, { action: "goal.delete", detail: { goalId: "gone", repoPath: "/g/r" } })?.text).toBe("L'opérateur a retiré l'objectif suivant.");
  });

  it("tells a recette KO with the card that fixes it, and only that verdict", () => {
    const w = world();
    const fix = w.db.createCard({ title: "Corriger : a", repoPath: "/g/r" });
    const ko = gestureLine(w.db, { action: "card.check", detail: { cardId: w.card.id, stepId: "s", status: "ko", note: "rien ne s'affiche", followUp: fix.id, followUpTitle: fix.title } });
    expect(ko?.text).toBe(`Recette KO par l'opérateur sur « a » (${w.card.id}) : « rien ne s'affiche » — carte de suite « Corriger : a » (${fix.id}).`);
    expect(gestureLine(w.db, { action: "card.check", detail: { cardId: w.card.id, stepId: "s", status: "ok" } })).toBeNull();
    expect(gestureLine(w.db, { action: "card.check", detail: { cardId: w.card.id, stepId: "s", status: "ko" } })).toBeNull();
  });

  it("tells the autonomy setting, and folds two gestures of one tick into one message", async () => {
    const w = world();
    w.nudger.heard({ action: "orchestrator.autonomy", detail: { repoPath: "/g/r", enabled: true, startWhenIdle: false } });
    w.nudger.heard({ action: "card.edit", detail: { cardId: w.card.id } });
    w.nudger.heard({ action: "run.launch", detail: { runId: w.run.id } });
    w.nudger.update(snap(true));
    await flush();
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]).toContain("l'autonomie : activée, lancement quand rien ne tourne : non.");
    expect(w.sent[0]).toContain("a lancé le lot");
  });
});
