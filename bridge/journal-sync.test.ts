import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitFreeEnv } from "../scripts/test-env.ts";

import { BoardDb } from "./db.ts";
import { ownJournal } from "./git.ts";
import { Hlc } from "./journal.ts";
import { FETCH_EVERY_MS, JournalSync, journalStatus, plan, readOnlyRefusal, SEND_EVERY_MS, type JournalGit, type RepoSync } from "./journal-sync.ts";
import type { EngineSnapshot } from "./state-engine.ts";

// ADR 0048 §3, lot 3: the sync consumer on engine.onUpdate — its throttle, and two installations
// (two boards, two clones, one bare remote) converging through it.

const A = "aaaaaaaaaaaa";
const B = "bbbbbbbbbbbb";
const SNAP: EngineSnapshot = { agents: [], shellPanes: [], workspaces: [], tabs: [], bridge: "connected" };

function sh(cwd: string, ...args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd, env: gitFreeEnv });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

/** A bare remote and `n` clones of it, each with an identity. */
function setup(n: number) {
  const root = mkdtempSync(join(tmpdir(), "journal-sync-"));
  const bare = join(root, "remote.git");
  sh(root, "init", "--bare", "-b", "main", bare);
  const clones = Array.from({ length: n }, (_, i) => {
    const dir = join(root, `clone${i}`);
    sh(root, "clone", "-q", bare, dir);
    sh(dir, "config", "user.email", `p${i}@t`);
    sh(dir, "config", "user.name", `p${i}`);
    sh(dir, "config", "commit.gpgsign", "false");
    return dir;
  });
  return { root, bare, clones };
}

/** One installation: its own board, clock and consumer, all on the shared test clock. */
function install(repo: string, pairId: string, clock: { t: number }, git?: JournalGit) {
  let w = 1_000;
  const db = new BoardDb(":memory:", () => w++);
  db.setRepoShare(repo, "origin");
  const sync = new JournalSync(db, new Hlc(pairId, () => clock.t), git, () => clock.t);
  return { db, sync, tick: () => sync.update(SNAP) };
}

const state = (over: Partial<RepoSync> = {}): RepoSync => ({
  busy: false, lastFetch: 0, lastSend: 0, refetch: false, offline: false, readOnly: null, rewritten: false, error: null, ...over,
});

describe("plan — the throttle, on an injected clock", () => {
  test("a fetch at most every 60 s, and always first", () => {
    expect(plan(state({ lastFetch: -Infinity }), 0, 0)).toEqual({ fetch: true });
    expect(plan(state(), FETCH_EVERY_MS - 1, 0)).toBeNull();
    expect(plan(state(), FETCH_EVERY_MS, 0)).toEqual({ fetch: true });
  });

  test("a send on the tick after a local write, at most every 10 s", () => {
    expect(plan(state(), SEND_EVERY_MS - 1, 3)).toBeNull();
    expect(plan(state(), SEND_EVERY_MS, 3)).toEqual({ fetch: false });
    expect(plan(state(), SEND_EVERY_MS, 0)).toBeNull();
  });

  test("one op in flight; rejected refetches next tick; offline and read-only wait for the fetch", () => {
    expect(plan(state({ busy: true, lastFetch: -Infinity }), 0, 1)).toBeNull();
    expect(plan(state({ refetch: true }), 1, 0)).toEqual({ fetch: true });
    expect(plan(state({ offline: true }), SEND_EVERY_MS, 5)).toBeNull();
    expect(plan(state({ readOnly: "no" }), SEND_EVERY_MS, 5)).toBeNull();
    expect(plan(state({ rewritten: true }), SEND_EVERY_MS, 5)).toBeNull();
    expect(plan(state({ offline: true }), FETCH_EVERY_MS, 5)).toEqual({ fetch: true });
  });
});

describe("JournalSync — the consumer", () => {
  const counting = () => {
    const calls = { receive: 0, send: 0 };
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const git: JournalGit = {
      receive: async () => (calls.receive++, await gate, { ok: true, entries: [] }),
      send: async () => (calls.send++, { ok: true, pushed: false }),
      email: async () => "me@t",
      remotes: async () => ["origin"],
      forget: async () => {},
      own: async () => [],
    };
    return { calls, git, release };
  };

  test("a disconnected snapshot does nothing; one git op per repo in flight", async () => {
    const clock = { t: 0 };
    const { calls, git, release } = counting();
    const { sync } = install("/r/sync-busy", A, clock, git);
    await sync.update({ ...SNAP, bridge: "disconnected" });
    expect(calls.receive).toBe(0);
    const first = sync.update(SNAP);
    clock.t += FETCH_EVERY_MS;
    void sync.update(SNAP); // still in flight: skipped
    expect(calls.receive).toBe(1);
    release();
    await first;
    expect(calls.send).toBe(1);
  });

  test("an unshared repo is never touched", async () => {
    const { calls, git, release } = counting();
    release();
    const { db, sync } = install("/r/sync-unshared", A, { t: 0 }, git);
    db.setRepoShare("/r/sync-unshared", null);
    await sync.update(SNAP);
    expect(calls).toEqual({ receive: 0, send: 0 });
    expect(journalStatus(db, "/r/sync-unshared")).toBeNull();
  });
});

describe("two installations, one bare remote", () => {
  test("cross writes converge, through a rejected push", async () => {
    const { clones } = setup(2);
    const [a, b] = clones as [string, string];
    const clock = { t: 1_000_000 };
    const pa = install(a, A, clock);
    const pb = install(b, B, clock);

    const card = pa.db.createCard({ title: "from A", repoPath: a });
    await pa.tick();
    expect(pa.db.journalUnsent(a)).toBe(0);
    await pb.tick();
    expect(pb.db.getCard(card.id)).toMatchObject({ title: "from A", repoPath: b });

    // Both write, A after B pushed and without fetching: its push is not a fast-forward.
    clock.t += SEND_EVERY_MS;
    pb.db.setStatus(card.id, "ready", "test");
    await pb.tick(); // send only (fetched 10 s ago)
    clock.t += 1;
    pa.db.patchCard(card.id, { spec: "A's spec" });
    clock.t += SEND_EVERY_MS;
    await pa.tick();
    expect(journalStatus(pa.db, a)!.error).toContain("rejected");
    expect(pa.db.journalUnsent(a)).toBeGreaterThan(0); // kept for the retry
    await pa.tick(); // the very next tick: fetch, unite, send again
    expect(pa.db.journalUnsent(a)).toBe(0);

    clock.t += FETCH_EVERY_MS;
    await pb.tick();
    const pick = (db: BoardDb) => {
      const c = db.getCard(card.id)!;
      return { title: c.title, spec: c.spec, status: c.status };
    };
    expect(pick(pa.db)).toEqual({ title: "from A", spec: "A's spec", status: "ready" });
    expect(pick(pb.db)).toEqual(pick(pa.db));
  });

  test("createdBy and assignee travel; every line is signed with the pair's git identity (ADR 0048 §5)", async () => {
    const { clones } = setup(2);
    const [a, b] = clones as [string, string];
    const clock = { t: 1_000_000 };
    const pa = install(a, A, clock);
    const pb = install(b, B, clock);
    await pa.tick(); // the first tick reads this pair's identity
    const card = pa.db.createCard({ title: "from A", repoPath: a, assignee: "p1@t" });
    expect(card.createdBy).toBe("p0@t");
    clock.t += SEND_EVERY_MS;
    await pa.tick();
    await pb.tick();
    expect(pb.db.getCard(card.id)).toMatchObject({ createdBy: "p0@t", assignee: "p1@t" });

    clock.t += SEND_EVERY_MS;
    pb.db.patchCard(card.id, { assignee: "p0@t" });
    await pb.tick();
    clock.t += FETCH_EVERY_MS;
    await pa.tick();
    expect(pa.db.getCard(card.id)).toMatchObject({ createdBy: "p0@t", assignee: "p0@t" });

    expect(new Set((await ownJournal(a, A)).map((e) => e.event.by))).toEqual(new Set(["p0@t"]));
    expect(new Set((await ownJournal(b, B)).map((e) => e.event.by))).toEqual(new Set(["p1@t"]));
  });

  test("offline: the unsent count is exact, nothing is retried before the next fetch, then it resumes", async () => {
    const { root, bare, clones } = setup(2);
    const [a, b] = clones as [string, string];
    const clock = { t: 1_000_000 };
    const pa = install(a, A, clock);
    const pb = install(b, B, clock);
    await pa.tick(); // first fetch, nothing yet

    sh(a, "remote", "set-url", "origin", join(root, "nowhere.git"));
    pa.db.createCard({ title: "one", repoPath: a });
    clock.t += SEND_EVERY_MS;
    await pa.tick();
    const status = journalStatus(pa.db, a)!;
    expect(status.offline).toBe(true);
    const n = status.unsent;
    expect(n).toBeGreaterThan(0);

    pa.db.createCard({ title: "two", repoPath: a });
    expect(journalStatus(pa.db, a)!.unsent).toBeGreaterThan(n);
    expect(journalStatus(pa.db, a)!.unsent).toBe(pa.db.journalUnsent(a));

    sh(a, "remote", "set-url", "origin", bare);
    clock.t += SEND_EVERY_MS;
    await pa.tick(); // offline: waits for the fetch's pace
    expect(pa.db.journalUnsent(a)).toBeGreaterThan(0);
    clock.t += FETCH_EVERY_MS;
    await pa.tick();
    expect(journalStatus(pa.db, a)).toMatchObject({ unsent: 0, offline: false, error: null });

    await pb.tick();
    expect(pb.db.listCards().map((c) => c.title).sort()).toEqual(["one", "two"]);
  });

  test("denied: the repo goes read-only for this pair, its entity writes are refused with the reason", async () => {
    const { bare, clones } = setup(1);
    const a = clones[0]!;
    writeFileSync(join(bare, "hooks", "pre-receive"), "#!/bin/sh\necho 'protected branch' >&2\nexit 1\n", { mode: 0o755 });
    const clock = { t: 1_000_000 };
    const pa = install(a, A, clock);
    const card = pa.db.createCard({ title: "x", repoPath: a });
    const phase = pa.db.createPhase({ repoPath: a, name: "P", goal: "g" });
    await pa.tick();
    const reason = journalStatus(pa.db, a)!.readOnly;
    expect(reason).toContain("read-only");
    expect(reason).toContain("protected branch");

    const req = (method: string, path: string, body?: unknown) =>
      new Request(`http://x${path}`, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
    expect(await readOnlyRefusal("/api/cards", req("POST", "/api/cards", { title: "y", repoPath: a }), pa.db)).toBe(reason);
    expect(await readOnlyRefusal(`/api/cards/${card.id}`, req("PATCH", `/api/cards/${card.id}`, { title: "z" }), pa.db)).toBe(reason);
    expect(await readOnlyRefusal(`/api/phases/${phase.id}`, req("DELETE", `/api/phases/${phase.id}`), pa.db)).toBe(reason);
    expect(await readOnlyRefusal("/api/roadmap", req("PUT", "/api/roadmap", { repoPath: a }), pa.db)).toBe(reason);
    expect(await readOnlyRefusal("/api/runs", req("POST", "/api/runs", { cardIds: [card.id] }), pa.db)).toBe(reason);
    // Reads, a deliverable, and another repo stay open.
    expect(await readOnlyRefusal(`/api/cards/${card.id}`, req("GET", `/api/cards/${card.id}`), pa.db)).toBeNull();
    expect(await readOnlyRefusal(`/api/cards/${card.id}/deliverables`, req("POST", `/api/cards/${card.id}/deliverables`), pa.db)).toBeNull();
    expect(await readOnlyRefusal("/api/cards", req("POST", "/api/cards", { title: "y", repoPath: "/r/other" }), pa.db)).toBeNull();

    pa.db.setRepoShare(a, null);
    expect(await readOnlyRefusal("/api/cards", req("POST", "/api/cards", { title: "y", repoPath: a }), pa.db)).toBeNull();
    pa.db.setRepoShare(a, "origin");

    // The right comes back: the next fetch's send gets through and lifts it.
    sh(bare, "config", "core.hooksPath", "/dev/null");
    clock.t += FETCH_EVERY_MS;
    await pa.tick();
    expect(journalStatus(pa.db, a)).toMatchObject({ readOnly: null, unsent: 0 });
  });
});
