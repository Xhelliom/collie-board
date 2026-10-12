import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cardDiffStat, diffStat, diffStatLine, formatDiffStat, parseMergeTree, pushDir, type DiffStat, type GitRunner } from "./git.ts";

// Captured from git 2.55 (`merge-tree --write-tree --name-only origin/main <branch>`, LC_ALL=C).
describe("parseMergeTree — does the PR conflict, before anything is pushed", () => {
  test("clean: exit 0 and the tree oid alone", () => {
    expect(parseMergeTree(true, "a9c410fff444559b13cca9d385d1ac358b31e06d\n")).toEqual([]);
  });

  test("conflict: exit 1, the oid, then the conflicted files up to git's messages", () => {
    const stdout = [
      "9fb6fe9cd584b8563f51f16f87f1672b0b8d5efc",
      "f.txt",
      "g.txt",
      "",
      "Auto-merging f.txt",
      "CONFLICT (content): Merge conflict in f.txt",
      "Auto-merging g.txt",
      "CONFLICT (content): Merge conflict in g.txt",
      "",
    ].join("\n");
    expect(parseMergeTree(false, stdout)).toEqual(["f.txt", "g.txt"]);
  });

  test("an unknown ref also exits 1, with no oid — a failure, not a conflict", () => {
    expect(parseMergeTree(false, "")).toBeNull();
    expect(parseMergeTree(false, "merge-tree: origin/nope - not something we can merge\n")).toBeNull();
  });
});

// The two renderings of one stat — formatDiffStat for a prompt, diffStatLine for a push body — are
// pure; diffStat itself is driven through a fake GitRunner, so no real git subprocess or repo on
// disk is involved.

describe("formatDiffStat", () => {
  test("no changes reads as a plain sentence, not an empty list", () => {
    const stat: DiffStat = { base: "HEAD", files: [], added: 0, removed: 0 };
    expect(formatDiffStat(stat)).toBe("(no changes)");
  });

  test("lists text files with +/- counts, untracked/binary by kind, and a totals line", () => {
    const stat: DiffStat = {
      base: "HEAD",
      files: [
        { path: "a.ts", added: 3, removed: 1, kind: "text" },
        { path: "new.ts", added: 0, removed: 0, kind: "untracked" },
        { path: "logo.png", added: 0, removed: 0, kind: "binary" },
      ],
      added: 3,
      removed: 1,
    };
    const out = formatDiffStat(stat);
    expect(out).toContain("a.ts | +3 -1");
    expect(out).toContain("new.ts | untracked");
    expect(out).toContain("logo.png | binary");
    expect(out).toContain("3 files changed, 3 insertions(+), 1 deletions(-)");
  });

  test("caps the file list at 100 and notes the rest", () => {
    const files = Array.from({ length: 150 }, (_, i) => ({
      path: `f${i}.ts`,
      added: 1,
      removed: 0,
      kind: "text" as const,
    }));
    const stat: DiffStat = { base: "HEAD", files, added: 150, removed: 0 };
    const out = formatDiffStat(stat);
    expect(out).toContain("… and 50 more files");
    expect(out.split("\n").filter((l) => l.includes(" | "))).toHaveLength(100);
  });
});

describe("diffStatLine", () => {
  const stat = (files: DiffStat["files"], added: number, removed: number): DiffStat => ({
    base: "HEAD",
    files,
    added,
    removed,
  });
  const text = (path: string) => ({ path, added: 0, removed: 0, kind: "text" as const });

  test("renders the whole stat as one push-body line", () => {
    expect(diffStatLine(stat([text("a.ts"), text("b.ts"), text("c.ts")], 180, 12))).toBe("3 files, +180 -12");
  });

  test("a single file is not `1 files`", () => {
    expect(diffStatLine(stat([text("a.ts")], 3, 0))).toBe("1 file, +3 -0");
  });

  test("nothing changed is null, not an announcement that nothing changed", () => {
    // Tier 3 has to be able to fall through to tier 4 (nothing) — see notify-subtitle.ts.
    expect(diffStatLine(stat([], 0, 0))).toBeNull();
  });

  test("counts binary and untracked files too, which contribute no +/- of their own", () => {
    const files = [text("a.ts"), { path: "logo.png", added: 0, removed: 0, kind: "binary" as const }];
    expect(diffStatLine(stat(files, 4, 1))).toBe("2 files, +4 -1");
  });
});

describe("diffStat against HEAD — the hand-launched pane's only diff", () => {
  function fakeGit(numstat: string, status: string): GitRunner {
    return async (args) => {
      if (args[0] === "diff") return { ok: true, stdout: numstat, stderr: "" };
      if (args[0] === "status") return { ok: true, stdout: status, stderr: "" };
      return { ok: true, stdout: "", stderr: "" }; // merge-base / rev-parse, unused by baseRef:null
    };
  }

  test("diffs the working tree against HEAD — no card, no branch needed", async () => {
    const git = fakeGit("2\t0\tREADME.md\n", "?? scratch.txt\n");
    const out = formatDiffStat(await diffStat("/repo", null, git));
    expect(out).toContain("README.md | +2 -0");
    expect(out).toContain("scratch.txt | untracked");
  });

  test("nothing uncommitted reads as no changes, and has no body line at all", async () => {
    const stat = await diffStat("/repo", null, fakeGit("", ""));
    expect(formatDiffStat(stat)).toBe("(no changes)");
    expect(diffStatLine(stat)).toBeNull();
  });
});

describe("pushDir — where the pre-push hook runs", () => {
  const list = (path: string): GitRunner => async () => ({
    ok: true,
    stdout: `worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree ${path}\nHEAD def\nbranch refs/heads/card\n\n`,
    stderr: "",
  });

  test("the card's worktree when it exists", async () => {
    expect(await pushDir("/repo", "card", list("/wt/card"), () => true)).toBe("/wt/card");
  });

  test("the repo when the worktree is gone from disk", async () => {
    expect(await pushDir("/repo", "card", list("/wt/card"), () => false)).toBe("/repo");
  });

  test("the repo when no worktree carries the branch", async () => {
    expect(await pushDir("/repo", "other", list("/wt/card"), () => true)).toBe("/repo");
  });
});

describe("cardDiffStat — a card with no base (the copilot reviewed an empty diff)", () => {
  // A git hook exports GIT_DIR & co: left in, these fixture repos would operate on the REAL repository.
  const { GIT_DIR: _d, GIT_WORK_TREE: _w, GIT_PREFIX: _p, GIT_INDEX_FILE: _i, ...env } = process.env;
  const sh = (cwd: string, ...args: string[]) => {
    const r = Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, env });
    if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  };

  test("COMMITTED work is read against the main checkout's branch, not against HEAD", async () => {
    const root = mkdtempSync(join(tmpdir(), "cardstat-"));
    const repo = join(root, "repo");
    const wt = join(root, "wt");
    Bun.spawnSync(["mkdir", repo]);
    sh(repo, "init", "-b", "main");
    writeFileSync(join(repo, "a.txt"), "a\n");
    sh(repo, "add", "-A");
    sh(repo, "commit", "-m", "base");
    sh(repo, "worktree", "add", "-b", "feat", wt);
    writeFileSync(join(wt, "b.txt"), "b\n");
    sh(wt, "add", "-A");
    sh(wt, "commit", "-m", "work");

    const db = { getCard: () => ({ repoPath: repo, branch: "feat", baseRef: null }) };
    expect((await cardDiffStat(db, "x"))!.files.map((f) => f.path)).toEqual(["b.txt"]);
    // …and a base the card names still wins.
    const named = { getCard: () => ({ repoPath: repo, branch: "feat", baseRef: "feat" }) };
    expect((await cardDiffStat(named, "x"))!.files).toEqual([]);
  });
});
