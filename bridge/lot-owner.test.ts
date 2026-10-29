import { describe, expect, test } from "bun:test";

import { handleBoardRoute } from "./board-routes.ts";
import { assignedElsewhere, lotOwnerRefusal } from "./claim.ts";
import { BoardDb } from "./db.ts";
import { Hlc } from "./journal.ts";

// ADR 0048 §7: a lot belongs to the pair that created it, and its coarse state — launched, running,
// finished — reaches the other pairs; its current step stays local.

const REPO = "/r/shared";
const A = "aaaaaaaaaaaa";
const B = "bbbbbbbbbbbb";

function pair(id: string, email: string): BoardDb {
  let t = 1_000;
  const db = new BoardDb(":memory:", () => t++);
  db.setRepoShare(REPO, "origin");
  db.setPairId(id);
  db.setPeerIdentity(REPO, email);
  return db;
}

/** Everything `from` has to send, applied on `to` — one sync tick, without git. */
function sync(from: BoardDb, fromId: string, to: BoardDb, toId: string): void {
  to.applyJournal(REPO, from.journalOutbox(REPO, new Hlc(fromId), "x@x"), new Hlc(toId));
}

describe("a lot belongs to its creator (ADR 0048 §7)", () => {
  test("createdBy and createdPair are derived, travel with the lot, and only the creator owns it", () => {
    const a = pair(A, "alice@x");
    const b = pair(B, "bob@x");
    const card = a.createCard({ title: "c", repoPath: REPO });
    const lot = a.createRun({ repoPath: REPO, cardIds: [card.id], foldInCap: 0, planned: true, name: "L" });
    expect(lot).toMatchObject({ createdBy: "alice@x", createdPair: A });
    sync(a, A, b, B);

    const seen = b.getRun(lot.id)!;
    expect(seen).toMatchObject({ createdBy: "alice@x", createdPair: A });
    expect(a.ownsRun(lot)).toBe(true);
    expect(b.ownsRun(seen)).toBe(false);
    expect(lotOwnerRefusal(a, lot)).toBeNull();
    expect(lotOwnerRefusal(b, seen)).toContain("alice@x");
  });

  test("an unshared repo's lot is everyone's, as before", () => {
    const db = new BoardDb(":memory:");
    db.setPairId(A);
    const card = db.createCard({ title: "c", repoPath: "/r/local" });
    const lot = db.createRun({ repoPath: "/r/local", cardIds: [card.id], foldInCap: 0 });
    expect(lot).toMatchObject({ createdBy: null, createdPair: null });
    expect(db.ownsRun(lot)).toBe(true);
  });

  test("launched, running, finished: the other pair sees each, and never drives it", () => {
    const a = pair(A, "alice@x");
    const b = pair(B, "bob@x");
    const card = a.createCard({ title: "c", repoPath: REPO });
    const lot = a.createRun({ repoPath: REPO, cardIds: [card.id], foldInCap: 0, planned: true });
    a.launchRun(lot.id);
    sync(a, A, b, B);
    // Running on A: B lists it open (a phase is not validated under it) but does not own it.
    const open = b.listOpenRuns();
    expect(open.map((r) => r.id)).toEqual([lot.id]);
    expect(open.filter((r) => b.ownsRun(r))).toEqual([]);
    expect(b.runFinishedAt(lot.id)).toBeNull();

    // A's coordinator finishes it: the event stays local, `finished_at` travels.
    a.recordRunEvent(null, "run.finished", { runId: lot.id });
    sync(a, A, b, B);
    expect(b.runFinishedAt(lot.id)).not.toBeNull();
    expect(b.listOpenRuns()).toEqual([]);
    expect(b.listEvents(card.id, 50).some((e) => e.type === "run.finished")).toBe(false);
    expect(a.runFinishedAt(lot.id)).not.toBeNull();
  });
});

describe("an agent never launches another person's card (ADR 0048 §7)", () => {
  test("assigned to someone else: refused; to me, unassigned, or unshared: allowed", () => {
    const db = pair(A, "alice@x");
    expect(assignedElsewhere(db, { repoPath: REPO, assignee: "bob@x" })).toContain("bob@x");
    expect(assignedElsewhere(db, { repoPath: REPO, assignee: "alice@x" })).toBeNull();
    expect(assignedElsewhere(db, { repoPath: REPO, assignee: null })).toBeNull();
    expect(assignedElsewhere(db, { repoPath: "/r/local", assignee: "bob@x" })).toBeNull();
  });
});

describe("the routes refuse (ADR 0048 §7)", () => {
  const ctx = (db: BoardDb) =>
    ({ db, audit: { record: () => {} }, guard: () => null, json: (d: unknown, status = 200) => new Response(JSON.stringify(d), { status }), text: (b: string, status: number) => new Response(b, { status }) }) as never;
  const post = async (db: BoardDb, path: string, headers: Record<string, string> = {}) => {
    const res = await handleBoardRoute(path, new Request(`http://x${path}`, { method: "POST", headers }), ctx(db));
    return { status: res!.status, text: await res!.text() };
  };

  test("another pair's lot: not launched, not resumed — even by the operator", async () => {
    const a = pair(A, "alice@x");
    const b = pair(B, "bob@x");
    const card = a.createCard({ title: "c", repoPath: REPO });
    const planned = a.createRun({ repoPath: REPO, cardIds: [card.id], foldInCap: 0, planned: true });
    const c2 = a.createCard({ title: "d", repoPath: REPO });
    const running = a.createRun({ repoPath: REPO, cardIds: [c2.id], foldInCap: 0 });
    sync(a, A, b, B);
    const launch = await post(b, `/api/runs/${planned.id}/launch`);
    expect(launch.status).toBe(403);
    expect(launch.text).toContain("alice@x");
    expect((await post(b, `/api/runs/${running.id}/resume`)).status).toBe(403);
    expect(b.getRun(planned.id)!.launchedAt).toBeNull();
  });

  test("an agent pane does not start a card assigned to someone else", async () => {
    const a = pair(A, "alice@x");
    const card = a.createCard({ title: "c", repoPath: REPO, assignee: "bob@x" });
    const r = await post(a, `/api/cards/${card.id}/start`, { "x-collie-pane": "o1" });
    expect(r.status).toBe(403);
    expect(r.text).toContain("bob@x");
  });
});
