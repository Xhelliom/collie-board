import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";

import { handleBoardRoute } from "./board-routes.ts";
import { BoardDb } from "./db.ts";

describe("runs (ADR 0017)", () => {
  it("migrates a board from before runs without losing a card", () => {
    const file = join(mkdtempSync(join(tmpdir(), "collie-run-")), "board.db");
    // The card table as it stood before `run_id`, and no `run` table at all.
    const old = new Database(file, { create: true });
    old.exec(`CREATE TABLE card (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, spec TEXT, raw_input TEXT, acceptance TEXT,
      status TEXT NOT NULL, repo_path TEXT, base_ref TEXT, branch TEXT, workspace_id TEXT,
      agent_kind TEXT, position INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL)`);
    old.exec(`INSERT INTO card (id, title, acceptance, status, repo_path, created_at, updated_at)
              VALUES ('c1', 'old card', '["a"]', 'ready', '/repo', 1, 1)`);
    old.close();

    const db = new BoardDb(file);
    const card = db.getCard("c1")!;
    expect(card).toMatchObject({ title: "old card", acceptance: ["a"], status: "ready", runId: null });

    const run = db.createRun({ repoPath: "/repo", cardIds: ["c1"], foldInCap: 2, leadAgent: "claude" });
    expect(db.getRun(run.id)).toMatchObject({ repoPath: "/repo", foldInCap: 2, leadAgent: "claude" });
    expect(db.runMembers(run.id).map((c) => c.id)).toEqual(["c1"]);
    db.close();
  });

  it("refuses a card of another repo, writing nothing", () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/repo" });
    const b = db.createCard({ title: "b", repoPath: "/other" });
    expect(() => db.createRun({ repoPath: "/repo", cardIds: [a.id, b.id], foldInCap: 0 })).toThrow();
    expect(db.getCard(a.id)!.runId).toBeNull();
    expect(db.dump().run).toEqual([]);
  });

  it("journals a run.* kind with its payload", () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/repo" });
    const run = db.createRun({ repoPath: "/repo", cardIds: [a.id], foldInCap: 1 });
    db.recordRunEvent(a.id, "run.decision", { runId: run.id, decision: "prompt", reason: "criterion 2", prompt: "commit" });
    expect(db.listEvents(a.id)[0]).toMatchObject({
      type: "run.decision",
      payload: { runId: run.id, decision: "prompt", reason: "criterion 2", prompt: "commit" },
    });
  });
});

describe("POST /api/runs", () => {
  /** A herdr that fails the test the moment anything reaches for it — the route must start nothing. */
  const herdrTouched: string[] = [];
  const herdr = new Proxy({}, { get: (_t, key) => (herdrTouched.push(String(key)), () => { throw new Error("herdr reached"); }) });
  const ctx = (db: BoardDb) =>
    ({
      db,
      herdr,
      engine: { current: () => { throw new Error("engine reached"); } },
      copilot: {},
      cfg: {},
      audit: { record: () => {} },
      session: "default",
      guard: () => null,
      device: null,
      json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
      text: (body: string, status: number) => new Response(body, { status }),
    }) as never;
  const post = (db: BoardDb, body: unknown) =>
    handleBoardRoute("/api/runs", new Request("http://x/api/runs", { method: "POST", body: JSON.stringify(body) }), ctx(db));

  it("records the run on exactly the chosen cards, and starts none of them", async () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/repo" });
    const b = db.createCard({ title: "b", repoPath: "/repo", status: "ready" });
    const left = db.createCard({ title: "not chosen", repoPath: "/repo" });
    const res = await post(db, { cardIds: [a.id, b.id], foldInCap: 3, leadAgent: "codex" });
    expect(res!.status).toBe(201);
    const { run } = (await res!.json()) as { run: { id: string } };
    expect(db.getRun(run.id)).toMatchObject({ repoPath: "/repo", foldInCap: 3, leadAgent: "codex" });
    expect(db.runMembers(run.id).map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
    expect(db.getCard(left.id)!.runId).toBeNull();
    // Nothing started: statuses as they were, no session, herdr never touched.
    expect([db.getCard(a.id)!.status, db.getCard(b.id)!.status]).toEqual(["backlog", "ready"]);
    expect(db.dump().session).toEqual([]);
    expect(herdrTouched).toEqual([]);
  });

  it("refuses a set spanning two repos, writing nothing", async () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/repo" });
    const b = db.createCard({ title: "b", repoPath: "/other" });
    expect((await post(db, { cardIds: [a.id, b.id], foldInCap: 1 }))!.status).toBe(400);
    expect(db.dump().run).toEqual([]);
  });

  it("refuses a card already in a run, a bad cap and an empty set", async () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/repo" });
    db.createRun({ repoPath: "/repo", cardIds: [a.id], foldInCap: 0 });
    expect((await post(db, { cardIds: [a.id], foldInCap: 1 }))!.status).toBe(409);
    const b = db.createCard({ title: "b", repoPath: "/repo" });
    expect((await post(db, { cardIds: [b.id], foldInCap: -1 }))!.status).toBe(400);
    expect((await post(db, { cardIds: [], foldInCap: 1 }))!.status).toBe(400);
    expect((await post(db, { cardIds: ["nope"], foldInCap: 1 }))!.status).toBe(404);
  });
});
