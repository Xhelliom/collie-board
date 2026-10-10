import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";

import { handleBoardRoute } from "./board-routes.ts";
import { BoardDb } from "./db.ts";
import { parseRoadmapBody, roadmapMarkdown } from "./roadmap.ts";
import { RunCoordinator, type RunPorts } from "./run.ts";
import type { EngineSnapshot } from "./state-engine.ts";

const ctx = (db: BoardDb) =>
  ({
    db,
    herdr: {},
    engine: { current: () => ({ agents: [], shellPanes: [], workspaces: [], tabs: [], bridge: "connected" }) },
    copilot: { busy: () => new Set<string>(), reformulate: () => {} },
    cfg: {},
    audit: { record: () => {} },
    session: "default",
    guard: () => null,
    device: null,
    json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
    text: (body: string, status: number) => new Response(body, { status }),
  }) as never;

const call = async (db: BoardDb, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await handleBoardRoute(
    path.split("?")[0]!,
    new Request(`http://x${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    ctx(db),
  );
  const text = await res!.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // plain text or Markdown
  }
  // biome-ignore lint: test helper, the shape is asserted by each test
  return { status: res!.status, body: parsed as any };
};

describe("migration (ADR 0021)", () => {
  it("back-fills launched_at on runs that predate it, once — a planned lot stays planned", () => {
    const file = join(mkdtempSync(join(tmpdir(), "collie-lot-")), "board.db");
    const old = new Database(file, { create: true });
    old.exec(`CREATE TABLE card (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, repo_path TEXT,
      position INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, run_id TEXT)`);
    old.exec(`CREATE TABLE run (id TEXT PRIMARY KEY, repo_path TEXT NOT NULL, created_at INTEGER NOT NULL,
      fold_in_cap INTEGER NOT NULL, lead_agent TEXT)`);
    old.exec(`INSERT INTO card (id, title, status, repo_path, created_at, updated_at, run_id) VALUES ('c1','old','ready','/r',1,1,'r1')`);
    old.exec(`INSERT INTO run VALUES ('r1','/r',42,1,NULL)`);
    old.close();

    const db = new BoardDb(file);
    expect(db.getRun("r1")).toMatchObject({ launchedAt: 42, name: null, phaseId: null, position: 0 });
    expect(db.getCard("c1")!.phaseId).toBeNull();
    const lot = db.createRun({ repoPath: "/r", cardIds: [], foldInCap: 0, planned: true });
    db.close();

    // Reopened: the migration has already run, so the planned lot is not back-filled into a launched one.
    const again = new BoardDb(file);
    expect(again.getRun(lot.id)!.launchedAt).toBeNull();
    expect(again.getRun("r1")!.launchedAt).toBe(42);
    again.close();
  });
});

describe("the coordinator and a planned lot", () => {
  it("ignores it until it is launched", async () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/r", status: "ready" });
    const lot = db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 0, planned: true });
    const started: string[] = [];
    const ports = {
      start: async (id: string) => (started.push(id), { ok: true }),
      freeSlots: () => 3,
      gateCommand: () => null,
      reviewing: () => false,
    } as unknown as RunPorts;
    const coord = new RunCoordinator(db, ports);
    const snap = { agents: [], shellPanes: [], workspaces: [], tabs: [], bridge: "connected" } as unknown as EngineSnapshot;
    coord.update(snap);
    await new Promise((r) => setTimeout(r, 5));
    expect(started).toEqual([]);
    expect(db.listOpenRuns()).toEqual([]);

    expect(db.launchRun(lot.id)).toBe(true);
    expect(db.launchRun(lot.id)).toBe(false);
    coord.update(snap);
    await new Promise((r) => setTimeout(r, 5));
    expect(started).toEqual([a.id]);
  });
});

describe("phases", () => {
  it("creates, orders, patches and deletes — releasing cards and lots, deleting neither", async () => {
    const db = new BoardDb(":memory:");
    const p1 = (await call(db, "POST", "/api/phases", { repoPath: "/r", name: "Foundations", goal: "the base" })).body.phase;
    const p2 = (await call(db, "POST", "/api/phases", { repoPath: "/r", name: "Scale" })).body.phase;
    expect([p1.position, p2.position]).toEqual([0, 1]);
    expect((await call(db, "POST", "/api/phases", { repoPath: "r", name: "x" })).status).toBe(400);
    expect((await call(db, "POST", "/api/phases", { repoPath: "/r", name: " " })).status).toBe(400);

    const card = db.createCard({ title: "a", repoPath: "/r" });
    expect((await call(db, "PATCH", `/api/cards/${card.id}`, { phaseId: p1.id })).status).toBe(200);
    expect(db.getCard(card.id)!.phaseId).toBe(p1.id);
    // Another repo's phase, and a ghost, are refused.
    const other = db.createPhase({ repoPath: "/else", name: "Other" });
    expect((await call(db, "PATCH", `/api/cards/${card.id}`, { phaseId: other.id })).status).toBe(400);
    expect((await call(db, "PATCH", `/api/cards/${card.id}`, { phaseId: "nope" })).status).toBe(400);

    expect((await call(db, "PATCH", `/api/phases/${p2.id}`, { name: "Scale up", position: -1 })).body.phase).toMatchObject({ name: "Scale up", position: -1 });
    expect((await call(db, "GET", "/api/phases?repo=%2Fr")).body.phases.map((p: { name: string }) => p.name)).toEqual(["Scale up", "Foundations"]);

    const lot = db.createRun({ repoPath: "/r", cardIds: [], foldInCap: 0, planned: true, phaseId: p1.id });
    expect((await call(db, "DELETE", `/api/phases/${p1.id}`)).status).toBe(200);
    expect(db.getCard(card.id)).toMatchObject({ phaseId: null });
    expect(db.getRun(lot.id)!.phaseId).toBeNull();
    expect((await call(db, "DELETE", `/api/phases/${p1.id}`)).status).toBe(404);
  });

  it("a card can be created straight into a phase", async () => {
    const db = new BoardDb(":memory:");
    const p = db.createPhase({ repoPath: "/r", name: "P" });
    const res = await call(db, "POST", "/api/cards", { title: "t", repoPath: "/r", phaseId: p.id });
    expect(res.status).toBe(200);
    expect(res.body.card.phaseId).toBe(p.id);
  });
});

describe("lots", () => {
  async function setup() {
    const db = new BoardDb(":memory:");
    const phase = db.createPhase({ repoPath: "/r", name: "P" });
    const a = db.createCard({ title: "a", repoPath: "/r" });
    const b = db.createCard({ title: "b", repoPath: "/r" });
    return { db, phase, a, b };
  }

  it("a planned lot holds its cards and drives nothing; the old gesture still launches at once", async () => {
    const { db, phase, a, b } = await setup();
    const planned = await call(db, "POST", "/api/runs", { cardIds: [a.id], foldInCap: 1, planned: true, phaseId: phase.id, name: "Lot 1", position: 2 });
    expect(planned.status).toBe(201);
    expect(planned.body.run).toMatchObject({ phaseId: phase.id, name: "Lot 1", position: 2, launchedAt: null });
    expect(db.listOpenRuns()).toEqual([]);
    const now = await call(db, "POST", "/api/runs", { cardIds: [b.id], foldInCap: 1 });
    expect(now.body.run.launchedAt).not.toBeNull();
    expect(db.listOpenRuns()).toHaveLength(1);
    // A card in a lot is in a run: it cannot be in a second.
    expect((await call(db, "POST", "/api/runs", { cardIds: [a.id], foldInCap: 1, planned: true })).status).toBe(409);
    expect((await call(db, "POST", "/api/runs", { cardIds: [a.id], foldInCap: 1, planned: true, phaseId: "ghost" })).status).toBe(409);
  });

  it("lists, patches membership and order, and deletes a planned lot — never a launched one", async () => {
    const { db, a, b } = await setup();
    const lot = (await call(db, "POST", "/api/runs", { cardIds: [a.id], foldInCap: 0, planned: true })).body.run;
    const patched = await call(db, "PATCH", `/api/runs/${lot.id}`, { name: "First", cardIds: [b.id] });
    expect(patched.body.run).toMatchObject({ name: "First", cardIds: [b.id] });
    expect(db.getCard(a.id)!.runId).toBeNull();
    expect((await call(db, "GET", "/api/runs?repo=%2Fr")).body.runs).toHaveLength(1);
    expect((await call(db, "PATCH", `/api/runs/${lot.id}`, { cardIds: ["nope"] })).status).toBe(409);

    expect((await call(db, "DELETE", `/api/runs/${lot.id}`)).status).toBe(200);
    expect(db.getCard(b.id)!.runId).toBeNull();

    const launched = db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 0 });
    expect((await call(db, "PATCH", `/api/runs/${launched.id}`, { name: "x" })).status).toBe(409);
    expect((await call(db, "DELETE", `/api/runs/${launched.id}`)).status).toBe(409);
  });

  it("launch is the operator's: refused with an agent pane's header, on both routes that start a run", async () => {
    const { db, a, b } = await setup();
    const lot = (await call(db, "POST", "/api/runs", { cardIds: [a.id], foldInCap: 0, planned: true }, { "x-collie-pane": "w1:p2" })).body.run;
    expect(lot.launchedAt).toBeNull();
    expect((await call(db, "POST", `/api/runs/${lot.id}/launch`, undefined, { "x-collie-pane": "w1:p2" })).status).toBe(403);
    expect(db.getRun(lot.id)!.launchedAt).toBeNull();
    // …and the unplanned gesture is a launch too.
    expect((await call(db, "POST", "/api/runs", { cardIds: [b.id], foldInCap: 0 }, { "x-collie-pane": "w1:p2" })).status).toBe(403);
    expect(db.getCard(b.id)!.runId).toBeNull();

    expect((await call(db, "POST", `/api/runs/${lot.id}/launch`)).status).toBe(200);
    expect((await call(db, "POST", `/api/runs/${lot.id}/launch`)).status).toBe(409);
    expect((await call(db, "POST", "/api/runs/ghost/launch")).status).toBe(404);
  });
});

describe("roadmap", () => {
  const put = (db: BoardDb, body: unknown) => call(db, "PUT", "/api/roadmap", body);

  it("reads an empty one, writes with the revision it read, and refuses a stale write", async () => {
    const db = new BoardDb(":memory:");
    expect((await call(db, "GET", "/api/roadmap?repo=%2Fr")).body.roadmap).toMatchObject({ revision: 0, items: [] });

    const first = await put(db, { repoPath: "/r", vision: "ship", revision: 0, items: [{ name: "P1", goal: "g" }, { id: "x", name: "P2", status: "active" }] });
    expect(first.status).toBe(200);
    expect(first.body.roadmap.revision).toBe(1);
    expect(first.body.roadmap.items.map((i: { status: string }) => i.status)).toEqual(["planned", "active"]);

    const stale = await put(db, { repoPath: "/r", revision: 0, items: [] });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ kind: "revision", current: 1 });
    expect(db.getRoadmap("/r")!.items).toHaveLength(2);

    expect((await put(db, { repoPath: "/r", revision: 1, items: [] })).body.roadmap.revision).toBe(2);
  });

  it("validates the document", () => {
    const base = { repoPath: "/r", revision: 0, items: [] };
    expect(parseRoadmapBody({ ...base, repoPath: "r" }).ok).toBe(false);
    expect(parseRoadmapBody({ repoPath: "/r", items: [] }).ok).toBe(false);
    expect(parseRoadmapBody({ ...base, items: [{ name: "" }] }).ok).toBe(false);
    expect(parseRoadmapBody({ ...base, items: [{ name: "a", status: "later" }] }).ok).toBe(false);
    expect(parseRoadmapBody({ ...base, items: [{ id: "i", name: "a" }, { id: "i", name: "b" }] }).ok).toBe(false);
    expect(parseRoadmapBody(base).ok).toBe(true);
  });

  it("exports Markdown, one way", async () => {
    const db = new BoardDb(":memory:");
    await put(db, { repoPath: "/home/me/game", vision: "A FPS.", revision: 0, items: [{ name: "Foundations", goal: "The base." }, { name: "Scale", status: "dropped" }] });
    const md = (await call(db, "GET", "/api/roadmap?repo=%2Fhome%2Fme%2Fgame&format=md")).body as string;
    expect(md).toContain("# Roadmap — game");
    expect(md).toContain("## 1. Foundations\n\nThe base.");
    expect(md).toContain("## 2. Scale — dropped");
    expect(md.startsWith("<!-- Generated by Collie Board, revision 1.")).toBe(true);
    expect(roadmapMarkdown("x", { vision: "", items: [], revision: 3 })).toContain("# Roadmap — x");
  });
});

describe("a lot's maxParallel over the routes (ADR 0021)", () => {
  it("is stored on a planned lot, patched, and refused out of range", async () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/r", status: "ready" });
    const run = db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 0, planned: true, maxParallel: 1 });
    expect(db.getRun(run.id)!.maxParallel).toBe(1);
    db.updateLot(run.id, { maxParallel: 3 });
    expect(db.getRun(run.id)!.maxParallel).toBe(3);
    db.updateLot(run.id, { maxParallel: null });
    expect(db.getRun(run.id)!.maxParallel).toBeNull();
    db.close();
  });
});

describe("GET /api/project/facts", () => {
  it("returns the facts of one repo's live cards, and needs a repo", async () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/r", status: "working" });
    db.createCard({ title: "other", repoPath: "/else", status: "working" });
    db.recordRunEvent(a.id, "run.gate", { runId: "r1", command: "make", ok: true });
    const ok = await call(db, "GET", "/api/project/facts?repo=%2Fr");
    expect(ok.status).toBe(200);
    expect(ok.body.facts).toHaveLength(1);
    expect(ok.body.facts[0]).toMatchObject({ cardId: a.id, gate: { ok: true, command: "make" } });
    expect((await call(db, "GET", "/api/project/facts")).status).toBe(400);
    expect((await call(db, "POST", "/api/project/facts?repo=%2Fr")).status).toBe(405);
  });
});

describe("the roadmap as a document (ADR 0023)", () => {
  const repo = "/home/me/game";
  const q = `repo=${encodeURIComponent(repo)}`;

  it("keeps a phase's long form and the decision journal, and defaults old items to an empty detail", async () => {
    const db = new BoardDb(":memory:");
    const { body } = await call(db, "PUT", "/api/roadmap", {
      repoPath: repo,
      revision: 0,
      vision: "A FPS.",
      items: [{ id: "p0", name: "Cadrage", status: "active", detail: "## Démo\nLa roadmap est validée." }, { id: "p1", name: "Prototype" }],
    });
    expect(body.roadmap.items[0].detail).toContain("La roadmap est validée.");
    expect(body.roadmap.items[1].detail).toBe("");
    expect(body.roadmap.decisions).toEqual([]);
    const tooLong = await call(db, "PUT", "/api/roadmap", { repoPath: repo, revision: 1, items: [{ name: "a", detail: "x".repeat(20_001) }] });
    expect(tooLong.status).toBe(400);
  });

  it("a decision is upserted without a revision, bumps it, and a PUT that omits decisions keeps them", async () => {
    const db = new BoardDb(":memory:");
    await call(db, "PUT", "/api/roadmap", { repoPath: repo, revision: 0, items: [{ id: "p1", name: "Prototype" }] });
    const a = await call(db, "POST", "/api/roadmap/decision", { repoPath: repo, text: "16v16 teams", status: "open", itemId: "p1" });
    expect(a.status).toBe(200);
    expect(a.body.revision).toBe(2);
    const id = a.body.decision.id as string;
    const b = await call(db, "POST", "/api/roadmap/decision", { repoPath: repo, id, text: "16v16 teams", status: "decided", itemId: "p1" });
    expect(b.body.revision).toBe(3);
    expect(db.getRoadmap(repo)!.decisions).toEqual([{ id, text: "16v16 teams", status: "decided", itemId: "p1" }]);
    // The operator's editor saves the document without touching the journal.
    await call(db, "PUT", "/api/roadmap", { repoPath: repo, revision: 3, vision: "v", items: [{ id: "p1", name: "Prototype" }] });
    expect(db.getRoadmap(repo)!.decisions).toHaveLength(1);
  });

  it("refuses a bad decision, an unknown item, a body without a repo, and the 301st", async () => {
    const db = new BoardDb(":memory:");
    const d = (o: object) => call(db, "POST", "/api/roadmap/decision", { repoPath: repo, text: "t", status: "open", ...o });
    expect((await d({ status: "maybe" })).status).toBe(400);
    expect((await d({ text: "  " })).status).toBe(400);
    expect((await d({ itemId: "ghost" })).status).toBe(400);
    expect((await call(db, "POST", "/api/roadmap/decision", { text: "t", status: "open" })).status).toBe(400);
    expect((await call(db, "GET", "/api/roadmap/decision")).status).toBe(405);
    for (let i = 0; i < 300; i++) db.upsertDecision(repo, { text: `d${i}`, status: "open" });
    expect((await d({})).status).toBe(409);
    // …but an existing one can still be rewritten.
    const first = db.getRoadmap(repo)!.decisions[0]!;
    expect((await d({ id: first.id, status: "decided" })).status).toBe(200);
  });

  it("exports the detailed roadmap: phases with their long form, decisions grouped ✅ 🟡 ❓", () => {
    const md = roadmapMarkdown("game", {
      vision: "A FPS.",
      revision: 4,
      items: [{ id: "p0", name: "Cadrage", goal: "Decide.", status: "done", detail: "Demo: the plan." }],
      decisions: [
        { id: "a", text: "Teams of 16", status: "decided", itemId: "p0" },
        { id: "b", text: "Vehicles?", status: "open", itemId: null },
        { id: "c", text: "Hitscan first", status: "leaning", itemId: null },
      ],
    });
    expect(md).toContain("## 1. Cadrage — done\n\nDecide.\n\nDemo: the plan.");
    expect(md).toContain("### ✅ Décidé (1)\n\n- Teams of 16 — _1. Cadrage_");
    expect(md).toContain("### 🟡 Piste privilégiée (1)");
    expect(md).toContain("### ❓ Questions ouvertes (1)\n\n- Vehicles?");
    expect(md.indexOf("✅")).toBeLessThan(md.indexOf("🟡"));
    expect(md.indexOf("🟡")).toBeLessThan(md.indexOf("❓"));
  });

  it("exports the step-by-step roadmap from the board itself, phase by phase, leaving out phases with no card", async () => {
    const db = new BoardDb(":memory:");
    const p1 = db.createPhase({ repoPath: repo, name: "Prototype", goal: "A portal." });
    db.createPhase({ repoPath: repo, name: "Later" });
    const a = db.createCard({ title: "Portal math", repoPath: repo, status: "done", spec: "Compute the plane.", acceptance: ["test passes"], phaseId: p1.id });
    const b = db.createCard({ title: "Traversal", repoPath: repo, status: "ready", dependsOn: a.id, phaseId: p1.id });
    db.createCard({ title: "Stray", repoPath: repo, status: "backlog" });
    db.createRun({ repoPath: repo, cardIds: [a.id, b.id], foldInCap: 0, planned: true, phaseId: p1.id, name: "Lot 1", maxParallel: 1 });
    const md = (await call(db, "GET", `/api/roadmap?${q}&format=steps`)).body as string;
    expect(md).toContain("# Étape par étape — game");
    expect(md).toContain("## Phase 1 — Prototype\n\nA portal.");
    expect(md).toContain("### Lot — Lot 1 (planned, one at a time)");
    expect(md).toContain("- **Portal math** — done");
    expect(md).toContain("  Compute the plane.");
    expect(md).toContain("  - [x] test passes");
    expect(md).toContain("  - after: Portal math");
    expect(md).not.toContain("Later");
    expect(md).not.toContain("Stray");
    expect((await call(db, "GET", `/api/roadmap?${q}&format=md`)).body).toContain("# Roadmap — game");
  });
});


describe("milestones: validating a phase (ADR 0025)", () => {
  const board = () => {
    const db = new BoardDb(":memory:");
    const p1 = db.createPhase({ repoPath: "/r", name: "P1" });
    const p2 = db.createPhase({ repoPath: "/r", name: "P2" });
    const done = db.createCard({ title: "done", repoPath: "/r", status: "done", phaseId: p1.id });
    const open = db.createCard({ title: "open", repoPath: "/r", status: "backlog", phaseId: p1.id });
    return { db, p1, p2, done, open };
  };

  it("keeps the finished cards, moves the open ones, stamps the phase and finishes its roadmap item", async () => {
    const { db, p1, p2, done, open } = board();
    db.putRoadmap("/r", { vision: "", items: [{ id: "i1", name: "P1", goal: "", detail: "", status: "active" }] }, 0);
    db.updatePhase(p1.id, { roadmapItemId: "i1" });
    const res = await call(db, "POST", `/api/phases/${p1.id}/close`, { moveOpenTo: p2.id, note: "v1 shipped" });
    expect(res.status).toBe(200);
    expect(res.body.phase).toMatchObject({ closedNote: "v1 shipped" });
    expect(res.body.phase.closedAt).toBeGreaterThan(0);
    expect(db.getCard(done.id)!.phaseId).toBe(p1.id);
    expect(db.getCard(open.id)!.phaseId).toBe(p2.id);
    expect(db.getRoadmap("/r")!.items[0]!.status).toBe("done");
    expect((await call(db, "GET", "/api/phases?repo=%2Fr")).body.phases.find((p: { id: string }) => p.id === p1.id).closedAt).toBeGreaterThan(0);
  });

  it("with no target the open cards end up phase-less; a bad target is refused and writes nothing", async () => {
    const { db, p1, p2, open } = board();
    const other = db.createPhase({ repoPath: "/else", name: "X" });
    for (const moveOpenTo of [other.id, p1.id, "nope", 7]) {
      expect((await call(db, "POST", `/api/phases/${p1.id}/close`, { moveOpenTo })).status).toBe(400);
    }
    expect(db.getPhase(p1.id)!.closedAt).toBeNull();
    expect((await call(db, "POST", `/api/phases/${p1.id}/close`, {})).status).toBe(200);
    expect(db.getCard(open.id)!.phaseId).toBeNull();
    // A validated phase is no target: validating again, or moving work into it, is refused.
    expect((await call(db, "POST", `/api/phases/${p1.id}/close`, {})).status).toBe(409);
    expect((await call(db, "POST", `/api/phases/${p2.id}/close`, { moveOpenTo: p1.id })).status).toBe(400);
  });

  it("refuses while the phase has a lot that is not over — planned or running", async () => {
    const { db, p1, open } = board();
    const lot = db.createRun({ repoPath: "/r", cardIds: [open.id], foldInCap: 0, planned: true, phaseId: p1.id });
    expect((await call(db, "POST", `/api/phases/${p1.id}/close`, {})).status).toBe(409);
    db.launchRun(lot.id);
    expect((await call(db, "POST", `/api/phases/${p1.id}/close`, {})).status).toBe(409);
    db.recordRunEvent(null, "run.finished", { runId: lot.id });
    expect((await call(db, "POST", `/api/phases/${p1.id}/close`, {})).status).toBe(200);
  });

  it("is the operator's gesture: an agent pane gets 403 on close, reopen and seal, and nothing changes", async () => {
    const { db, p1 } = board();
    const h = { "x-collie-pane": "w1:p9" };
    expect((await call(db, "POST", `/api/phases/${p1.id}/close`, {}, h)).status).toBe(403);
    expect((await call(db, "POST", `/api/phases/${p1.id}/reopen`, {}, h)).status).toBe(403);
    expect((await call(db, "POST", "/api/phases/seal", { repoPath: "/r", name: "v1" }, h)).status).toBe(403);
    expect(db.getPhase(p1.id)!.closedAt).toBeNull();
    expect(db.listPhases("/r")).toHaveLength(2);
  });

  it("reopens a validated phase, and refuses to reopen one that is not", async () => {
    const { db, p1 } = board();
    expect((await call(db, "POST", `/api/phases/${p1.id}/reopen`, {})).status).toBe(409);
    await call(db, "POST", `/api/phases/${p1.id}/close`, {});
    const res = await call(db, "POST", `/api/phases/${p1.id}/reopen`, {});
    expect(res.status).toBe(200);
    expect(res.body.phase.closedAt).toBeNull();
  });

  it("a PATCH cannot validate or reopen a phase behind the gesture's back", async () => {
    const { db, p1 } = board();
    await call(db, "PATCH", `/api/phases/${p1.id}`, { closedAt: 123, name: "renamed" });
    expect(db.getPhase(p1.id)).toMatchObject({ name: "renamed", closedAt: null });
  });

  it("seal: an old project's finished, phase-less cards become one validated phase; the rest stay", async () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/r", status: "done" });
    const b = db.createCard({ title: "b", repoPath: "/r", status: "done" });
    const open = db.createCard({ title: "open", repoPath: "/r", status: "backlog" });
    const elsewhere = db.createCard({ title: "x", repoPath: "/else", status: "done" });
    const res = await call(db, "POST", "/api/phases/seal", { repoPath: "/r", name: "v1", note: "first release" });
    expect(res.status).toBe(201);
    expect(res.body.moved).toBe(2);
    expect(res.body.phase.closedAt).toBeGreaterThan(0);
    expect([a.id, b.id].map((id) => db.getCard(id)!.phaseId)).toEqual([res.body.phase.id, res.body.phase.id]);
    expect(db.getCard(open.id)!.phaseId).toBeNull();
    expect(db.getCard(elsewhere.id)!.phaseId).toBeNull();
    // Nothing left to file: refused, and no empty phase is made.
    expect((await call(db, "POST", "/api/phases/seal", { repoPath: "/r", name: "v2" })).status).toBe(400);
    expect(db.listPhases("/r")).toHaveLength(1);
  });

  it("seal can send the phase-less open cards to an existing open phase", async () => {
    const db = new BoardDb(":memory:");
    const next = db.createPhase({ repoPath: "/r", name: "Next" });
    db.createCard({ title: "a", repoPath: "/r", status: "done" });
    const open = db.createCard({ title: "open", repoPath: "/r", status: "ready" });
    expect((await call(db, "POST", "/api/phases/seal", { repoPath: "/r", name: "v1", moveOpenTo: next.id })).status).toBe(201);
    expect(db.getCard(open.id)!.phaseId).toBe(next.id);
  });

  it("migrates a board from before milestones: no phase is validated", () => {
    const file = join(mkdtempSync(join(tmpdir(), "collie-ms-")), "board.db");
    const old = new Database(file, { create: true });
    old.exec(`CREATE TABLE phase (id TEXT PRIMARY KEY, repo_path TEXT NOT NULL, name TEXT NOT NULL, goal TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0, roadmap_item_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
    old.exec(`INSERT INTO phase VALUES ('p1','/r','old','',0,NULL,1,1)`);
    old.close();
    const db = new BoardDb(file);
    expect(db.getPhase("p1")).toMatchObject({ closedAt: null, closedNote: "" });
    expect(db.closePhase("p1", { moveOpenTo: null })!.closedAt).toBeGreaterThan(0);
    db.close();
  });

  it("the step-by-step export says a validated phase in one line and does not list its cards", async () => {
    const { db, p1 } = board();
    await call(db, "POST", `/api/phases/${p1.id}/close`, { note: "shipped" });
    const md = (await call(db, "GET", "/api/roadmap?repo=%2Fr&format=steps")).body as string;
    expect(md).toContain("## Validated phases");
    expect(md).toMatch(/\*\*P1\*\* — validated \d{4}-\d\d-\d\d, 1 step — shipped/);
    expect(md).not.toContain("**done** —");
  });
});
