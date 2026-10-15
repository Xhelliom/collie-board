import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitFreeEnv } from "../scripts/test-env.ts";

import { ensureLotBranch, foldIntoLot, lotBranchOf, lotPrCard } from "./lot.ts";

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
