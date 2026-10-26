import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BoardDb, type JournalEntry } from "./db.ts";
import { Hlc } from "./journal.ts";

// ADR 0048 §2–3 and §6, lot 1: the outbox written in the write's transaction, the projection of
// incoming events, and a rebuild from the journal.

const REPO = "/r/shared";
const OTHER = "/r/local";
const A = "aaaaaaaaaaaa";
const B = "bbbbbbbbbbbb";

function board(): BoardDb {
  let t = 1_000;
  return new BoardDb(":memory:", () => t++);
}

function outbox(db: BoardDb, repo = REPO): JournalEntry[] {
  return db.journalOutbox(repo, new Hlc(A), "a@example.com");
}

/** A board's whole shared state for a repo, as comparable plain data. */
function sharedState(db: BoardDb, repo: string) {
  const d = db.dump() as Record<string, Record<string, unknown>[]>;
  const pick = (r: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, r[k]]));
  const cards = d.card!.filter((c) => c.repo_path === repo);
  const ids = new Set(cards.map((c) => c.id));
  const byId = (a: Record<string, unknown>, b: Record<string, unknown>) => String(a.id).localeCompare(String(b.id));
  return {
    cards: cards
      .map((c) => pick(c, ["id", "title", "spec", "acceptance", "status", "position", "phase_id", "run_id", "parent_id", "tag", "created_at"]))
      .sort(byId),
    runs: d.run!.filter((r) => r.repo_path === repo).map((r) => pick(r, ["id", "name", "phase_id", "launched_at", "max_parallel", "created_at"])).sort(byId),
    phases: d.phase!.filter((p) => p.repo_path === repo).map((p) => pick(p, ["id", "name", "goal", "closed_at", "closed_note", "created_at"])).sort(byId),
    roadmap: d.roadmap!.filter((r) => r.repo_path === repo).map((r) => pick(r, ["vision", "items", "decisions"])),
    reviews: d.review!.filter((r) => ids.has(r.card_id)).map((r) => pick(r, ["id", "card_id", "verdict", "notes", "todos", "created_at"])).sort(byId),
    events: d.event!
      .filter((e) => ids.has(e.card_id) && !/^(session|handoff|wrapup)\.|^card\.worktree$/.test(String(e.type)))
      .map((e) => pick(e, ["card_id", "type", "payload", "ts"]))
      .sort((a, b) => Number(a.ts) - Number(b.ts) || String(a.type).localeCompare(String(b.type))),
  };
}

/** Every kind of shareable write, plus the never-shared ones next to them. */
function fill(db: BoardDb): void {
  const phase = db.createPhase({ repoPath: REPO, name: "P1", goal: "ship" });
  const one = db.createCard({ title: "one", repoPath: REPO, acceptance: ["a", "b"], phaseId: phase.id, tag: "bug" });
  const two = db.createCard({ title: "two", repoPath: REPO, parentId: one.id });
  const gone = db.createCard({ title: "gone", repoPath: REPO });
  db.patchCard(one.id, { spec: "the spec", workspaceId: "ws-1" });
  db.setStatus(two.id, "ready", "test");
  const session = db.openSession({ cardId: one.id, paneId: "p1" });
  db.recordEvent(one.id, "card.worktree", { path: "/home/me/wt" });
  const review = db.createReview({ cardId: one.id, sessionId: session.id, verdict: "ok", notes: "fine", todos: [{ title: "t", tiny: { doneAt: null } } as never] });
  db.markTinyTodoDone(review.id, "t");
  db.createRun({ repoPath: REPO, cardIds: [two.id], foldInCap: 2, planned: true, name: "lot", phaseId: phase.id });
  db.putRoadmap(REPO, { vision: "v", items: [] }, 0);
  db.upsertDecision(REPO, { text: "d", status: "open" });
  db.updatePhase(phase.id, { goal: "ship it" });
  db.deleteCard(gone.id);
  db.putMemory(REPO, "remember");
  db.setRepoGate(REPO, "bun test");
}

describe("journal outbox", () => {
  test("a repo that is not shared journals nothing", () => {
    const db = board();
    fill(db);
    expect(outbox(db)).toEqual([]);
    expect((db.dump().journal_field as unknown[]).length).toBe(0);
  });

  test("a shared repo's writes are journaled, and only what may leave", () => {
    const db = board();
    db.setRepoShare(REPO, "origin");
    db.createCard({ title: "elsewhere", repoPath: OTHER });
    fill(db);
    const out = outbox(db);
    const types = new Set(out.map((e) => e.event.type));
    expect([...types].sort()).toEqual(["card.deleted", "card.event", "card.review", "card.set", "phase.set", "roadmap.set", "run.set"]);
    const text = JSON.stringify(out);
    // Never: a local path, a pane or workspace, a session, the gate, the orchestrator's memory, another repo.
    for (const never of [REPO, "/home/me/wt", "ws-1", "p1", "session.opened", "bun test", "remember", "elsewhere", "repo_path", "updated_at", "revision"])
      expect(text).not.toContain(never);
    // In hlc order, which is write order.
    const hlcs = out.map((e) => e.event.hlc);
    expect(hlcs).toEqual([...hlcs].sort());
    // A set carries only what changed.
    const specEdit = out.findLast((e) => e.event.type === "card.set" && "spec" in e.event.fields)!;
    expect(Object.keys(specEdit.event.fields)).toEqual(["spec"]);
  });

  test("a write that rolls back leaves no event", () => {
    const db = board();
    db.setRepoShare(REPO, "origin");
    const card = db.createCard({ title: "c", repoPath: REPO });
    const before = outbox(db).length;
    expect(() => db.createRun({ repoPath: REPO, cardIds: [card.id, "missing"], foldInCap: 1 })).toThrow();
    expect(db.listRuns(REPO)).toEqual([]);
    expect(outbox(db).length).toBe(before);
    expect(db.getCard(card.id)!.runId).toBeNull();
  });

  test("unsharing drops what was waiting", () => {
    const db = board();
    db.setRepoShare(REPO, "origin");
    db.createCard({ title: "c", repoPath: REPO });
    db.setRepoShare(REPO, null);
    expect(outbox(db)).toEqual([]);
    expect(db.repoShare(REPO)).toBeNull();
    db.createCard({ title: "d", repoPath: REPO });
    expect(outbox(db)).toEqual([]);
  });

  test("a restore is not a write", () => {
    const db = board();
    db.setRepoShare(REPO, "origin");
    db.createCard({ title: "c", repoPath: REPO });
    const n = outbox(db).length;
    db.restore(db.dump());
    expect(outbox(db).length).toBe(n);
  });
});

describe("journal projection", () => {
  test("rebuild from the journal reproduces the board, in any order", () => {
    const src = board();
    src.setRepoShare(REPO, "origin");
    fill(src);
    const entries = outbox(src);
    const want = sharedState(src, REPO);
    expect(want.cards.length).toBe(2);

    for (const order of [entries, [...entries].reverse()]) {
      const dst = board();
      dst.setRepoShare(REPO, "origin");
      dst.rebuildJournal(REPO, order, new Hlc(B));
      expect(sharedState(dst, REPO)).toEqual(want);
      expect(outbox(dst)).toEqual([]); // applying is not a local write
      // Idempotent: the same events again change nothing.
      dst.applyJournal(REPO, entries, new Hlc(B));
      expect(sharedState(dst, REPO)).toEqual(want);
    }
  });

  test("last writer per field, a tombstone is final, a local write after reading wins", () => {
    const db = board();
    db.setRepoShare(REPO, "origin");
    const card = db.createCard({ title: "mine", repoPath: REPO });
    const clock = new Hlc(A, () => 1_000_000);
    db.stampJournal(clock);
    const entity = `cards/${card.id}`;
    const set = (hlc: string, fields: Record<string, unknown>): JournalEntry => ({ entity, event: { v: 1, hlc, type: "card.set", by: "b@x", fields } });

    db.applyJournal(REPO, [set(`9999999999999.0000.${B}`, { title: "theirs", repo_path: "/evil", workspace_id: "w" }), set(`0000000000001.0000.${B}`, { spec: "old" })], clock);
    expect(db.getCard(card.id)!.title).toBe("theirs");
    expect(db.getCard(card.id)!.repoPath).toBe(REPO);
    expect(db.getCard(card.id)!.workspaceId).toBeNull();
    expect(db.getCard(card.id)!.spec).toBeNull(); // the local create set it later than this old event

    db.patchCard(card.id, { title: "after" });
    const mine = outbox(db).at(-1)!.event;
    expect(mine.hlc > `9999999999999.0000.${B}`).toBe(true); // the clock moved past what it read

    db.applyJournal(REPO, [{ entity, event: { v: 1, hlc: `0000000000002.0000.${B}`, type: "card.deleted", by: "b@x", fields: {} } }], clock);
    expect(db.getCard(card.id)).toBeNull();
    db.applyJournal(REPO, [set(`9999999999999.9999.${B}`, { title: "zombie" })], clock);
    expect(db.getCard(card.id)).toBeNull();
  });

  test("an event naming another repo's entity touches nothing", () => {
    const db = board();
    const local = db.createCard({ title: "local", repoPath: OTHER });
    db.applyJournal(REPO, [{ entity: `cards/${local.id}`, event: { v: 1, hlc: `0000000000009.0000.${B}`, type: "card.set", by: "b@x", fields: { title: "pwned" } } }], new Hlc(A));
    expect(db.getCard(local.id)!.title).toBe("local");
  });
});

test("migration: a board from before the journal opens, keeps its cards and gains the tables", () => {
  const file = join(mkdtempSync(join(tmpdir(), "journal-db-")), "board.db");
  const old = new BoardDb(file);
  const card = old.createCard({ title: "kept", repoPath: REPO });
  old.close();
  const raw = new Database(file);
  raw.exec("DROP TABLE journal_outbox; DROP TABLE journal_field; ALTER TABLE repo_pref DROP COLUMN share");
  raw.close();

  const db = new BoardDb(file);
  expect(db.getCard(card.id)!.title).toBe("kept");
  db.setRepoShare(REPO, "origin");
  db.patchCard(card.id, { title: "edited" });
  expect(outbox(db).filter((e) => e.event.type === "card.set").map((e) => e.event.fields)).toEqual([{ title: "edited" }]);
});
