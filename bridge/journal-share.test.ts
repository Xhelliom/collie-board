import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitFreeEnv } from "../scripts/test-env.ts";

import { handleBoardRoute } from "./board-routes.ts";
import { BoardDb } from "./db.ts";
import { Hlc } from "./journal.ts";
import { FETCH_EVERY_MS, JournalSync, journalStatus } from "./journal-sync.ts";
import type { EngineSnapshot } from "./state-engine.ts";

// ADR 0048 §1 and §6: sharing a repo's board is the operator's gesture — activation on an absent and
// on a present branch, deactivation, re-activation — against a bare remote in a temp dir.

const A = "aaaaaaaaaaaa";
const B = "bbbbbbbbbbbb";
const SNAP: EngineSnapshot = { agents: [], shellPanes: [], workspaces: [], tabs: [], bridge: "connected" };

function sh(cwd: string, ...args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd, env: gitFreeEnv });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

function setup(n: number) {
  const root = mkdtempSync(join(tmpdir(), "journal-share-"));
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

/** An installation NOT shared: a board with cards of its own, and its consumer. */
function install(repo: string, pairId: string, clock: { t: number }) {
  let w = 1_000;
  const db = new BoardDb(":memory:", () => w++);
  const sync = new JournalSync(db, new Hlc(pairId, () => clock.t), undefined, () => clock.t);
  const backups: string[] = [];
  const backup = async () => {
    // What the backup sees is the board before anything was fetched or imported.
    backups.push(JSON.stringify(db.listCards().map((c) => c.title)));
    return `/backups/${backups.length}`;
  };
  return { db, sync, backups, activate: () => sync.activate(repo, "origin", backup), tick: () => sync.update(SNAP) };
}

const branchOf = (bare: string) => Bun.spawnSync(["git", "rev-parse", "--verify", "-q", "collie-board"], { cwd: bare, env: gitFreeEnv }).stdout.toString().trim();

describe("activation (§ 6)", () => {
  test("off by default: nothing is journaled before the gesture", () => {
    const db = new BoardDb(":memory:");
    db.createCard({ title: "local", repoPath: "/r/x" });
    expect(db.repoShare("/r/x")).toBeNull();
    expect(db.journalUnsent("/r/x")).toBe(0);
  });

  test("branch absent: backup first, every entity imported, one « import » commit pushed on an orphan branch", async () => {
    const { bare, clones } = setup(1);
    const a = clones[0]!;
    const pa = install(a, A, { t: 1_000_000 });
    pa.db.createCard({ title: "c1", repoPath: a });
    pa.db.createPhase({ repoPath: a, name: "P" });
    pa.db.putRoadmap(a, { vision: "v", items: [] }, 0);
    pa.db.createCard({ title: "elsewhere", repoPath: "/r/other" });

    const r = await pa.activate();
    expect(r).toEqual({ ok: true, backup: "/backups/1", existed: false, imported: 3, pushed: true, error: null });
    expect(pa.backups).toHaveLength(1);
    expect(pa.db.repoShare(a)).toBe("origin");
    expect(pa.db.journalUnsent(a)).toBe(0);
    expect(sh(bare, "log", "-1", "--format=%s", "collie-board")).toContain("import");
    expect(sh(bare, "rev-list", "--count", "collie-board").trim()).toBe("1");
    expect(sh(bare, "ls-tree", "-r", "--name-only", "collie-board").split("\n").filter(Boolean)).toHaveLength(3);
  });

  test("branch present: rebuilt from the journal, then the unknown local entities imported", async () => {
    const { clones } = setup(2);
    const [a, b] = clones as [string, string];
    const clock = { t: 1_000_000 };
    const pa = install(a, A, clock);
    const ca = pa.db.createCard({ title: "from A", repoPath: a });
    await pa.activate();

    const pb = install(b, B, clock);
    const cb = pb.db.createCard({ title: "from B", repoPath: b });
    clock.t += 1;
    const r = await pb.activate();
    expect(r).toMatchObject({ ok: true, existed: true, imported: 1, pushed: true });
    expect(pb.db.getCard(ca.id)).toMatchObject({ title: "from A", repoPath: b });

    clock.t += FETCH_EVERY_MS;
    await pa.tick();
    expect(pa.db.getCard(cb.id)).toMatchObject({ title: "from B", repoPath: a });
  });

  test("a remote the repo does not have is refused, and nothing is shared", async () => {
    const { clones } = setup(1);
    const pa = install(clones[0]!, A, { t: 1 });
    expect(await pa.sync.activate(clones[0]!, "nope", async () => "x")).toMatchObject({ ok: false });
    expect(pa.db.repoShare(clones[0]!)).toBeNull();
    expect(pa.backups).toHaveLength(0);
  });
});

describe("deactivation and re-activation (§ 6)", () => {
  test("stops, drops the outbox and journal_field, leaves the remote branch; re-activating lets the journal win", async () => {
    const { bare, clones } = setup(1);
    const a = clones[0]!;
    const clock = { t: 1_000_000 };
    const pa = install(a, A, clock);
    const card = pa.db.createCard({ title: "shared", repoPath: a });
    await pa.activate();
    const head = branchOf(bare);

    pa.db.patchCard(card.id, { title: "unsent" });
    const unsent = pa.db.journalUnsent(a);
    expect(unsent).toBeGreaterThan(0);
    expect(pa.sync.deactivate(a)).toBe(unsent);
    expect(pa.db.repoShare(a)).toBeNull();
    expect(pa.db.journalUnsent(a)).toBe(0);
    expect(journalStatus(pa.db, a)).toBeNull();
    expect(branchOf(bare)).toBe(head);

    // Edited while unshared: nothing journaled, and lost on re-activation — the backup kept it.
    pa.db.patchCard(card.id, { title: "edited offline" });
    expect(pa.db.journalUnsent(a)).toBe(0);
    clock.t += 1;
    expect(await pa.activate()).toMatchObject({ ok: true, existed: true, imported: 0 });
    expect(pa.backups.at(-1)).toContain("edited offline");
    expect(pa.db.getCard(card.id)!.title).toBe("shared");
  });
});

describe("/api/repos/share — the operator's route", () => {
  const ctx = (db: BoardDb, stateDir: string) =>
    ({
      db,
      cfg: { stateDir },
      audit: { record: () => {} },
      session: "default",
      guard: () => null,
      device: null,
      json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
      text: (body: string, status: number) => new Response(body, { status }),
    }) as never;
  const call = async (db: BoardDb, stateDir: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await handleBoardRoute(
      path.split("?")[0]!,
      new Request(`http://x${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
      ctx(db, stateDir),
    );
    return { status: res!.status, body: await res!.json().catch(() => null) };
  };

  test("refused to an agent pane; the branch is only signalled; the gesture takes a real backup", async () => {
    const { root, clones } = setup(2);
    const [a, b] = clones as [string, string];
    const clock = { t: 1_000_000 };
    const pa = install(a, A, clock);
    pa.db.createCard({ title: "c", repoPath: a });
    await pa.activate();

    const pb = install(b, B, clock);
    const stateDir = mkdtempSync(join(root, "state-"));
    const pane = await call(pb.db, stateDir, "POST", "/api/repos/share", { path: b, remote: "origin" }, { "x-collie-pane": "p1" });
    expect(pane.status).toBe(403);
    expect(pb.db.repoShare(b)).toBeNull();

    const seen = await call(pb.db, stateDir, "GET", `/api/repos/share?repo=${encodeURIComponent(b)}`);
    expect(seen.body).toMatchObject({ share: null, remotes: ["origin"], remote: "origin", branch: true, wasShared: false, identity: "p1@t", sync: null });
    expect(pb.db.repoShare(b)).toBeNull();

    const on = await call(pb.db, stateDir, "POST", "/api/repos/share", { path: b, remote: "origin" });
    expect(on.body).toMatchObject({ ok: true, existed: true });
    expect(JSON.parse(readFileSync(on.body.backup, "utf8")).kind).toBe("collie-board-backup");
    expect(pb.db.listCards().map((c) => c.title)).toEqual(["c"]);

    pb.db.createCard({ title: "unsent", repoPath: b });
    const unsent = pb.db.journalUnsent(b);
    const off = await call(pb.db, stateDir, "POST", "/api/repos/share", { path: b, remote: null });
    expect(off.body).toEqual({ ok: true, dropped: unsent });
    expect((await call(pb.db, stateDir, "GET", `/api/repos/share?repo=${encodeURIComponent(b)}`)).body).toMatchObject({ share: null, wasShared: true });
  });

  test("« Renvoyer mon journal »: a force-push is signalled, holds the sends, and the resend restores it for every pair", async () => {
    const { root, bare, clones } = setup(2);
    const [a, b] = clones as [string, string];
    const clock = { t: 1_000_000 };
    const stateDir = mkdtempSync(join(root, "state-"));
    const pa = install(a, A, clock);
    const c1 = pa.db.createCard({ title: "first", repoPath: a });
    await pa.activate();
    const old = branchOf(bare);
    const c2 = pa.db.createCard({ title: "second", repoPath: a });
    clock.t += FETCH_EVERY_MS;
    await pa.tick();
    expect(branchOf(bare)).not.toBe(old);

    sh(bare, "update-ref", "refs/heads/collie-board", old); // someone force-pushes an older state
    clock.t += FETCH_EVERY_MS;
    await pa.tick();
    expect(journalStatus(pa.db, a)).toMatchObject({ rewritten: true });
    // Held: a write here does not build on the rewritten branch.
    pa.db.patchCard(c1.id, { title: "first, edited" });
    clock.t += FETCH_EVERY_MS;
    await pa.tick();
    expect(branchOf(bare)).toBe(old);

    const route = (headers: Record<string, string> = {}) => call(pa.db, stateDir, "POST", "/api/repos/share/resend", { path: a }, headers);
    expect((await route({ "x-collie-pane": "p1" })).status).toBe(403);
    expect(branchOf(bare)).toBe(old);
    const r = await route();
    expect(r).toMatchObject({ status: 200, body: { ok: true } });
    expect(journalStatus(pa.db, a)).toMatchObject({ rewritten: false, unsent: 0, error: null });
    const lines = sh(bare, "show", `collie-board:cards/${c1.id}/${A}.jsonl`);

    // Idempotent: a second resend adds no line.
    expect((await route()).body).toMatchObject({ ok: true });
    expect(sh(bare, "show", `collie-board:cards/${c1.id}/${A}.jsonl`)).toBe(lines);

    // Another pair, sharing afterwards, gets everything.
    const pb = install(b, B, clock);
    clock.t += 1;
    await pb.activate();
    expect(pb.db.getCard(c1.id)?.title).toBe("first, edited");
    expect(pb.db.getCard(c2.id)?.title).toBe("second");
  });
});
