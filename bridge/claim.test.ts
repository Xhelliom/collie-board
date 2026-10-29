import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitFreeEnv } from "../scripts/test-env.ts";

import { claimForLaunch, claimHolder } from "./claim.ts";
import { BoardDb } from "./db.ts";
import { Hlc } from "./journal.ts";
import { FETCH_EVERY_MS, JournalSync } from "./journal-sync.ts";
import type { EngineSnapshot } from "./state-engine.ts";

// ADR 0048 §7: launching a shared card claims it first, by a synchronous push — two pairs, two
// bases, one bare remote in a temp dir; only one claim of a card ever wins.

const A = "aaaaaaaaaaaa";
const B = "bbbbbbbbbbbb";
const SNAP: EngineSnapshot = { agents: [], shellPanes: [], workspaces: [], tabs: [], bridge: "connected" };

function sh(cwd: string, ...args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd, env: gitFreeEnv });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

function install(repo: string, pairId: string, clock: { t: number }) {
  let w = 1_000;
  const db = new BoardDb(":memory:", () => w++);
  const sync = new JournalSync(db, new Hlc(pairId, () => clock.t), undefined, () => clock.t);
  return { db, sync, activate: () => sync.activate(repo, "origin", async () => "/backup"), tick: () => sync.update(SNAP) };
}

/** Two pairs sharing one repo's board, B having read the card A filed. */
async function twoPairs() {
  const root = mkdtempSync(join(tmpdir(), "claim-"));
  const bare = join(root, "remote.git");
  sh(root, "init", "--bare", "-b", "main", bare);
  const [a, b] = [0, 1].map((i) => {
    const dir = join(root, `clone${i}`);
    sh(root, "clone", "-q", bare, dir);
    sh(dir, "config", "user.email", `p${i}@t`);
    return dir;
  }) as [string, string];
  const clock = { t: 1_000_000 };
  const pa = install(a, A, clock);
  const card = pa.db.createCard({ title: "shared", repoPath: a, status: "ready" });
  await pa.activate();
  const pb = install(b, B, clock);
  clock.t += 1;
  await pb.activate();
  expect(pb.db.getCard(card.id)).toMatchObject({ title: "shared", repoPath: b, claim: null });
  return { root, bare, a, b, clock, pa, pb, id: card.id };
}

describe("claiming a shared card (§ 7)", () => {
  test("two pairs claim the same card: the first push wins, the other is refused with who and when", async () => {
    const { a, b, clock, pa, pb, id } = await twoPairs();
    clock.t = Date.UTC(2026, 9, 29, 9, 32);
    expect(await pa.sync.claim(a, id)).toEqual({ ok: true });
    expect(pa.db.getCard(id)!.claim).toMatchObject({ pair: A, by: "p0@t" });

    // B has not read A's claim: its push is refused, it fetches, and sees the card taken.
    const r = await pb.sync.claim(b, id);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/^taken by p0@t at \d\d:\d\d$/);
    expect(pb.db.getCard(id)!.claim).toMatchObject({ pair: A, by: "p0@t" });
    expect(claimHolder(pb.db.getCard(id)!, B)).toMatchObject({ by: "p0@t" });
    // Its own claim never reached the remote, nor its board.
    clock.t += FETCH_EVERY_MS;
    await pa.tick();
    expect(pa.db.getCard(id)!.claim!.pair).toBe(A);
    // Claiming again your own card does not push: it is already yours on the remote.
    expect(await pa.sync.claim(a, id)).toEqual({ ok: true });
  });

  test("raced at once: exactly one claim wins", async () => {
    const { a, b, pa, pb, id } = await twoPairs();
    const [ra, rb] = await Promise.all([pa.sync.claim(a, id), pb.sync.claim(b, id)]);
    expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);
  });

  test("done releases the claim; « reprendre la main » takes it over", async () => {
    const { a, b, clock, pa, pb, id } = await twoPairs();
    await pa.sync.claim(a, id);
    clock.t += 1;
    expect(await pb.sync.claim(b, id, true)).toEqual({ ok: true });
    expect(pb.db.getCard(id)!.claim!.pair).toBe(B);
    clock.t += FETCH_EVERY_MS;
    await pa.tick();
    expect(claimHolder(pa.db.getCard(id)!, A)).toMatchObject({ pair: B });

    pb.db.setStatus(id, "done", "test");
    clock.t += FETCH_EVERY_MS;
    await pb.tick();
    await pa.tick();
    expect(pa.db.getCard(id)!.status).toBe("done");
    expect(claimHolder(pa.db.getCard(id)!, A)).toBeNull();
  });

  test("offline: refused, unless the card is assigned to this pair", async () => {
    const { root, a, pa, id } = await twoPairs();
    sh(a, "remote", "set-url", "origin", join(root, "gone.git"));
    // Constructed last, so claimForLaunch reaches this pair's sync.
    const solo = new JournalSync(pa.db, new Hlc(A));
    void solo;
    expect(await claimForLaunch(pa.db, pa.db.getCard(id)!)).toMatch(/^offline: /);
    pa.db.patchCard(id, { assignee: "p0@t" });
    expect(await claimForLaunch(pa.db, pa.db.getCard(id)!)).toBeNull();
    pa.db.patchCard(id, { assignee: "someone@else" });
    expect(await claimForLaunch(pa.db, pa.db.getCard(id)!)).toMatch(/^offline: /);
  });

  test("an unshared repo is untouched: nothing claimed, nothing pushed", async () => {
    const db = new BoardDb(":memory:");
    new JournalSync(db, new Hlc(A));
    const card = db.createCard({ title: "local", repoPath: "/r/x" });
    expect(await claimForLaunch(db, card)).toBeNull();
    expect(db.getCard(card.id)!.claim).toBeNull();
    expect(db.journalUnsent("/r/x")).toBe(0);
  });
});
