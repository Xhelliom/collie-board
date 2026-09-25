import { describe, expect, it } from "bun:test";

import { BoardDb, type Card } from "./db.ts";
import type { CheckDecision, ConflictDecision, TriageDecision } from "./lead.ts";
import { checkPrompt } from "./lead.ts";
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
function world(db: BoardDb, opts: { slots?: number; reviewing?: boolean } = {}) {
  const calls: string[] = [];
  const checks: CheckDecision[] = [];
  const triages: TriageDecision[] = [];
  const rechecks: ConflictDecision[] = [];
  let pr: Awaited<ReturnType<RunPorts["openPr"]>> = { ok: true };
  const ports: RunPorts = {
    lead: {
      check: async () => checks.shift() ?? { decision: "finished", reason: "ok" },
      triage: async () => triages.shift()!,
      recheckConflict: async () => rechecks.shift()!,
    },
    start: async (id) => {
      calls.push(`start ${db.getCard(id)!.title}`);
      db.openSession({ cardId: id, paneId: `p-${db.getCard(id)!.title}` });
      db.setStatus(id, "working", "agent working");
      return { ok: true };
    },
    prompt: async (pane, text) => void calls.push(`prompt ${pane} ${text}`),
    openPr: async (c) => {
      calls.push(`pr ${c.title}`);
      if (pr.ok) db.recordEvent(c.id, "card.pr_opened", {});
      return pr;
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
    brief: async (c) => ({ title: c.title, spec: c.spec, acceptance: c.acceptance, worktree: "/wt", base: "main" }),
    stat: async () => "a.ts | 1 +",
    freeSlots: () => (opts.slots ?? 3) - db.listOpenSessions().length,
    reviewing: () => opts.reviewing ?? false,
  };
  return {
    calls,
    checks,
    triages,
    rechecks,
    setPr: (r: typeof pr) => (pr = r),
    coord: new RunCoordinator(db, ports),
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
