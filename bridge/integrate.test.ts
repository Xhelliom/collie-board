import { describe, expect, it } from "bun:test";

import {
  deleteBranch,
  hasRealChanges,
  integrationOf,
  mergeIntoBase,
  parseLeftRight,
  parsePrUrl,
  refusalFor,
  refusalMessage,
  removeWorktreeAt,
  type GitRunner,
  type Integration,
} from "./git.ts";
import { resolvePrompt } from "./integrate.ts";

// These three writes are the only ones in the bridge that change a git repository, and the operator
// firing them is on a phone and cannot repair anything. So the tests here are about REFUSING: what
// is turned down, and that a failed merge leaves nothing behind.

/** A git runner driven by a table of `argv[0..1]` prefixes, so no repository is needed. */
function fakeGit(table: Record<string, { ok?: boolean; stdout?: string; stderr?: string }>): {
  git: GitRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    calls.push(args);
    const key = Object.keys(table).find((k) => args.join(" ").startsWith(k));
    const hit = key ? table[key]! : {};
    return { ok: hit.ok ?? true, stdout: hit.stdout ?? "", stderr: hit.stderr ?? "" };
  };
  return { git, calls };
}

const state = (over: Partial<Integration> = {}): Integration => ({
  branch: "board/x",
  base: "main",
  ahead: 3,
  behind: 0,
  baseDirty: false,
  branchDirty: false,
  baseCheckedOut: true,
  ...over,
});

describe("parseLeftRight", () => {
  it("reads behind then ahead, in that order — swapping them would offer to merge nothing", () => {
    expect(parseLeftRight("4\t7\n")).toEqual({ behind: 4, ahead: 7 });
    expect(parseLeftRight("0 0")).toEqual({ behind: 0, ahead: 0 });
  });

  it("returns null on anything it does not recognise, rather than guessing", () => {
    expect(parseLeftRight("")).toBeNull();
    expect(parseLeftRight("fatal: bad revision")).toBeNull();
  });
});

describe("parsePrUrl", () => {
  it("picks the pull-request url out of gh's chatter", () => {
    expect(parsePrUrl("Warning: 3 uncommitted changes\nhttps://github.com/o/r/pull/42\n")).toBe(
      "https://github.com/o/r/pull/42",
    );
  });

  it("is null when there is none, rather than returning a half-url", () => {
    expect(parsePrUrl("https://github.com/o/r")).toBeNull();
  });
});

describe("hasRealChanges", () => {
  it("ignores .board/, the bridge's own scratch directory", () => {
    // Found against a real worktree whose ONLY change was `?? .board/` — the handoff note this very
    // bridge had written. Counting it would refuse the cleanup of every finished card, forever.
    expect(hasRealChanges("?? .board/\n")).toBe(false);
    expect(hasRealChanges("?? .board/handoff.md\n M .board/out/x.json\n")).toBe(false);
  });

  it("sees real work, in every status form", () => {
    expect(hasRealChanges(" M web/src/routes/card.tsx\n")).toBe(true);
    expect(hasRealChanges("?? .board/\n M bridge/git.ts\n")).toBe(true);
    expect(hasRealChanges("R  old.ts -> new.ts\n")).toBe(true);
  });

  it("is false on a clean tree", () => {
    expect(hasRealChanges("")).toBe(false);
    expect(hasRealChanges("\n\n")).toBe(false);
  });
});

describe("refusalFor — the gate all three writes share", () => {
  it("lets a clean, ahead branch merge", () => {
    expect(refusalFor(state(), "merge")).toBeNull();
  });

  it("refuses a merge that would integrate nothing", () => {
    expect(refusalFor(state({ ahead: 0 }), "merge")).toBe("nothing-to-merge");
  });

  it("refuses while the CARD's checkout has uncommitted work — merging would leave it behind", () => {
    expect(refusalFor(state({ branchDirty: true }), "merge")).toBe("branch-dirty");
    expect(refusalFor(state({ branchDirty: true }), "pr")).toBe("branch-dirty");
  });

  it("refuses to merge from a base that isn't checked out", () => {
    expect(refusalFor(state({ baseCheckedOut: false }), "merge")).toBe("base-not-checked-out");
  });

  it("does NOT refuse merely because the base is dirty — git merges what it doesn't touch", () => {
    // Measured against a real repository: uncommitted changes outside the merge survive it
    // untouched, and that is the common case. git refuses by itself when they would collide, before
    // changing a byte, and it knows the exact intersection. Refusing here blocked most merges.
    expect(refusalFor(state({ baseDirty: true }), "merge")).toBeNull();
  });

  it("lets a PR through on a base that is dirty or elsewhere — a PR never touches it", () => {
    expect(refusalFor(state({ baseDirty: true, baseCheckedOut: false }), "pr")).toBeNull();
  });

  it("REFUSES CLEANUP while the branch still holds commits, or uncommitted work", () => {
    // The one irreversible action of the three: both of these would delete work that exists nowhere
    // else, and `git branch -d` is only the second lock on that door.
    expect(refusalFor(state({ ahead: 2 }), "cleanup")).toBe("not-merged");
    expect(refusalFor(state({ ahead: 0, branchDirty: true }), "cleanup")).toBe("branch-dirty");
    expect(refusalFor(state({ ahead: 0 }), "cleanup")).toBeNull();
  });

  it("refuses everything on a card with no branch", () => {
    for (const action of ["merge", "pr", "cleanup"] as const) {
      expect(refusalFor(null, action)).toBe("no-branch");
    }
  });

  it("has a sentence for every refusal", () => {
    for (const reason of [
      "no-branch",
      "nothing-to-merge",
      "branch-dirty",
      "base-not-checked-out",
      "not-merged",
    ] as const) {
      expect(refusalMessage(reason, state()).length).toBeGreaterThan(10);
    }
  });
});

describe("integrationOf", () => {
  it("reports where the branch stands, and both checkouts' cleanliness", async () => {
    const { git } = fakeGit({
      "rev-parse --abbrev-ref": { stdout: "main\n" },
      "rev-list --count --left-right": { stdout: "4\t2\n" },
      "worktree list": { stdout: "worktree /wt\nbranch refs/heads/board/x\n" },
      status: { stdout: "" },
    });

    const got = await integrationOf("/repo", "board/x", "main", git);

    expect(got).toEqual({
      branch: "board/x",
      base: "main",
      ahead: 2,
      behind: 4,
      baseDirty: false,
      branchDirty: false,
      baseCheckedOut: true,
    });
  });

  it("falls back to the checkout's current branch when the card names no base", async () => {
    const { git } = fakeGit({
      "rev-parse --abbrev-ref": { stdout: "develop\n" },
      "rev-list --count --left-right": { stdout: "0\t1\n" },
      "worktree list": { stdout: "" },
      status: { stdout: "" },
    });

    expect((await integrationOf("/repo", "board/x", null, git))!.base).toBe("develop");
  });

  it("degrades to null rather than throwing — this rides the card view", async () => {
    const { git } = fakeGit({ "rev-parse --abbrev-ref": { ok: false }, "rev-list": { ok: false } });
    expect(await integrationOf("/repo", "board/x", null, git)).toBeNull();
  });
});

describe("mergeIntoBase", () => {
  it("ABORTS on conflict, and says it was one", async () => {
    const { git, calls } = fakeGit({
      merge: { ok: false, stdout: "CONFLICT (content): Merge conflict in web/src/routes/card.tsx" },
    });

    const r = await mergeIntoBase("/repo", "board/x", git);

    expect(r.ok).toBe(false);
    expect(r.ok === false && r.kind).toBe("conflict");
    // The repository must not be left mid-merge — the operator is on a phone.
    expect(calls.some((c) => c[0] === "merge" && c[1] === "--abort")).toBe(true);
  });

  it("tells 'would overwrite your uncommitted work' apart — a different problem, a different fix", () => {
    // git stops BEFORE touching anything here, so it is a refusal, not a failure. Only the person
    // who wrote those changes can decide what happens to them.
    const { git } = fakeGit({
      merge: {
        ok: false,
        stderr:
          "error: Your local changes to the following files would be overwritten by merge:\n\tbridge/git.ts\nPlease commit your changes or stash them before you merge.",
      },
    });
    return mergeIntoBase("/repo", "board/x", git).then((r) => {
      expect(r.ok === false && r.kind).toBe("would-overwrite");
    });
  });

  it("does not call a conflict on an unrelated failure", async () => {
    const { git } = fakeGit({ merge: { ok: false, stderr: "fatal: not a git repository" } });
    const r = await mergeIntoBase("/repo", "board/x", git);
    expect(r.ok === false && r.kind).toBe("other");
  });

  it("merges with --no-ff, so a card stays one unit of work in the history", async () => {
    const { git, calls } = fakeGit({ merge: { stdout: "Merge made by the 'ort' strategy." } });
    await mergeIntoBase("/repo", "board/x", git);
    expect(calls[0]).toEqual(["merge", "--no-ff", "--no-edit", "--", "board/x"]);
  });
});

describe("deleteBranch", () => {
  it("uses -d by default, so git itself refuses an unmerged branch", async () => {
    const { git, calls } = fakeGit({});
    await deleteBranch("/repo", "board/x", git);
    expect(calls[0]).toEqual(["branch", "-d", "--", "board/x"]);
  });

  it("uses -D only on a discard, where losing the commits IS the request", async () => {
    const { git, calls } = fakeGit({});
    await deleteBranch("/repo", "board/x", git, true);
    expect(calls[0]).toEqual(["branch", "-D", "--", "board/x"]);
  });
});

describe("removeWorktreeAt", () => {
  it("removes a checkout herdr has no workspace for — otherwise it is unreachable from the phone", async () => {
    // The real case: a worktree whose workspace was closed by hand. `git branch -d` refuses while a
    // worktree holds the branch, and nothing else in the app removes one.
    const { git, calls } = fakeGit({});
    await removeWorktreeAt("/repo", "/wt/board-x", git);
    expect(calls[0]).toEqual(["worktree", "remove", "--force", "--", "/wt/board-x"]);
  });
});

describe("resolvePrompt", () => {
  it("sends the agent to merge the base INTO its own branch, never the reverse", () => {
    const prompt = resolvePrompt("main", "board/x");
    expect(prompt).toContain("git merge main");
    expect(prompt).toContain("Do NOT push");
    expect(prompt).toContain("do NOT check out main");
  });
});
