import { describe, expect, it } from "bun:test";

import { BoardDb, isMaxParallel, type Card } from "./db.ts";
import type { GateResult } from "./gate.ts";
import type { GitRunner, PrStatus } from "./git.ts";
import { mergeWhenReady, notePrOutcome } from "./integrate.ts";
import type { CheckDecision, ConflictDecision, TriageDecision } from "./lead.ts";
import { checkPrompt } from "./lead.ts";
import { currentStep } from "./pipeline.ts";
import { briefOf, MAX_ROUNDS, RunCoordinator, runState, type RunPorts } from "./run.ts";
import type { EngineSnapshot } from "./state-engine.ts";

const snap = (panes: Record<string, string> = {}, bridge = "connected"): EngineSnapshot =>
  ({
    agents: Object.entries(panes).map(([paneId, status]) => ({ paneId, status })),
    shellPanes: [],
    workspaces: [],
    tabs: [],
    bridge,
  }) as unknown as EngineSnapshot;

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

/** A fake world: every port records its call; the lead answers from a queue. */
function world(
  db: BoardDb,
  opts: { slots?: number; reviewing?: boolean; stat?: string; report?: string | null; merge?: object; onLand?: (c: Card) => void; clock?: { now: number } } = {},
) {
  const calls: string[] = [];
  const checks: CheckDecision[] = [];
  const triages: TriageDecision[] = [];
  const rechecks: ConflictDecision[] = [];
  const seen: { workerReport?: string | null }[] = [];
  let pr: Awaited<ReturnType<RunPorts["openPr"]>> = { ok: true };
  let gate: string | null = null;
  let commits: number | null = 1;
  const gates: GateResult[] = [];
  /** What `fold` answers, oldest first; empty = it folded. */
  const folds: Awaited<ReturnType<RunPorts["fold"]>>[] = [];
  /** What GitHub says of a predecessor's PR when the coordinator asks (`refreshPr`). */
  let predPr: PrStatus | null = null;
  const clock = opts.clock ?? { now: 1_000_000_000_000 };
  const ports: RunPorts = {
    lead: {
      check: async (i) => (seen.push(i), checks.shift() ?? { decision: "finished", reason: "ok" }) ?? { decision: "finished", reason: "ok" },
      triage: async () => triages.shift()!,
      recheckConflict: async () => rechecks.shift()!,
    },
    start: async (id) => {
      calls.push(`start ${db.getCard(id)!.title}`);
      db.openSession({ cardId: id, paneId: `p-${db.getCard(id)!.title}` });
      db.setStatus(id, "working", "agent working");
      return { ok: true };
    },
    prepareLot: async (_run, c) => (calls.push(`lot ${c.title}`), { ok: true }),
    fold: async (_run, c) => {
      const r = folds.shift() ?? { ok: true };
      calls.push(`fold ${c.title}${r.ok ? "" : " " + r.error.kind}`);
      return r;
    },
    prompt: async (pane, text) => void calls.push(`prompt ${pane} ${text}`),
    openPr: async (c) => {
      calls.push(`pr ${c.title}`);
      if (pr.ok) db.recordEvent(c.id, "card.pr_opened", {});
      // What `landPr` leaves: GitHub's auto-merge armed, or — refused — the board's `run.merge` answer.
      if (pr.ok && opts.merge) db.recordRunEvent(c.id, "run.merge", { runId: db.getCard(c.id)!.runId!, merged: false, reason: "ci", ...opts.merge });
      else if (pr.ok) db.recordEvent(c.id, "card.automerge_armed", {});
      return pr;
    },
    land: async (c) => {
      calls.push(`land ${c.title}`);
      opts.onLand?.(c);
    },
    refreshPr: async (c) => {
      calls.push(`refresh ${c.title}`);
      notePrOutcome(db, c.id, predPr);
    },
    resolveConflict: async (c) => {
      calls.push(`resolve ${c.title}`);
      db.recordEvent(c.id, "card.resolve_requested", {});
      return { ok: true };
    },
    fileAsDone: (c) => {
      calls.push(`done ${c.title}`);
      db.closeSession(db.openSessionFor(c.id)!.id, "done");
      db.setStatus(c.id, "done", "manual");
    },
    gateCommand: () => gate,
    runGate: async (cmd) => {
      calls.push(`gate ${cmd}`);
      return gates.shift() ?? { kind: "pass" };
    },
    brief: async (c) => ({ title: c.title, spec: c.spec, acceptance: c.acceptance, worktree: "/wt", base: "main" }),
    stat: async () => opts.stat ?? "a.ts | 1 +",
    report: async () => opts.report ?? null,
    freeSlots: () => (opts.slots ?? 3) - db.listOpenSessions().length,
    reviewing: () => opts.reviewing ?? false,
    commits: async () => commits,
    lastReply: async () => "bilan du worker",
    advance: async (c, role, report) => {
      calls.push(`advance ${c.title} ${role.key} ${report ?? "-"}`);
      db.closeSession(db.openSessionFor(c.id)!.id, "pipeline");
      db.openSession({ cardId: c.id, paneId: `p-${c.title}-${role.key}` });
      db.recordEvent(c.id, "card.pipeline_step", { templateId: role.id, index: currentStep(db.listEvents(c.id, 200)) + 1 });
      db.setStatus(c.id, "working", "pipeline");
    },
    sendBack: async (c, failure, index) => {
      calls.push(`sendBack ${c.title} ${failure}`);
      db.closeSession(db.openSessionFor(c.id)!.id, "pipeline");
      db.openSession({ cardId: c.id, paneId: `p-${c.title}-first` });
      db.recordEvent(c.id, "card.pipeline_step", { templateId: "first", index });
      db.setStatus(c.id, "working", "pipeline");
    },
  };
  return {
    calls,
    checks,
    seen,
    triages,
    rechecks,
    setPr: (r: typeof pr) => (pr = r),
    setGate: (cmd: string | null) => (gate = cmd),
    setCommits: (n: number | null) => (commits = n),
    setPredPr: (p: PrStatus | null) => (predPr = p),
    clock,
    gates,
    folds,
    coord: new RunCoordinator(db, ports, () => clock.now),
    ports,
  };
}

const land = (db: BoardDb, card: Card) => db.setStatus(card.id, "review", "agent done");
const events = (db: BoardDb, card: Card, type: string) => db.listEvents(card.id).filter((e) => e.type === type);

describe("RunCoordinator (ADR 0017)", () => {
  it("does nothing on a disconnected snapshot", async () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/r", status: "ready" });
    db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 0 });
    const w = world(db);
    w.coord.update(snap({}, "disconnected"));
    await flush();
    expect(w.calls).toEqual([]);
  });

  it("never touches a card outside a run", async () => {
    const db = new BoardDb(":memory:");
    const out = db.createCard({ title: "out", repoPath: "/r", status: "ready" });
    const inRun = db.createCard({ title: "in", repoPath: "/r", status: "ready" });
    db.createRun({ repoPath: "/r", cardIds: [inRun.id], foldInCap: 0 });
    const w = world(db);
    w.coord.update(snap());
    await flush();
    expect(w.calls).toEqual(["start in"]);
    expect(db.getCard(out.id)!.status).toBe("ready");
  });

  it("starts in dependency order, no more than the free slots", async () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/r", status: "ready", position: 0 });
    const b = db.createCard({ title: "b", repoPath: "/r", status: "ready", dependsOn: a.id, position: 1 });
    const c = db.createCard({ title: "c", repoPath: "/r", status: "ready", position: 2 });
    const d = db.createCard({ title: "d", repoPath: "/r", status: "ready", position: 3 });
    db.createRun({ repoPath: "/r", cardIds: [a.id, b.id, c.id, d.id], foldInCap: 0 });
    const w = world(db, { slots: 2 });
    w.coord.update(snap());
    w.coord.update(snap()); // a second tick while the starts are in flight starts nothing more
    await flush();
    expect(w.calls).toEqual(["start a", "start c"]);

    // a is filed: b becomes startable and takes the slot a freed.
    w.ports.fileAsDone(db.getCard(a.id)!);
    w.calls.length = 0;
    w.coord.update(snap());
    await flush();
    expect(w.calls).toEqual(["start b"]);
  });

  it("an empty diff with no bilan goes back asking for it, without spending the lead", async () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/r", status: "ready" });
    db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 0 });
    const w = world(db, { stat: "(no changes)" });
    w.coord.update(snap());
    await flush();
    land(db, a);
    w.coord.update(snap({ "p-a": "idle" }));
    await flush();
    expect(w.seen).toHaveLength(0);
    expect(w.calls.at(-1)).toContain(".board/bilan.md");
    expect(events(db, a, "run.decision")[0]!.payload).toMatchObject({ decision: "prompt", reason: "empty diff and no bilan from the worker" });
  });

  it("an empty diff with a bilan reaches the lead, which can finish without a round", async () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/r", status: "ready" });
    db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 0 });
    const w = world(db, { stat: "(no changes)", report: "déjà sur main: abc123" });
    w.coord.update(snap());
    await flush();
    land(db, a);
    w.checks.push({ decision: "finished", reason: "abc123 is on main" });
    w.coord.update(snap({ "p-a": "idle" }));
    await flush();
    expect(w.seen[0]!.workerReport).toBe("déjà sur main: abc123");
    expect(events(db, a, "run.decision")[0]!.payload).toMatchObject({ decision: "finished", reason: "abc123 is on main" });
  });

  it("check → prompt the worker; check → finished → PR → filed; then the run finishes", async () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/r", status: "ready" });
    const run = db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 0 });
    const w = world(db);
    w.coord.update(snap());
    await flush();

    land(db, a);
    w.checks.push({ decision: "prompt", prompt: "commit", reason: "not committed" });
    w.coord.update(snap({ "p-a": "idle" }));
    await flush();
    expect(w.calls.at(-1)).toBe("prompt p-a commit");
    // Same landing, already judged: no second question.
    w.coord.update(snap({ "p-a": "idle" }));
    await flush();
    expect(events(db, a, "run.decision")).toHaveLength(1);

    db.setStatus(a.id, "working", "agent working");
    land(db, a);
    w.coord.update(snap({ "p-a": "done" }));
    await flush();
    expect(events(db, a, "run.decision")[0]!.payload).toMatchObject({ decision: "finished", reason: "ok" });
    w.coord.update(snap({ "p-a": "done" }));
    await flush();
    expect(w.calls.slice(-2)).toEqual(["pr a", "done a"]);

    w.coord.update(snap());
    await flush();
    expect(db.listOpenRuns()).toEqual([]);
    expect(runState(run, [{ card: db.getCard(a.id)!, events: db.listEvents(a.id) }])).toBe("finished");
  });

  it("never answers a blocked worker", async () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/r" });
    db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 0 });
    db.openSession({ cardId: a.id, paneId: "p" });
    db.setStatus(a.id, "blocked", "agent blocked");
    const w = world(db);
    w.coord.update(snap({ p: "blocked" }));
    await flush();
    // In review yet the pane shows a prompt: still not ours.
    land(db, a);
    w.coord.update(snap({ p: "blocked" }));
    await flush();
    expect(w.calls).toEqual([]);
    expect(db.listEvents(a.id).some((e) => e.type.startsWith("run."))).toBe(false);
  });

  it(`halts a card after ${MAX_ROUNDS} rounds without finished, and the run reads halted`, async () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/r" });
    const run = db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 0 });
    db.openSession({ cardId: a.id, paneId: "p" });
    const w = world(db);
    for (let i = 0; i < MAX_ROUNDS + 1; i++) {
      db.setStatus(a.id, "working", "agent working");
      land(db, a);
      w.checks.push({ decision: "prompt", prompt: `round ${i}`, reason: "still missing" });
      w.coord.update(snap({ p: "idle" }));
      await flush();
    }
    expect(w.calls.filter((c) => c.startsWith("prompt"))).toHaveLength(MAX_ROUNDS);
    expect(events(db, a, "run.halted")[0]!.payload).toMatchObject({ runId: run.id });
    expect(runState(run, [{ card: db.getCard(a.id)!, events: db.listEvents(a.id) }])).toBe("halted");
    // Halted: the next tick asks nothing.
    w.coord.update(snap({ p: "idle" }));
    await flush();
    expect(w.calls.filter((c) => c.startsWith("prompt"))).toHaveLength(MAX_ROUNDS);
  });

  const emptyRound = async (db: BoardDb, a: Card, w: ReturnType<typeof world>, n: number) => {
    for (let i = 0; i < n; i++) {
      db.setStatus(a.id, "working", "agent working");
      land(db, a);
      w.checks.push({ decision: "prompt", prompt: `round ${i}`, reason: "rien n'est commité" });
      w.coord.update(snap({ p: "idle" }));
      await flush();
    }
  };

  it("limit reached on a branch with no commit: halted to the operator with the lead's reason and the worker's reply", async () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/r" });
    db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 0 });
    db.openSession({ cardId: a.id, paneId: "p" });
    const w = world(db);
    w.setCommits(0);
    await emptyRound(db, a, w, MAX_ROUNDS + 1);
    const reason = (events(db, a, "run.halted")[0]!.payload as { reason: string }).reason;
    expect(reason).toContain("rien n'est commité");
    expect(reason).toContain("bilan du worker");
    expect(db.getCard(a.id)!.status).not.toBe("done");
  });

  it("a finished verdict on a branch with no commit halts instead of filing", async () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/r" });
    db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 0 });
    db.openSession({ cardId: a.id, paneId: "p" });
    const w = world(db);
    w.setCommits(0);
    land(db, a);
    w.coord.update(snap({ p: "idle" }));
    await flush();
    expect(events(db, a, "run.halted")).toHaveLength(1);
    expect(w.calls).toEqual([]);
  });

  it("an explore card without code is not blocked", async () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/r", category: "explore" });
    db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 0 });
    db.openSession({ cardId: a.id, paneId: "p" });
    const w = world(db);
    w.setCommits(0);
    land(db, a);
    w.coord.update(snap({ p: "idle" }));
    await flush();
    expect(events(db, a, "run.halted")).toHaveLength(0);
    expect(events(db, a, "run.decision")[0]!.payload).toMatchObject({ decision: "finished" });
  });

  it("an unknown commit count never blocks", async () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/r" });
    db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 0 });
    db.openSession({ cardId: a.id, paneId: "p" });
    const w = world(db);
    w.setCommits(null);
    land(db, a);
    w.coord.update(snap({ p: "idle" }));
    await flush();
    expect(events(db, a, "run.halted")).toHaveLength(0);
  });

  it("folds follow-ups up to the cap; past it a follow-up stays out of the run; drop deletes", async () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/r" });
    const run = db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 1 });
    const s = db.openSession({ cardId: a.id, paneId: "p" });
    const f = ["f0", "f1", "f2"].map((t) => db.createCard({ title: t, repoPath: "/r", status: "backlog" }));
    db.createReview({ cardId: a.id, sessionId: s.id, verdict: "drift", todos: f.map((c) => ({ title: c.title, cardId: c.id })) });
    land(db, a);
    const w = world(db, { reviewing: true });
    w.coord.update(snap({ p: "idle" })); // check → finished
    await flush();
    w.triages.push({
      verdict: { accept: true, reason: "better path" },
      followUps: [
        { index: 0, action: "fold", reason: "belongs here" },
        { index: 1, action: "fold", reason: "also" },
        { index: 2, action: "drop", reason: "invented" },
      ],
    });
    w.coord.update(snap({ p: "idle" })); // triage
    await flush();
    expect(db.getCard(f[0]!.id)!.runId).toBe(run.id);
    expect(db.getCard(f[1]!.id)!.runId).toBeNull();
    expect(events(db, f[1]!, "run.decision")[0]!.payload).toMatchObject({ decision: "keep" });
    expect(db.getCard(f[2]!.id)).toBeNull();
    expect(events(db, a, "run.triaged")[0]!.payload).toMatchObject({ accept: true, verdict: "drift" });
    w.coord.update(snap({ p: "idle" })); // PR
    await flush();
    expect(w.calls).toContain("pr a");
  });

  it("a conflict goes to the worker, and its next landing is a re-check", async () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/r" });
    db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 0 });
    db.openSession({ cardId: a.id, paneId: "p" });
    land(db, a);
    const w = world(db);
    w.coord.update(snap({ p: "idle" }));
    await flush();
    w.setPr({ ok: false, error: { kind: "conflict", message: "x" } });
    db.recordEvent(a.id, "card.pr_failed", { stage: "conflict", files: ["a.ts"] });
    w.coord.update(snap({ p: "idle" }));
    await flush();
    expect(w.calls.slice(-2)).toEqual(["pr a", "resolve a"]);

    w.setPr({ ok: true });
    db.setStatus(a.id, "working", "agent working");
    land(db, a);
    w.rechecks.push({ decision: "resolved", reason: "clean" });
    w.coord.update(snap({ p: "idle" }));
    await flush();
    w.coord.update(snap({ p: "idle" }));
    await flush();
    expect(w.calls.slice(-2)).toEqual(["pr a", "done a"]);
  });

  describe("a card's pipeline (ADR 0031)", () => {
  it("a finished step hands the branch to the next role before the PR; the last role's landing goes on to the PR", async () => {
    const db = new BoardDb(":memory:");
    const roles = db.listTemplates();
    const id = (key: string) => roles.find((t) => t.key === key)!.id;
    const a = db.createCard({ title: "a", repoPath: "/r", status: "ready" });
    db.patchCard(a.id, { pipelineId: db.createFlow({ name: "F", steps: [id("implementer"), id("reviewer")] }).id });
    db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 0 });
    const w = world(db, { report: "tests added" });
    w.coord.update(snap());
    await flush();

    land(db, a);
    w.coord.update(snap({ "p-a": "idle" }));
    await flush();
    w.coord.update(snap({ "p-a": "idle" }));
    await flush();
    expect(w.calls.filter((c) => c.startsWith("advance"))).toEqual(["advance a reviewer tests added"]);
    expect(w.calls.some((c) => c.startsWith("pr "))).toBe(false);

    // The reviewer lands: judged afresh, and with nothing after it the card goes to the PR.
    land(db, a);
    w.coord.update(snap({ "p-a-reviewer": "idle" }));
    await flush();
    w.coord.update(snap({ "p-a-reviewer": "idle" }));
    await flush();
    expect(w.calls.slice(-2)).toEqual(["pr a", "done a"]);
    expect(w.calls.filter((c) => c.startsWith("advance"))).toHaveLength(1);
  });

  it("a red gate after the reviewer took over goes back to the FIRST role, which is then reviewed again", async () => {
    const db = new BoardDb(":memory:");
    const roles = db.listTemplates();
    const id = (key: string) => roles.find((t) => t.key === key)!.id;
    const a = db.createCard({ title: "a", repoPath: "/r", status: "ready" });
    db.patchCard(a.id, { pipelineId: db.createFlow({ name: "F", steps: [id("implementer"), id("reviewer")] }).id });
    db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 0 });
    const w = world(db);
    w.setGate("gate");
    const tick = async (pane: string) => {
      for (let i = 0; i < 3; i++) {
        w.coord.update(snap({ [pane]: "idle" }));
        await flush();
      }
    };
    w.coord.update(snap());
    await flush();

    land(db, a);
    await tick("p-a"); // gate green, finished → the reviewer takes the branch
    expect(w.calls.filter((c) => c.startsWith("advance"))).toHaveLength(1);

    w.gates.push({ kind: "fail", exit: 1, summary: "red" });
    land(db, a);
    await tick("p-a-reviewer"); // red: back to the first role, not to the reviewer
    expect(w.calls.some((c) => c.startsWith("sendBack a"))).toBe(true);
    expect(w.calls.some((c) => c.startsWith("prompt p-a-reviewer"))).toBe(false);

    land(db, a);
    await tick("p-a-first"); // fixed: judged afresh and handed to the reviewer again
    expect(w.calls.filter((c) => c.startsWith("advance"))).toHaveLength(2);
  });

  it("the lead's correction after the reviewer took over goes to the FIRST role too", async () => {
    const db = new BoardDb(":memory:");
    const roles = db.listTemplates();
    const id = (key: string) => roles.find((t) => t.key === key)!.id;
    const a = db.createCard({ title: "a", repoPath: "/r", status: "ready" });
    db.patchCard(a.id, { pipelineId: db.createFlow({ name: "F", steps: [id("implementer"), id("reviewer")] }).id });
    db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 0 });
    const w = world(db);
    const tick = async (pane: string) => {
      for (let i = 0; i < 3; i++) {
        w.coord.update(snap({ [pane]: "idle" }));
        await flush();
      }
    };
    w.coord.update(snap());
    await flush();
    land(db, a);
    await tick("p-a"); // finished → the reviewer takes the branch
    w.checks.push({ decision: "prompt", prompt: "fix the race in eat", reason: "the review found a defect" });
    land(db, a);
    await tick("p-a-reviewer");
    expect(w.calls.some((c) => c === "sendBack a fix the race in eat")).toBe(true);
    expect(w.calls.some((c) => c.startsWith("prompt p-a-reviewer"))).toBe(false);
  });

  it("with a non-worker first role, a send-back goes to the worker, not to the first step", async () => {
    const db = new BoardDb(":memory:");
    const roles = db.listTemplates();
    const id = (key: string) => roles.find((t) => t.key === key)!.id;
    const a = db.createCard({ title: "a", repoPath: "/r", status: "ready" });
    db.patchCard(a.id, { pipelineId: db.createFlow({ name: "F", steps: [id("explore"), id("implementer"), id("reviewer")] }).id });
    db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 0 });
    const w = world(db);
    const tick = async (pane: string) => {
      for (let i = 0; i < 3; i++) {
        w.coord.update(snap({ [pane]: "idle" }));
        await flush();
      }
    };
    w.coord.update(snap());
    await flush();
    land(db, a);
    await tick("p-a"); // explore finished → implementer
    land(db, a);
    await tick("p-a-implementer"); // implementer finished → reviewer
    w.checks.push({ decision: "prompt", prompt: "fix it", reason: "the review found a defect" });
    land(db, a);
    await tick("p-a-reviewer");
    const back = db.listEvents(a.id).find((e) => e.type === "card.pipeline_step")!;
    expect(w.calls).toContain("sendBack a fix it");
    expect((back.payload as { index: number }).index).toBe(1); // the implementer, step 1 — not the explorer, step 0
  });

  it("a red gate on the first role still goes to its own session", async () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/r", status: "ready" });
    db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 0 });
    const w = world(db);
    w.setGate("gate");
    w.gates.push({ kind: "fail", exit: 1, summary: "red" });
    w.coord.update(snap());
    await flush();
    land(db, a);
    for (let i = 0; i < 2; i++) {
      w.coord.update(snap({ "p-a": "idle" }));
      await flush();
    }
    expect(w.calls.some((c) => c.startsWith("prompt p-a "))).toBe(true);
    expect(w.calls.some((c) => c.startsWith("sendBack"))).toBe(false);
  });

  it("a card with no pipeline never advances", async () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/r", status: "ready" });
    db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 0 });
    const w = world(db);
    w.coord.update(snap());
    await flush();
    land(db, a);
    for (let i = 0; i < 2; i++) {
      w.coord.update(snap({ "p-a": "idle" }));
      await flush();
    }
    expect(w.calls.some((c) => c.startsWith("advance"))).toBe(false);
  });
});

describe("the PR's checks (ADR 0029)", () => {
    const setup = (merge: object | undefined, onLand?: (db: BoardDb, c: Card) => void) => {
      const db = new BoardDb(":memory:");
      const a = db.createCard({ title: "a", repoPath: "/r" });
      db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 0 });
      db.openSession({ cardId: a.id, paneId: "p" });
      land(db, a);
      return { db, a, w: world(db, { merge, onLand: onLand && ((c) => onLand(db, c)) }) };
    };
    const tick = async (w: ReturnType<typeof world>) => {
      w.coord.update(snap({ p: "idle" }));
      await flush();
    };

    it("running checks: the card is not filed, and the next ticks ask the PR again", async () => {
      const { w } = setup({ wait: true });
      await tick(w);
      await tick(w);
      await tick(w);
      expect(w.calls).toEqual(["pr a", "land a"]);
    });

    it("a red check goes back to the worker with its name and log, as a round", async () => {
      const { db, a, w } = setup({ ci: { name: "typecheck", log: "TS2554 boom" } });
      await tick(w);
      await tick(w);
      expect(w.calls).toHaveLength(2);
      expect(w.calls[1]).toMatch(/^prompt p .*typecheck.*TS2554 boom/s);
      expect(w.calls).not.toContain("done a");
      expect(events(db, a, "run.decision")[0]!.payload).toMatchObject({ decision: "prompt" });
    });

    it("GitHub's auto-merge armed: filed — GitHub merges on green (ADR 0017 step 7)", async () => {
      const { w } = setup(undefined);
      await tick(w);
      await tick(w);
      expect(w.calls).toEqual(["pr a", "done a"]);
    });

    it("GitHub has not worked mergeability out: a wait, the card stays open, and is filed once the next ask merges", async () => {
      const { db, a, w } = setup({ wait: true, reason: "GitHub has not worked out mergeability yet — waiting" }, (db, c) => {
        db.recordRunEvent(c.id, "run.merge", { runId: c.runId!, merged: true, reason: "green" });
        db.recordEvent(c.id, "card.pr_merged", {});
      });
      await tick(w); // the lead's verdict
      await tick(w); // the PR
      expect(w.calls).toEqual(["pr a"]);
      expect(db.getCard(a.id)!.status).toBe("review");
      await tick(w);
      expect(w.calls).toEqual(["pr a", "land a", "done a"]);
    });

    it("a land refused by the integration lock is no answer: no halt, nothing filed, asked again on the next tick", async () => {
      const { db, a, w } = setup({ wait: true }, (db, c) => {
        db.recordRunEvent(c.id, "run.merge", { runId: c.runId!, merged: true, reason: "green" });
        db.recordEvent(c.id, "card.pr_merged", {});
      });
      await tick(w); // the lead's verdict
      await tick(w); // the PR: a wait
      const real = w.ports.land;
      w.ports.land = async (c) => (w.calls.push(`busy ${c.title}`), "busy");
      await tick(w);
      expect(w.calls).toEqual(["pr a", "busy a"]);
      expect(events(db, a, "run.halted")).toHaveLength(0);
      w.ports.land = real;
      await tick(w); // no clock moved: a refused ask does not count against the 30 s pace
      expect(w.calls).toEqual(["pr a", "busy a", "land a", "done a"]);
    });

    it("a refusal that is not a wait halts the card for the operator — never filed with its PR open (ADR 0035)", async () => {
      // GitHub unreadable is a wait until MAX_UNREADABLE asks in a row (ADR 0036); this is what is left after.
      const { db, a, w } = setup({ reason: "could not read the PR's state from GitHub 5 times in a row — not merging" });
      await tick(w);
      await tick(w);
      expect(w.calls).toEqual(["pr a"]);
      expect(db.getCard(a.id)!.status).toBe("review");
      expect(events(db, a, "run.halted")[0]!.payload).toMatchObject({ reason: expect.stringContaining("could not read the PR") });
    });

    it("through the real mergeWhenReady: GitHub unreadable once, then readable — a wait, no halt, the card is filed", async () => {
      const { db, a, w } = setup(undefined);
      let readable = false;
      const gh: GitRunner = async (args) => {
        const ok = (stdout = "") => ({ ok: true, stdout, stderr: "" });
        if (args[0] === "pr" && args[1] === "merge") return ok();
        if (args.includes("statusCheckRollup")) return ok(JSON.stringify({ statusCheckRollup: [{ __typename: "CheckRun", name: "ci", status: "COMPLETED", conclusion: "SUCCESS" }] }));
        if (!readable) return { ok: false, stdout: "", stderr: "error connecting to api.github.com" };
        return ok(JSON.stringify({ state: "OPEN", url: "https://gh/o/r/pull/1", mergedAt: null, mergeable: "MERGEABLE", createdAt: "2020-01-01T00:00:00Z" }));
      };
      // What `prForCard` + `landPr` do once GitHub's auto-merge is refused: open the PR, then ask to merge.
      w.ports.openPr = async (c, gate) => {
        w.calls.push(`pr ${c.title}`);
        db.recordEvent(c.id, "card.pr_opened", { base: "main" });
        db.recordEvent(c.id, "card.automerge_refused", {});
        await mergeWhenReady(db, c.id, "/r", "board/a", gate, gh);
        return { ok: true };
      };
      w.ports.land = async (c, gate) => {
        w.calls.push(`land ${c.title}`);
        await mergeWhenReady(db, c.id, "/r", "board/a", gate, gh);
      };
      await tick(w); // the lead's verdict
      await tick(w); // the PR: GitHub unreadable — a wait
      expect(events(db, a, "run.merge")[0]!.payload).toMatchObject({ merged: false, wait: true });
      expect(events(db, a, "run.halted")).toHaveLength(0);
      readable = true;
      w.clock.now += 30_000;
      await tick(w);
      expect(w.calls).toEqual(["pr a", "land a", "done a"]);
      expect(events(db, a, "run.halted")).toHaveLength(0);
      expect(events(db, a, "card.pr_merged")).toHaveLength(1);
    });

    it("a conflict GitHub found after the PR opened goes to the worker's agent, not to done", async () => {
      const { db, a, w } = setup({ conflict: true, reason: "the PR has a conflict — not merging" });
      await tick(w);
      await tick(w);
      expect(w.calls).toEqual(["pr a", "resolve a"]);
      expect(db.getCard(a.id)!.status).toBe("review");
    });
  });

  it("a restarted bridge resumes from the cards' state", async () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/r" });
    db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 0 });
    db.openSession({ cardId: a.id, paneId: "p" });
    land(db, a);
    world(db).coord.update(snap({ p: "idle" })); // judged finished, then the bridge dies
    await flush();
    const after = world(db); // a fresh coordinator, same database
    after.coord.update(snap({ p: "idle" }));
    await flush();
    expect(after.calls).toEqual(["pr a", "done a"]);
  });

  it("tells the lead an explore card is one, so its check is the explore check", () => {
    const db = new BoardDb(":memory:");
    const card = db.createCard({ title: "x", repoPath: "/r", category: "explore" });
    const brief = briefOf(card, "/wt", "main");
    expect(brief.category).toBe("explore");
    expect(checkPrompt({ ...brief, statSummary: "", outPath: "o.json" })).not.toBe(
      checkPrompt({ ...brief, category: null, statSummary: "", outPath: "o.json" }),
    );
  });
});

describe("a predecessor filed on GitHub's auto-merge armed (ADR 0036)", () => {
  const setup = () => {
    // The journal and the coordinator share one clock: `askEvery` reads the wait's journaled `ts`.
    const clock = { now: 1_000_000_000_000 };
    const db = new BoardDb(":memory:", () => clock.now);
    const a = db.createCard({ title: "a", repoPath: "/r", baseRef: "main" });
    const b = db.createCard({ title: "b", repoPath: "/r", baseRef: "main", status: "ready", dependsOn: a.id });
    db.createRun({ repoPath: "/r", cardIds: [a.id, b.id], foldInCap: 0 });
    db.patchCard(a.id, { branch: "board/a" });
    db.recordEvent(a.id, "card.pr_opened", { base: "main" });
    db.recordEvent(a.id, "card.automerge_armed", {});
    db.setStatus(a.id, "done", "auto-merge armed");
    const w = world(db, { clock });
    const tick = async () => {
      w.coord.update(snap());
      await flush();
    };
    const open = (state: PrStatus["state"]): PrStatus => ({ state, url: "u", mergedAt: null, conflicting: false, mergeable: false, createdAt: null });
    return { db, a, b, w, tick, open };
  };

  it("the dependent waits — said once — until the board has seen the merge, then starts from its base", async () => {
    const { db, a, b, w, tick, open } = setup();
    w.setPredPr(open("open"));
    await tick();
    await tick(); // throttled: GitHub is not asked again within 30 s
    expect(w.calls).toEqual(["refresh a"]);
    expect(events(db, b, "run.decision")[0]!.payload).toMatchObject({ decision: "wait", reason: expect.stringContaining("“a”") });
    w.clock.now += 30_000;
    await tick();
    expect(events(db, b, "run.decision")).toHaveLength(1);

    w.setPredPr(open("merged"));
    w.clock.now += 30_000;
    await tick(); // the merge is journaled on the predecessor…
    expect(events(db, a, "card.pr_merged")).toHaveLength(1);
    await tick(); // …and the dependent starts — `hasLanded` makes it fork from its base (ADR 0034)
    expect(w.calls.at(-1)).toBe("start b");
  });

  it("a predecessor that stays unmerged is asked slower and slower (askEvery), never every 30 s for hours", async () => {
    const { w, tick, open } = setup();
    w.setPredPr(open("open"));
    await tick(); // the wait is said, now
    const refreshes = () => w.calls.filter((c) => c === "refresh a").length;
    const step = async (min: number) => {
      w.clock.now += min * 60_000;
      await tick();
      return refreshes();
    };
    expect(await step(40)).toBe(2); // waited 40 min: one ask per 10 min
    expect(await step(5)).toBe(2); // waited 45: one per 11¼ — 5 min since the last ask, not asked
    expect(await step(7)).toBe(2); // waited 52: one per 13 — 12 min, still not
    expect(await step(2)).toBe(3); // waited 54: one per 13½ — 14 min, asked
    expect(await step(600)).toBe(4); // waited 10 h: capped at one per 30 min
    expect(await step(29)).toBe(4);
    expect(await step(1)).toBe(5);
  });

  it("a predecessor's PR closed unmerged halts the dependent for the operator", async () => {
    const { db, b, w, tick, open } = setup();
    w.setPredPr(open("closed"));
    await tick();
    expect(w.calls).toEqual(["refresh a"]);
    expect(events(db, b, "run.halted")[0]!.payload).toMatchObject({ reason: expect.stringContaining("closed without merging") });
    await tick();
    expect(w.calls).toEqual(["refresh a"]);
  });

  it("a predecessor whose merge is already journaled starts the dependent at once", async () => {
    const { db, a, w, tick } = setup();
    db.recordEvent(a.id, "card.pr_merged", {});
    await tick();
    expect(w.calls).toEqual(["start b"]);
  });
});

describe("a lot's parallelism ceiling", () => {
  it("maxParallel 1 starts one card, then the next only when the first is filed", async () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/r", status: "ready", position: 0 });
    const b = db.createCard({ title: "b", repoPath: "/r", status: "ready", position: 1 });
    db.createRun({ repoPath: "/r", cardIds: [a.id, b.id], foldInCap: 0, maxParallel: 1 });
    const w = world(db, { slots: 5 });
    w.coord.update(snap());
    w.coord.update(snap());
    await flush();
    expect(w.calls).toEqual(["start a"]);
    w.coord.update(snap({ "p-a": "working" }));
    await flush();
    expect(w.calls).toEqual(["start a"]);
    w.ports.fileAsDone(db.getCard(a.id)!);
    w.coord.update(snap());
    await flush();
    expect(w.calls.at(-1)).toBe("start b");
  });

  it("no ceiling: the board's own slots decide, as before", async () => {
    const db = new BoardDb(":memory:");
    const ids = ["a", "b", "c"].map((t, i) => db.createCard({ title: t, repoPath: "/r", status: "ready", position: i }).id);
    db.createRun({ repoPath: "/r", cardIds: ids, foldInCap: 0 });
    const w = world(db, { slots: 5 });
    w.coord.update(snap());
    await flush();
    expect(w.calls).toEqual(["start a", "start b", "start c"]);
  });

  it("refuses a ceiling out of range", () => {
    const db = new BoardDb(":memory:");
    expect(isMaxParallel(1)).toBe(true);
    expect(isMaxParallel(0)).toBe(false);
    expect(isMaxParallel(17)).toBe(false);
    expect(isMaxParallel(2.5)).toBe(false);
    db.close();
  });
});

describe("the repo's gate (ADR 0020)", () => {
  async function landed(gate: string | null = "tools/ovg gate") {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/r", status: "ready" });
    db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 0 });
    const w = world(db);
    w.setGate(gate);
    w.coord.update(snap());
    await flush();
    land(db, a);
    return { db, a, w };
  }

  it("red: the worker is sent back with the report, and the lead is never asked", async () => {
    const { db, a, w } = await landed();
    w.gates.push({ kind: "fail", exit: 2, summary: "error: x" });
    w.checks.push({ decision: "finished", reason: "should not be asked" });
    w.coord.update(snap({ "p-a": "idle" }));
    await flush();
    expect(w.calls.filter((c) => c.startsWith("prompt"))).toHaveLength(1);
    expect(w.calls.at(-1)).toContain("error: x");
    expect(events(db, a, "run.gate")[0]!.payload).toMatchObject({ ok: false });
    expect(events(db, a, "run.decision")[0]!.payload).toMatchObject({ decision: "prompt", reason: "the gate failed (exit 2)" });
    // Same landing: nothing more until the worker lands again.
    w.coord.update(snap({ "p-a": "idle" }));
    await flush();
    expect(w.calls.filter((c) => c.startsWith("gate"))).toHaveLength(1);
    expect(w.checks).toHaveLength(1);
  });

  it("green: the lead is asked, once, and the gate is not run twice on the same landing", async () => {
    const { db, a, w } = await landed();
    w.coord.update(snap({ "p-a": "idle" }));
    await flush();
    w.coord.update(snap({ "p-a": "idle" }));
    await flush();
    expect(w.calls.filter((c) => c.startsWith("gate"))).toHaveLength(1);
    expect(events(db, a, "run.gate")[0]!.payload).toMatchObject({ ok: true });
    expect(events(db, a, "run.decision")[0]!.payload).toMatchObject({ decision: "finished" });
  });

  it("a gate that cannot run halts the card instead of blaming the worker", async () => {
    const { db, a, w } = await landed();
    w.gates.push({ kind: "error", message: "ENOENT" });
    w.coord.update(snap({ "p-a": "idle" }));
    await flush();
    expect(events(db, a, "run.halted")[0]!.payload).toMatchObject({ reason: "gate could not run: ENOENT" });
    expect(w.calls.some((c) => c.startsWith("prompt"))).toBe(false);
  });

  it("red rounds count: the card goes to the operator after MAX_ROUNDS", async () => {
    const { db, a, w } = await landed();
    for (let i = 0; i < MAX_ROUNDS; i++) {
      w.gates.push({ kind: "fail", exit: 1, summary: "no" });
      w.coord.update(snap({ "p-a": "idle" }));
      await flush();
      db.setStatus(a.id, "working", "agent working");
      land(db, a);
    }
    w.coord.update(snap({ "p-a": "idle" }));
    await flush();
    expect(events(db, a, "run.halted")).toHaveLength(1);
  });

  it("no gate configured: the lead is asked straight away, as before", async () => {
    const { a, db, w } = await landed(null);
    w.coord.update(snap({ "p-a": "idle" }));
    await flush();
    expect(w.calls.some((c) => c.startsWith("gate"))).toBe(false);
    expect(events(db, a, "run.decision")).toHaveLength(1);
  });
});


describe("one PR for the lot (ADR 0041)", () => {
  const titles = ["a", "b", "c"];
  async function lotOf(integration: "card" | "lot") {
    const db = new BoardDb(":memory:");
    const cards = titles.map((t, i) => db.createCard({ title: t, repoPath: "/r", status: "ready", position: i }));
    const run = db.createRun({ repoPath: "/r", cardIds: cards.map((c) => c.id), foldInCap: 0, integration });
    const w = world(db);
    w.coord.update(snap());
    await flush();
    cards.forEach((c) => land(db, c));
    return { db, cards, run, w };
  }
  const panes = Object.fromEntries(titles.map((t) => [`p-${t}`, "idle"]));
  /** Ticks until the world is quiet. A card's landing is the worker's; the rest is the coordinator's. */
  const settle = async (w: Awaited<ReturnType<typeof lotOf>>["w"], n = 14) => {
    for (let i = 0; i < n; i++) {
      w.coord.update(snap(panes));
      await flush();
    }
  };

  it("3 cards: each starts from the lot, folds into it, and exactly ONE PR is opened", async () => {
    const { db, cards, run, w } = await lotOf("lot");
    expect(db.getRun(run.id)!.integration).toBe("lot");
    expect(w.calls.filter((c) => c.startsWith("lot "))).toEqual(["lot a", "lot b", "lot c"]);
    // the lot is prepared before the card starts
    expect(w.calls.indexOf("lot a")).toBeLessThan(w.calls.indexOf("start a"));
    await settle(w);
    expect(w.calls.filter((c) => c.startsWith("fold "))).toEqual(["fold a", "fold b", "fold c"]);
    expect(w.calls.filter((c) => c.startsWith("pr "))).toHaveLength(1);
    expect(w.calls.filter((c) => c.startsWith("land "))).toHaveLength(0); // armed: nothing to ask
    // the PR is opened only after every card is in the lot, and by the last one to land
    expect(w.calls.indexOf("pr c")).toBeGreaterThan(w.calls.indexOf("fold c"));
    // a, b are filed as soon as they are in the lot; c — the PR's anchor — once the PR is armed
    expect(w.calls.filter((c) => c.startsWith("done "))).toEqual(["done a", "done b", "done c"]);
    expect(w.calls.indexOf("done c")).toBeGreaterThan(w.calls.indexOf("pr c"));
    expect(cards.map((c) => db.getCard(c.id)!.status)).toEqual(["done", "done", "done"]);
    expect(db.listEvents(cards[0]!.id, 50).some((e) => e.type === "card.lot_merged")).toBe(true);
  });

  it("without the setting a lot behaves as before: one PR per card, nothing folded", async () => {
    const { w } = await lotOf("card");
    await settle(w);
    expect(w.calls.filter((c) => c.startsWith("pr "))).toEqual(["pr a", "pr b", "pr c"]);
    expect(w.calls.some((c) => c.startsWith("fold ") || c.startsWith("lot "))).toBe(false);
  });

  it("a card that conflicts with the lot is handed back to its agent, then folds on its next landing", async () => {
    const { db, cards, w } = await lotOf("lot");
    w.folds.push({ ok: true }, { ok: false, error: { kind: "conflict", message: "same.txt" } });
    await settle(w, 4);
    expect(w.calls).toContain("fold b conflict");
    expect(w.calls).toContain("resolve b");
    expect(w.calls.filter((c) => c.startsWith("pr "))).toHaveLength(0);
    // b settles on its branch and lands again
    const b = cards[1]!;
    db.setStatus(b.id, "working", "agent working");
    land(db, b);
    w.rechecks.push({ decision: "resolved", reason: "settled" });
    await settle(w);
    expect(w.calls.filter((c) => c === "fold b")).toHaveLength(1);
    expect(w.calls.filter((c) => c.startsWith("pr "))).toHaveLength(1);
  });
});
