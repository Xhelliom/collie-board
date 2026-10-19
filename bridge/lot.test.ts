import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitFreeEnv } from "../scripts/test-env.ts";

import { BoardDb } from "./db.ts";
import { baseOf } from "./git.ts";
import { ensureLotBranch, foldIntoLot, lotBranchOf, lotPrCard, lotView, prepareLot } from "./lot.ts";

const sh = (cwd: string, ...args: string[]) => {
  const p = Bun.spawnSync(["git", ...args], { cwd, env: gitFreeEnv });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
};
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "lot-"));
  sh(dir, "init", "-q", "-b", "main");
  sh(dir, "config", "user.email", "t@t");
  sh(dir, "config", "user.name", "t");
  writeFileSync(join(dir, "base.txt"), "base\n");
  sh(dir, "add", "."), sh(dir, "commit", "-qm", "base");
  return dir;
};
/** A card: a branch forked from `from`, one commit adding `file`. Checked out in a worktree, like a real card. */
const card = (dir: string, branch: string, from: string, file: string, body = file) => {
  const wt = `${dir}-${branch.replace("/", "-")}`;
  sh(dir, "worktree", "add", "-q", "-b", branch, wt, from);
  writeFileSync(join(wt, file), `${body}\n`);
  sh(wt, "add", "."), sh(wt, "commit", "-qm", `work ${file}`);
  return wt;
};

describe("lotBranchOf", () => {
  it("is board/lot-<slug>, stable and unique per lot", () => {
    expect(lotBranchOf({ id: "abcdef123", name: "Écran carte & co" })).toBe("board/lot-ecran-carte-co-abcdef");
    expect(lotBranchOf({ id: "abcdef123", name: null })).toBe("board/lot-abcdef");
  });
});

describe("a lot's branch (ADR 0041)", () => {
  it("3 cards: each forks from the lot, folds locally, and the lot holds all three", async () => {
    const dir = repo();
    const lot = "board/lot-x";
    expect(await ensureLotBranch(dir, lot, "main")).toEqual({ ok: true });
    expect(await ensureLotBranch(dir, lot, "main")).toEqual({ ok: true }); // idempotent

    card(dir, "board/c1", lot, "one.txt");
    expect(await foldIntoLot(dir, lot, "board/c1")).toEqual({ ok: true, merged: true });
    // card 2 starts from the lot: it sees card 1's work.
    const wt2 = card(dir, "board/c2", lot, "two.txt");
    expect(sh(wt2, "ls-files")).toContain("one.txt");
    expect(await foldIntoLot(dir, lot, "board/c2")).toEqual({ ok: true, merged: true });
    card(dir, "board/c3", lot, "three.txt");
    expect(await foldIntoLot(dir, lot, "board/c3")).toEqual({ ok: true, merged: true });

    expect(sh(dir, "ls-tree", "--name-only", lot).split("\n")).toEqual(["base.txt", "one.txt", "three.txt", "two.txt"]);
    expect(sh(dir, "log", "--merges", "--format=%s", `main..${lot}`).split("\n")).toHaveLength(3);
    // main and the main checkout are untouched.
    expect(sh(dir, "rev-parse", "main")).not.toBe(sh(dir, "rev-parse", lot));
    expect(sh(dir, "status", "--porcelain")).toBe("");
  });

  it("a branch already in the lot is a no-op", async () => {
    const dir = repo();
    await ensureLotBranch(dir, "board/lot-x", "main");
    card(dir, "board/c1", "board/lot-x", "one.txt");
    await foldIntoLot(dir, "board/lot-x", "board/c1");
    expect(await foldIntoLot(dir, "board/lot-x", "board/c1")).toEqual({ ok: true, merged: false });
  });

  it("a card forked before a sibling landed and touching the same file: conflict, lot untouched", async () => {
    const dir = repo();
    const lot = "board/lot-x";
    await ensureLotBranch(dir, lot, "main");
    card(dir, "board/c1", lot, "same.txt", "from 1");
    card(dir, "board/c2", lot, "same.txt", "from 2");
    await foldIntoLot(dir, lot, "board/c1");
    const before = sh(dir, "rev-parse", lot);
    expect(await foldIntoLot(dir, lot, "board/c2")).toMatchObject({ ok: false, kind: "conflict", files: ["same.txt"] });
    expect(sh(dir, "rev-parse", lot)).toBe(before);
  });

  it("the lot branch is created from the base, and refused when the base is unknown", async () => {
    const dir = repo();
    expect(await ensureLotBranch(dir, "board/lot-y", "nope")).toMatchObject({ ok: false });
  });
});

describe("lotPrCard — the lot's PR is read through any of its cards", () => {
  const c = { id: "c", branch: "board/c1", baseRef: "board/lot-x" } as never;
  it("a lot run with a branch swaps in the lot's branch and true base", () => {
    expect(lotPrCard({ integration: "lot", lotBranch: "board/lot-x", lotBase: "main" }, c)).toMatchObject({ id: "c", branch: "board/lot-x", baseRef: "main" });
  });
  it("a card run, no run, or a lot not started yet: the card itself", () => {
    expect(lotPrCard({ integration: "card", lotBranch: null, lotBase: null }, c)).toBe(c);
    expect(lotPrCard(null, c)).toBe(c);
    expect(lotPrCard({ integration: "lot", lotBranch: null, lotBase: null }, c)).toBe(c);
  });
});

describe("prepareLot — what startCard forks from", () => {
  it("cuts the lot from the first card's base, and every card of the lot then forks from the lot", async () => {
    const dir = repo();
    const db = new BoardDb(":memory:");
    const [a, b] = ["a", "b"].map((t, i) => db.createCard({ title: t, repoPath: dir, status: "ready", position: i, baseRef: "main" }));
    const run = db.createRun({ repoPath: dir, cardIds: [a!.id, b!.id], foldInCap: 0, integration: "lot", name: "L" });

    expect(await prepareLot(db, db.getRun(run.id)!, db.getCard(a!.id)!)).toEqual({ ok: true });
    const lot = db.getRun(run.id)!;
    expect(lot.lotBranch).toBe(lotBranchOf(run));
    expect(lot.lotBase).toBe("main");
    // startCard forks from baseOf(card): the lot, not main.
    expect(await baseOf(db.getCard(a!.id)!)).toBe(lot.lotBranch);

    expect(await prepareLot(db, lot, db.getCard(b!.id)!)).toEqual({ ok: true });
    expect(await baseOf(db.getCard(b!.id)!)).toBe(lot.lotBranch);
    expect(db.getRun(run.id)!.lotBase).toBe("main");
  });
});

describe("prepareLot — two cards of a maxParallel 2 lot starting in the same tick", () => {
  /** `dir`'s main is one commit behind its origin — someone merged a PR on GitHub. */
  const behindOrigin = () => {
    const dir = repo();
    const origin = `${dir}-origin.git`;
    sh(dir, "clone", "-q", "--bare", dir, origin);
    sh(dir, "remote", "add", "origin", origin);
    sh(dir, "fetch", "-q", "origin");
    const other = `${dir}-other`;
    sh(dir, "clone", "-q", origin, other);
    sh(other, "config", "user.email", "t@t"), sh(other, "config", "user.name", "t");
    writeFileSync(join(other, "merged.txt"), "landed on GitHub\n");
    sh(other, "add", "."), sh(other, "commit", "-qm", "#875"), sh(other, "push", "-q", "origin", "main");
    return { dir, head: sh(other, "rev-parse", "HEAD") };
  };

  it("cuts the lot branch once, from origin's up-to-date base, and both cards fork from it", async () => {
    const { dir, head } = behindOrigin();
    const db = new BoardDb(":memory:");
    const [a, b] = ["a", "b"].map((t, i) => db.createCard({ title: t, repoPath: dir, status: "ready", position: i, baseRef: "main" }));
    const run = db.createRun({ repoPath: dir, cardIds: [a!.id, b!.id], foldInCap: 0, integration: "lot", name: "D" });
    const cuts: string[][] = [];
    const git = async (args: string[], cwd: string) => {
      if (args[0] === "branch") cuts.push(args);
      const p = Bun.spawnSync(["git", ...args], { cwd, env: gitFreeEnv });
      return { ok: p.exitCode === 0, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
    };
    // The coordinator hands both the same snapshot of the run: no lot branch yet.
    const snap = db.getRun(run.id)!;
    const results = await Promise.all([a, b].map((c) => prepareLot(db, snap, db.getCard(c!.id)!, git)));

    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(cuts).toHaveLength(1);
    const lot = lotBranchOf(run);
    expect(sh(dir, "rev-parse", lot)).toBe(head);
    expect([a, b].map((c) => db.getCard(c!.id)!.baseRef)).toEqual([lot, lot]);
  });

  it("a halted lot relaunched with its branch already there reuses it", async () => {
    const dir = repo();
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: dir, status: "ready", baseRef: "main" });
    const run = db.createRun({ repoPath: dir, cardIds: [a.id], foldInCap: 0, integration: "lot", name: "D" });
    sh(dir, "branch", lotBranchOf(run), "main"); // left by the first launch, never recorded on the run
    expect(await prepareLot(db, db.getRun(run.id)!, db.getCard(a.id)!)).toEqual({ ok: true });
    expect(db.getRun(run.id)!.lotBranch).toBe(lotBranchOf(run));
    expect(await prepareLot(db, db.getRun(run.id)!, db.getCard(a.id)!)).toEqual({ ok: true });
  });
});

describe("lotView", () => {
  it("says a launched lot is over once run.finished is journaled, and carries the lot's PR while it runs", () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/repo" });
    const b = db.createCard({ title: "b", repoPath: "/repo" });
    const run = db.createRun({ repoPath: "/repo", cardIds: [a.id, b.id], foldInCap: 0, integration: "lot" });
    expect(lotView(db, run)).toMatchObject({ finished: false, prUrl: null });
    db.recordEvent(b.id, "card.pr_opened", { url: "https://github.com/o/r/pull/7" });
    expect(lotView(db, run).prUrl).toBe("https://github.com/o/r/pull/7");
    db.recordRunEvent(null, "run.finished", { runId: run.id });
    expect(lotView(db, run)).toMatchObject({ finished: true, prUrl: null });
  });

  it("never calls a planned lot finished", () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/repo" });
    const run = db.createRun({ repoPath: "/repo", cardIds: [a.id], foldInCap: 0, planned: true });
    expect(lotView(db, run).finished).toBe(false);
  });
});
