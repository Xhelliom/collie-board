import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";

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
