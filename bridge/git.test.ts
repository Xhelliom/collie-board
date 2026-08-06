import { describe, expect, test } from "bun:test";

import { cwdDiffSummary, formatDiffStat, type DiffStat, type GitRunner } from "./git.ts";

// formatDiffStat is pure; cwdDiffSummary is diffStat(cwd, null) + formatDiffStat, driven through a
// fake GitRunner so no real git subprocess or repo on disk is involved.

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

describe("cwdDiffSummary", () => {
  function fakeGit(numstat: string, status: string): GitRunner {
    return async (args) => {
      if (args[0] === "diff") return { ok: true, stdout: numstat, stderr: "" };
      if (args[0] === "status") return { ok: true, stdout: status, stderr: "" };
      return { ok: true, stdout: "", stderr: "" }; // merge-base / rev-parse, unused by baseRef:null
    };
  }

  test("diffs the working tree against HEAD — no card, no branch needed", async () => {
    const git = fakeGit("2\t0\tREADME.md\n", "?? scratch.txt\n");
    const out = await cwdDiffSummary("/repo", git);
    expect(out).toContain("README.md | +2 -0");
    expect(out).toContain("scratch.txt | untracked");
  });

  test("nothing uncommitted reads as no changes", async () => {
    const git = fakeGit("", "");
    expect(await cwdDiffSummary("/repo", git)).toBe("(no changes)");
  });
});
