import { describe, expect, it } from "bun:test";
import { chmod, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitFreeEnv } from "../scripts/test-env.ts";

import {
  branchExists,
  cardDiffSummary,
  deleteBranch,
  ensureBoardExcluded,
  hasRealChanges,
  integrationOf,
  landedStat,
  mergeIntoBase,
  parseLeftRight,
  parsePrUrl,
  parsePrView,
  prStatusOf,
  refusalFor,
  refusalMessage,
  removeWorktreeAt,
  restoreBranch,
  worktreePathFor,
  type GitRunner,
  type Integration,
} from "./git.ts";
import { BoardDb, type CardSession } from "./db.ts";
import { foldIntoLot } from "./lot.ts";
import { prUrlOf } from "./cards.ts";
import type { HerdrClient } from "./herdr-client.ts";
import type { Config } from "./config.ts";
import {
  armAutoMerge,
  landPr,
  MAX_UNREADABLE,
  mergeWhenReady,
  notePrOutcome,
  cleanupCard,
  mergeCard,
  rebindDependents,
  reopenForPr,
  reopenPrompt,
  resolvePrompt,
  wrapupGate,
} from "./integrate.ts";

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
  pushed: false,
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

describe("parsePrView", () => {
  it("reads what the PR became, with the merge time in epoch ms", () => {
    const got = parsePrView(
      '{"mergedAt":"2026-08-24T15:37:36Z","state":"MERGED","url":"https://github.com/o/r/pull/1"}',
    );
    expect(got).toEqual({
      state: "merged",
      url: "https://github.com/o/r/pull/1",
      mergedAt: Date.parse("2026-08-24T15:37:36Z"),
      conflicting: false,
      mergeable: false,
      createdAt: null,
    });
  });

  it("reads when the PR was opened — an empty rollup is judged against it", () => {
    const got = parsePrView('{"state":"OPEN","url":"https://gh/o/r/pull/7","createdAt":"2026-10-12T10:00:00Z"}');
    expect(got?.createdAt).toBe(Date.parse("2026-10-12T10:00:00Z"));
  });

  it("says an open PR conflicts only once GitHub has computed it", () => {
    const conflicting = (state: string, mergeable: string) =>
      parsePrView(JSON.stringify({ state, mergeable, mergedAt: null, url: "https://gh/o/r/pull/5" }))?.conflicting;
    expect(conflicting("OPEN", "CONFLICTING")).toBe(true);
    expect(conflicting("OPEN", "MERGEABLE")).toBe(false);
    // UNKNOWN is GitHub still working it out — the seconds after a push, say. No state is guessed.
    expect(conflicting("OPEN", "UNKNOWN")).toBe(false);
    // Only an open PR has a conflict left to resolve.
    expect(conflicting("CLOSED", "CONFLICTING")).toBe(false);
  });

  it("says an open PR merges only when GitHub says so — UNKNOWN is neither", () => {
    const read = (mergeable: string) =>
      parsePrView(JSON.stringify({ state: "OPEN", mergeable, mergedAt: null, url: "https://gh/o/r/pull/6" }));
    expect(read("MERGEABLE")).toMatchObject({ mergeable: true, conflicting: false });
    expect(read("CONFLICTING")).toMatchObject({ mergeable: false, conflicting: true });
    expect(read("UNKNOWN")).toMatchObject({ mergeable: false, conflicting: false });
  });

  it("keeps a closed PR distinct from an open one", () => {
    // The whole point: "closed without merging" and "still open" must not read the same on the card.
    expect(parsePrView('{"mergedAt":null,"state":"CLOSED","url":"https://gh/o/r/pull/2"}')?.state).toBe("closed");
    expect(parsePrView('{"mergedAt":null,"state":"OPEN","url":"https://gh/o/r/pull/3"}')).toEqual({
      state: "open",
      url: "https://gh/o/r/pull/3",
      mergedAt: null,
      conflicting: false,
      mergeable: false,
      createdAt: null,
    });
  });

  it("is null for anything it does not recognise, rather than a guess", () => {
    expect(parsePrView("no pull requests found for branch \"board/x\"")).toBeNull();
    expect(parsePrView('{"state":"DRAFTED","url":"https://gh/o/r/pull/4"}')).toBeNull();
    expect(parsePrView('{"state":"OPEN"}')).toBeNull();
    expect(parsePrView("")).toBeNull();
  });
});

describe("prStatusOf", () => {
  it("asks gh for the branch's PR", async () => {
    const { git, calls } = fakeGit({
      "pr view": { stdout: '{"state":"MERGED","mergedAt":"2026-08-24T15:37:36Z","url":"https://gh/o/r/pull/1"}' },
    });
    expect((await prStatusOf("/repo", "board/x", git))?.state).toBe("merged");
    expect(calls[0]).toEqual(["pr", "view", "board/x", "--json", "state,mergedAt,url,mergeable,createdAt"]);
  });

  it("degrades to null rather than to an error — no gh, no auth, no remote, no PR", async () => {
    const { git } = fakeGit({ "pr view": { ok: false, stderr: "no pull requests found" } });
    expect(await prStatusOf("/repo", "board/x", git)).toBeNull();
    // `gh` missing from PATH entirely: Bun.spawn throws rather than answering.
    const throws: GitRunner = async () => {
      throw new Error("ENOENT");
    };
    expect(await prStatusOf("/repo", "board/x", throws)).toBeNull();
  });

  it("never hands a branch name to gh's flag parser", async () => {
    // `gh pr view` takes one positional and so accepts no `--` separator, and `branch` is a writable
    // card field. A name that could be read as a flag is refused here instead.
    const { git, calls } = fakeGit({});
    expect(await prStatusOf("/repo", "--json", git)).toBeNull();
    expect(calls).toEqual([]);
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

  it("REFUSES CLEANUP of commits that exist nowhere else — but pushed IS somewhere else", () => {
    // The one irreversible action of the three, so what it turns on is whether the commits survive
    // the branch. `ahead > 0` alone used to be the refusal, which left every "done & pr" card
    // holding its worktree and its pane forever: a PR'd branch is ahead of the base by definition.
    expect(refusalFor(state({ ahead: 2 }), "cleanup")).toBe("not-merged");
    expect(refusalFor(state({ ahead: 2, pushed: true }), "cleanup")).toBeNull();
    expect(refusalFor(state({ ahead: 0 }), "cleanup")).toBeNull();
    // Uncommitted work is on no remote, pushed or not.
    expect(refusalFor(state({ ahead: 0, branchDirty: true }), "cleanup")).toBe("branch-dirty");
    expect(refusalFor(state({ ahead: 2, pushed: true, branchDirty: true }), "cleanup")).toBe("branch-dirty");
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
      pushed: false,
    });
  });

  it("reads `pushed` off the branch's upstream, and says no when there is none", async () => {
    const table = {
      "rev-parse --abbrev-ref": { stdout: "main\n" },
      "rev-list --count --left-right": { stdout: "0\t2\n" },
      "worktree list": { stdout: "" },
      status: { stdout: "" },
    };
    for (const [upstream, want] of [
      [{ stdout: "0\n" }, true],
      [{ stdout: "1\n" }, false],
      // No upstream at all: git exits non-zero, and "nothing pushed" is the right reading.
      [{ ok: false }, false],
    ] as const) {
      const { git } = fakeGit({ ...table, "rev-list --count board/x@{upstream}": upstream });
      expect((await integrationOf("/repo", "board/x", "main", git))!.pushed).toBe(want);
    }
  });

  it("never guesses a base from the checked-out branch — no base, no integration (`baseOf` answers first)", async () => {
    const { git } = fakeGit({
      "rev-parse --abbrev-ref": { stdout: "board/other-card\n" },
      "rev-list --count --left-right": { stdout: "0\t1\n" },
      "worktree list": { stdout: "" },
      status: { stdout: "" },
    });

    expect(await integrationOf("/repo", "board/x", null, git)).toBeNull();
  });

  it("degrades to null rather than throwing — this rides the card view", async () => {
    const { git } = fakeGit({ "rev-parse --abbrev-ref": { ok: false }, "rev-list": { ok: false } });
    expect(await integrationOf("/repo", "board/x", "main", git)).toBeNull();
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

describe("ensureBoardExcluded", () => {
  /** A throwaway git repo, so this exercises the real file rather than a mock of it. */
  async function repo(): Promise<string> {
    const dir = join(tmpdir(), `collie-exclude-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(dir, ".git", "info"), { recursive: true });
    return dir;
  }
  const fakeRevParse: GitRunner = async () => ({ ok: true, stdout: ".git\n", stderr: "" });

  it("adds the pattern once, and says so only the first time", async () => {
    const dir = await repo();
    expect(await ensureBoardExcluded(dir, fakeRevParse)).toBe(true);
    expect(await ensureBoardExcluded(dir, fakeRevParse)).toBe(false);

    const text = await Bun.file(join(dir, ".git", "info", "exclude")).text();
    expect(text.split("\n").filter((l) => l.trim() === ".board/")).toHaveLength(1);
    // The line has to explain itself: someone will find it in a repo of theirs one day.
    expect(text).toContain("Collie Board");
    await rm(dir, { recursive: true, force: true });
  });

  it("appends to an existing exclude file without eating its last line", async () => {
    const dir = await repo();
    // No trailing newline — the shape that silently merges two lines if you just concatenate.
    await Bun.write(join(dir, ".git", "info", "exclude"), "*.log");

    await ensureBoardExcluded(dir, fakeRevParse);

    const lines = (await Bun.file(join(dir, ".git", "info", "exclude")).text()).split("\n");
    expect(lines).toContain("*.log");
    expect(lines).toContain(".board/");
    await rm(dir, { recursive: true, force: true });
  });

  it("stays quiet when git says no — a start must never fail over this", async () => {
    const failing: GitRunner = async () => ({ ok: false, stdout: "", stderr: "not a repo" });
    expect(await ensureBoardExcluded("/nope", failing)).toBe(false);
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

  it("tells the agent to re-check divergence even if it resolved this branch before", () => {
    const prompt = resolvePrompt("main", "board/x");
    expect(prompt).toContain("git log --oneline HEAD..main");
    expect(prompt).toContain("Don't skip the merge because this looks like a repeat");
  });

  it("tells the agent the merge back into the base is the operator's tap, not its own", () => {
    const prompt = resolvePrompt("main", "board/x");
    expect(prompt).toContain("Do NOT merge this branch back into main yourself");
  });

  it("after a PR, merges origin's base and leaves pushing and opening the PR to the operator", () => {
    const prompt = resolvePrompt("origin/main", "board/x", "pr");
    expect(prompt).toContain("git merge origin/main");
    expect(prompt).toContain("Do NOT push");
    expect(prompt).toContain("Do NOT open the PR yourself");
    expect(prompt).not.toContain("merge this branch back");
  });
});

describe("reopening a filed card whose PR conflicts (ADR 0014, case 2)", () => {
  it("gets a cleaned-up branch back from origin, tracking it so it reads as pushed", async () => {
    const { git, calls } = fakeGit({ "rev-parse": { ok: false } });
    expect(await restoreBranch("/repo", "board/x", git)).toEqual({ ok: true });
    expect(calls.slice(1)).toEqual([
      ["fetch", "origin", "--", "board/x"],
      ["branch", "--track", "--", "board/x", "origin/board/x"],
    ]);
  });

  it("leaves a branch that is still here alone — keepWorktree never lost it", async () => {
    const { git, calls } = fakeGit({});
    expect(await restoreBranch("/repo", "board/x", git)).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
  });

  it("refuses a branch name a flag parser would read", async () => {
    const { git, calls } = fakeGit({});
    expect((await restoreBranch("/repo", "--force", git)).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("tells the new agent the PR was clean once, and hands it the closing report", () => {
    const prompt = reopenPrompt("origin/main", "board/x", "https://gh/o/r/pull/58", "Added the PR line.");
    expect(prompt).toContain("https://gh/o/r/pull/58");
    expect(prompt).toContain("Added the PR line.");
    expect(prompt).toContain("git merge origin/main");
    expect(prompt).toContain("Do NOT push");
    expect(reopenPrompt("origin/main", "board/x", "u", null)).not.toContain("closing report");
  });

  it("refuses a card that still has an agent — that one gets the conflict handed to it", async () => {
    const store = new BoardDb(":memory:");
    const card = store.createCard({ title: "t", repoPath: "/repo", baseRef: "main" });
    store.patchCard(card.id, { branch: "board/x" });
    store.openSession({ cardId: card.id, paneId: "w1:p1", agentKind: "claude" });
    const r = await reopenForPr(store, {} as HerdrClient, {} as Config, store.getCard(card.id)!);
    expect(r).toEqual({ ok: false, error: { kind: "refused", message: expect.stringContaining("already has an agent") } });
  });
});

describe("wrapupGate — cleanup must not race the closing report off the disk it lives on", () => {
  function session(over: Partial<CardSession> = {}): CardSession {
    return {
      id: "s1",
      cardId: "c1",
      paneId: "w1:p1",
      agentSessionId: null,
      agentKind: null,
      ctxTokens: null,
      ctxPct: null,
      handoffMd: null,
      outcome: "done",
      handoffRequestedAt: null,
      autoHandoffAt: null,
      startedAt: 0,
      endedAt: 1,
      ...over,
    };
  }

  it("refuses while the closing report is still being written", () => {
    expect(wrapupGate(session({ handoffRequestedAt: 1 }))).toEqual({
      kind: "refused",
      message: expect.stringContaining("still writing its closing report"),
    });
  });

  it("lets cleanup through once the note has been collected", () => {
    expect(wrapupGate(session({ handoffRequestedAt: null, handoffMd: "done" }))).toBeNull();
  });

  it("lets cleanup through when there was never a wrapup to wait for", () => {
    expect(wrapupGate(null)).toBeNull();
  });
});

describe("rebindDependents — a dependent card must not lose its diff when its predecessor's branch dies", () => {
  it("repoints a dependent's baseRef from the deleted branch to where cleanup proved it landed", () => {
    const store = new BoardDb(":memory:");
    const first = store.createCard({ title: "first", repoPath: "/repo", baseRef: "main" });
    store.patchCard(first.id, { branch: "board/first" });
    const next = store.createCard({
      title: "next",
      repoPath: "/repo",
      baseRef: "board/first",
      dependsOn: first.id,
    });

    rebindDependents(store, "board/first", "main");

    expect(store.getCard(next.id)!.baseRef).toBe("main");
  });

  it("leaves cards forked from a different branch alone", () => {
    const store = new BoardDb(":memory:");
    const unrelated = store.createCard({ title: "unrelated", repoPath: "/repo", baseRef: "board/other" });

    rebindDependents(store, "board/first", "main");

    expect(store.getCard(unrelated.id)!.baseRef).toBe("board/other");
  });

  it("reaches an archived dependent too — its diff can still be reopened later", () => {
    const store = new BoardDb(":memory:");
    const next = store.createCard({ title: "next", repoPath: "/repo", baseRef: "board/first" });
    store.setStatus(next.id, "archived", "test");

    rebindDependents(store, "board/first", "main");

    expect(store.getCard(next.id)!.baseRef).toBe("main");
  });
});

// "Relancer la review" answered 409 on exactly the card that needed it: the agent left a file
// untracked, the review said `partial`, the file got committed, the card merged and was cleaned up —
// and with the checkout gone there was nothing left to judge. Real git, because the bug IS what git
// can still read once the branch has landed.
describe("a landed card keeps the diff its review reads", () => {
  function git(cwd: string, ...args: string[]): void {
    const r = Bun.spawnSync(["git", ...args], { cwd, env: gitFreeEnv });
    if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  }

  it("reviews the forgotten file as committed, after merge and cleanup", async () => {
    const repo = join(tmpdir(), `collie-landed-${Math.random().toString(36).slice(2)}`);
    const checkout = `${repo}-wt`;
    await mkdir(repo, { recursive: true });
    git(repo, "init", "-q", "-b", "main");
    // Repo-local, so the merge the bridge runs itself picks them up too.
    git(repo, "config", "user.name", "t");
    git(repo, "config", "user.email", "t@t");
    git(repo, "config", "commit.gpgsign", "false");
    await Bun.write(join(repo, "README"), "x\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "init");
    git(repo, "worktree", "add", "-q", "-b", "board/x", checkout);

    const store = new BoardDb(":memory:");
    const card = store.createCard({ title: "x", repoPath: repo, baseRef: "main" });
    store.patchCard(card.id, { branch: "board/x" });
    await Bun.write(join(checkout, "forgotten.ts"), "export {};\n");
    expect(await cardDiffSummary(store, card.id)).toContain("forgotten.ts | untracked");

    git(checkout, "add", ".");
    git(checkout, "commit", "-qm", "the file the agent forgot");
    // A fake gh: the real one reaches for the network and once hung CI past the 5 s timeout.
    const noPr = fakeGit({ "pr view": { ok: false, stderr: "no pull requests found" } }).git;
    expect((await mergeCard(store, store.getCard(card.id)!, noPr)).ok).toBe(true);
    expect((await cleanupCard(store, {} as HerdrClient, store.getCard(card.id)!)).ok).toBe(true);
    expect(await worktreePathFor(repo, "board/x")).toBeNull();

    // What the route guard and a relaunched review both read — as often as they are asked.
    expect(landedStat(store, card.id)).toContain("forgotten.ts | +1 -0");
    const summary = await cardDiffSummary(store, card.id);
    expect(summary).toContain("forgotten.ts | +1 -0");
    expect(summary).not.toContain("untracked");
    expect(await cardDiffSummary(store, card.id)).toBe(summary);

    await rm(repo, { recursive: true, force: true });
    await rm(checkout, { recursive: true, force: true });
  });

  describe("card.base_moved only when the dependent really has something to merge", () => {
    const fixture = async () => {
      const repo = join(tmpdir(), `collie-moved-${Math.random().toString(36).slice(2)}`);
      await mkdir(repo, { recursive: true });
      git(repo, "init", "-q", "-b", "main");
      git(repo, "config", "user.name", "t");
      git(repo, "config", "user.email", "t@t");
      git(repo, "config", "commit.gpgsign", "false");
      await Bun.write(join(repo, "README"), "x\n");
      git(repo, "add", ".");
      git(repo, "commit", "-qm", "init");
      git(repo, "branch", "board/x");
      git(repo, "checkout", "-q", "board/x");
      await Bun.write(join(repo, "x.ts"), "export {};\n");
      git(repo, "add", ".");
      git(repo, "commit", "-qm", "x");
      git(repo, "checkout", "-q", "main");
      const store = new BoardDb(":memory:");
      const card = store.createCard({ title: "x", repoPath: repo, baseRef: "main" });
      store.patchCard(card.id, { branch: "board/x" });
      const next = store.createCard({ title: "next", repoPath: repo, baseRef: "board/x", dependsOn: card.id });
      store.recordEvent(next.id, "card.worktree", { branch: "board/next", base: "board/x" });
      const moved = () => store.listEvents(next.id).some((e) => e.type === "card.base_moved");
      return { repo, store, card, next, moved };
    };

    it("not after a local `--no-ff` merge: the predecessor's commits are already in the base", async () => {
      const t = await fixture();
      expect((await mergeCard(t.store, t.store.getCard(t.card.id)!, fakeGit({ "pr view": { ok: false, stderr: "no pull requests found" } }).git)).ok).toBe(true);
      expect((await cleanupCard(t.store, {} as HerdrClient, t.store.getCard(t.card.id)!)).ok).toBe(true);
      expect(t.store.getCard(t.next.id)!.baseRef).toBe("main");
      expect(t.moved()).toBe(false);
      await rm(t.repo, { recursive: true, force: true });
    });

    it("not after a discard: that work is thrown away, there is nothing to merge", async () => {
      const t = await fixture();
      expect((await cleanupCard(t.store, {} as HerdrClient, t.store.getCard(t.card.id)!, { discard: true })).ok).toBe(true);
      expect(t.store.getCard(t.next.id)!.baseRef).toBe("main");
      expect(t.moved()).toBe(false);
      await rm(t.repo, { recursive: true, force: true });
    });
  });

  it("a card folded into a lot's branch is cleaned up whole: checkout and branch gone, the lot keeps the work (ADR 0041)", async () => {
    const repo = join(tmpdir(), `collie-lotclean-${Math.random().toString(36).slice(2)}`);
    const checkout = `${repo}-wt`;
    await mkdir(repo, { recursive: true });
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.name", "t");
    git(repo, "config", "user.email", "t@t");
    git(repo, "config", "commit.gpgsign", "false");
    await Bun.write(join(repo, "README"), "x\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "init");
    git(repo, "branch", "board/lot-x");
    git(repo, "worktree", "add", "-q", "-b", "board/x", checkout, "board/lot-x");
    await Bun.write(join(checkout, "x.ts"), "export {};\n");
    git(checkout, "add", ".");
    git(checkout, "commit", "-qm", "x");
    expect(await foldIntoLot(repo, "board/lot-x", "board/x")).toEqual({ ok: true, merged: true });

    const store = new BoardDb(":memory:");
    const card = store.createCard({ title: "x", repoPath: repo, baseRef: "board/lot-x" });
    store.patchCard(card.id, { branch: "board/x" });
    expect((await cleanupCard(store, {} as HerdrClient, store.getCard(card.id)!)).ok).toBe(true);
    expect(await worktreePathFor(repo, "board/x")).toBeNull();
    expect(await branchExists(repo, "board/x")).toBe(false);
    expect(await branchExists(repo, "board/lot-x")).toBe(true);
    await rm(repo, { recursive: true, force: true });
    await rm(checkout, { recursive: true, force: true });
  });

  it("still has nothing to say for a card that never recorded a landing", async () => {
    const store = new BoardDb(":memory:");
    const card = store.createCard({ title: "x" });
    expect(landedStat(store, card.id)).toBeNull();
    expect(await cardDiffSummary(store, card.id)).toBe("(no worktree for this card)");
  });
});

describe("armAutoMerge — GitHub merges on green, and its refusal is a note, not a failure", () => {
  it("passes --auto and the strategy as argv, and journals the arming", async () => {
    const store = new BoardDb(":memory:");
    const card = store.createCard({ title: "t", repoPath: "/repo", baseRef: "main" });
    const calls: string[][] = [];
    const gh: GitRunner = async (args) => (calls.push(args), { ok: true, stdout: "", stderr: "" });
    await armAutoMerge(store, card.id, "/repo", "board/x", gh);
    expect(calls[0]).toEqual(["pr", "merge", "board/x", "--auto", "--squash"]);
    expect(store.listEvents(card.id)[0]?.type).toBe("card.automerge_armed");
  });

  it("writes GitHub's refusal on the card and resolves — the PR stays opened", async () => {
    const store = new BoardDb(":memory:");
    const card = store.createCard({ title: "t", repoPath: "/repo", baseRef: "main" });
    const gh: GitRunner = async () => ({
      ok: false,
      stdout: "",
      stderr: "GraphQL: Pull request Protected branch rules not configured for this branch (enablePullRequestAutoMerge)\n",
    });
    await armAutoMerge(store, card.id, "/repo", "board/x", gh);
    const [e] = store.listEvents(card.id);
    expect(e?.type).toBe("card.automerge_refused");
    expect(JSON.stringify(e?.payload)).toContain("Protected branch rules not configured");
  });

  it("a gh that is not even there is a refusal too, never a throw", async () => {
    const store = new BoardDb(":memory:");
    const card = store.createCard({ title: "t", repoPath: "/repo", baseRef: "main" });
    const gh: GitRunner = async () => {
      throw new Error("ENOENT: gh");
    };
    await armAutoMerge(store, card.id, "/repo", "board/x", gh);
    expect(store.listEvents(card.id)[0]?.type).toBe("card.automerge_refused");
  });
});

/**
 * A `gh` double that answers by SUBCOMMAND — `pr merge --auto`, `pr merge`, `pr view` asking for the
 * PR or for its checks, `run view` — never by argument position, and refuses any call it does not
 * know, so a new `gh` call in the code under test fails here instead of reading a wrong default.
 */
function ghDouble(over: {
  view?: () => Record<string, unknown>;
  rollup?: () => object[];
  auto?: boolean;
  merge?: boolean;
} = {}) {
  const calls: string[][] = [];
  const at = (args: string[], flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] ?? "" : null);
  const gh: GitRunner = async (args) => {
    calls.push(args);
    const ok = (stdout = "") => ({ ok: true, stdout, stderr: "" });
    const [cmd, sub] = args;
    if (cmd === "pr" && sub === "merge" && args.includes("--auto")) {
      return over.auto ? ok() : { ok: false, stdout: "", stderr: "Auto merge is not allowed for this repository" };
    }
    if (cmd === "pr" && sub === "merge") return over.merge === false ? { ok: false, stdout: "", stderr: "nope" } : ok();
    const fields = cmd === "pr" && sub === "view" ? at(args, "--json") : null;
    if (fields === "statusCheckRollup") return ok(JSON.stringify({ statusCheckRollup: over.rollup?.() ?? [] }));
    if (fields?.split(",").includes("mergeable")) {
      return ok(JSON.stringify({ state: "OPEN", url: "https://gh/o/r/pull/1", mergedAt: null, mergeable: "MERGEABLE", createdAt: OLD, ...over.view?.() }));
    }
    if (cmd === "run" && sub === "view") return ok("l1\nTS2554 boom");
    throw new Error(`gh double: unexpected call ${args.join(" ")}`);
  };
  return { gh, calls };
}
/** A PR opened long before "now" (well past CHECKS_GRACE_MS), and one opened a moment ago. */
const NOW = Date.parse("2026-10-12T12:00:00Z");
const OLD = "2026-10-12T10:00:00Z";
const FRESH = "2026-10-12T11:59:30Z";

describe("landPr / mergeWhenReady — landing a PR (ADR 0027, 0029, 0036)", () => {
  const green = { runId: "r1", ok: true, why: "gate green" };
  const setup = (over: Parameters<typeof ghDouble>[0] = {}) => {
    // The journal's clock: the PR was opened (pushed) long ago unless a test says otherwise.
    const clock = { t: Date.parse(OLD) };
    const store = new BoardDb(":memory:", () => clock.t);
    const card = store.createCard({ title: "t", repoPath: "/repo", baseRef: "main" });
    store.recordEvent(card.id, "card.pr_opened", { url: "https://gh/o/r/pull/1" });
    const { gh, calls } = ghDouble(over);
    const merges = () => store.listEvents(card.id).filter((e) => e.type === "run.merge").map((e) => e.payload as Record<string, unknown>);
    const merged = () => store.listEvents(card.id).filter((e) => e.type === "card.pr_merged").length;
    const direct = () => calls.some((a) => a[0] === "pr" && a[1] === "merge" && !a.includes("--auto"));
    const land = (gate = green) => landPr(store, card.id, "/repo", "board/x", gate, gh);
    const again = (gate = green) => mergeWhenReady(store, card.id, "/repo", "board/x", gate, gh, () => NOW);
    return { store, clock, card, gh, calls, merges, merged, direct, land, again };
  };

  it("merges directly once auto-merge is refused, gate green, no conflict", async () => {
    const t = setup();
    await t.land();
    expect(t.calls.find((a) => a[1] === "merge" && !a.includes("--auto"))).toEqual(["pr", "merge", "board/x", "--squash"]);
    expect(t.merges()).toEqual([{ runId: "r1", merged: true, reason: expect.stringContaining("auto-merge unavailable") }]);
    expect(t.merged()).toBe(1);
  });

  it("journals no pr_merged when the direct merge is refused", async () => {
    const t = setup({ merge: false });
    await t.land();
    expect(t.merges()[0]).toMatchObject({ merged: false, reason: expect.stringContaining("refused") });
    expect(t.merged()).toBe(0);
  });

  it("leaves a GitHub-armed auto-merge alone", async () => {
    const t = setup({ auto: true });
    await t.land();
    expect(t.direct()).toBe(false);
    expect(t.merges()).toEqual([]);
    expect(t.store.listEvents(t.card.id)[0]?.type).toBe("card.automerge_armed");
  });

  it("never merges on a red gate", async () => {
    const t = setup();
    await t.land({ runId: "r1", ok: false, why: "gate red" });
    expect(t.direct()).toBe(false);
    expect(t.merges()[0]).toMatchObject({ merged: false, reason: expect.stringContaining("gate red") });
    expect(t.merged()).toBe(0);
  });

  it("never merges a conflicting PR, and says it is a conflict", async () => {
    const t = setup({ view: () => ({ mergeable: "CONFLICTING" }) });
    await t.land();
    expect(t.direct()).toBe(false);
    expect(t.merges()[0]).toMatchObject({ merged: false, conflict: true });
  });

  it("UNKNOWN mergeability is a wait, journaled once — no timer, no skip (ADR 0036)", async () => {
    const t = setup({ view: () => ({ mergeable: "UNKNOWN" }) });
    await t.land();
    await t.again();
    expect(t.direct()).toBe(false);
    expect(t.merges()).toEqual([{ runId: "r1", merged: false, wait: true, reason: expect.stringContaining("mergeability") }]);
    // The checks are not even asked while GitHub has not answered the first question.
    expect(t.calls.some((a) => a.includes("statusCheckRollup"))).toBe(false);
  });

  it("the next ask merges once GitHub has worked it out", async () => {
    let mergeable = "UNKNOWN";
    const t = setup({ view: () => ({ mergeable }) });
    await t.again();
    mergeable = "MERGEABLE";
    await t.again();
    expect(t.merges().map((m) => m.merged)).toEqual([true, false]); // newest first
    expect(t.merged()).toBe(1);
  });

  describe("GitHub unreadable (network, gh logged out, rate limit) is a wait, up to MAX_UNREADABLE in a row (ADR 0036)", () => {
    it("a passing failure, then a readable answer: a wait, then the merge — never a skip", async () => {
      let down = true;
      const t = setup();
      const flaky: GitRunner = async (args) => (down && args.includes("--json") ? { ok: false, stdout: "", stderr: "connection reset" } : t.gh(args, "/repo"));
      await mergeWhenReady(t.store, t.card.id, "/repo", "board/x", green, flaky, () => NOW);
      expect(t.merges()).toEqual([{ runId: "r1", merged: false, wait: true, reason: expect.stringContaining("could not read the PR's state") }]);
      down = false;
      await mergeWhenReady(t.store, t.card.id, "/repo", "board/x", green, flaky, () => NOW);
      expect(t.merged()).toBe(1);
    });

    it("the checks unreadable count too; MAX_UNREADABLE in a row is a skip the caller halts on — journaled once until then", async () => {
      const t = setup();
      const noChecks: GitRunner = async (args) => (args.includes("statusCheckRollup") ? { ok: false, stdout: "", stderr: "API rate limit exceeded" } : t.gh(args, "/repo"));
      for (let i = 0; i < MAX_UNREADABLE - 1; i++) await mergeWhenReady(t.store, t.card.id, "/repo", "board/x", green, noChecks, () => NOW);
      expect(t.merges()).toHaveLength(1);
      expect(t.merges()[0]).toMatchObject({ wait: true });
      await mergeWhenReady(t.store, t.card.id, "/repo", "board/x", green, noChecks, () => NOW);
      expect(t.merges()[0]).toEqual({ runId: "r1", merged: false, reason: expect.stringContaining(`${MAX_UNREADABLE} times in a row`) });
      expect(t.direct()).toBe(false);
    });
  });

  it("a PR journaled closed, reopened and merged on GitHub, is journaled merged — the land step does not spin for ever", async () => {
    const t = setup({ view: () => ({ state: "MERGED", mergedAt: "2026-10-12T11:00:00Z" }) });
    t.store.recordEvent(t.card.id, "card.pr_closed", { url: "https://gh/o/r/pull/1" });
    await t.again();
    expect(t.merged()).toBe(1);
    await t.again();
    expect(t.merged()).toBe(1);
  });

  it("a PR found already merged — GitHub's auto-merge, a human — is journaled as merged, not skipped", async () => {
    const t = setup({ view: () => ({ state: "MERGED", mergedAt: "2026-10-12T11:00:00Z" }) });
    await t.again();
    expect(t.direct()).toBe(false);
    expect(t.merges()).toEqual([]);
    expect(t.merged()).toBe(1);
  });

  describe("the PR's GitHub checks (ADR 0029)", () => {
    const done = { __typename: "CheckRun", name: "ci", status: "COMPLETED" };

    it("merges on green", async () => {
      const t = setup({ rollup: () => [{ ...done, conclusion: "SUCCESS" }] });
      await t.again();
      expect(t.direct()).toBe(true);
    });

    it("an empty rollup on a young PR is a wait — GitHub has not registered the checks yet", async () => {
      const t = setup({ view: () => ({ createdAt: FRESH }) });
      await t.again();
      expect(t.direct()).toBe(false);
      expect(t.merges()[0]).toMatchObject({ merged: false, wait: true });
    });

    it("an empty rollup on an older PR is a repo with no CI: it merges", async () => {
      const t = setup({ view: () => ({ createdAt: OLD }) });
      await t.again();
      expect(t.direct()).toBe(true);
    });

    it("an empty rollup on a PR whose age GitHub did not give is read against the journaled push — never an endless wait", async () => {
      const t = setup({ view: () => ({ createdAt: undefined }) });
      await t.again();
      expect(t.direct()).toBe(true);
    });

    it("a re-push restarts the grace: pr_updated a moment ago, the PR itself old, an empty rollup — a wait", async () => {
      const t = setup({ view: () => ({ createdAt: OLD }) });
      t.clock.t = Date.parse(FRESH);
      t.store.recordEvent(t.card.id, "card.pr_updated", { url: "https://gh/o/r/pull/1" });
      await t.again();
      expect(t.direct()).toBe(false);
      expect(t.merges()[0]).toMatchObject({ merged: false, wait: true, reason: expect.stringContaining("no check") });
    });

    it("never merges a red check, and hands the worker its name and log", async () => {
      const t = setup({ rollup: () => [{ ...done, name: "typecheck", conclusion: "FAILURE", detailsUrl: "https://github.com/o/r/actions/runs/42/job/7" }] });
      await t.again();
      expect(t.direct()).toBe(false);
      expect(t.merges()[0]).toMatchObject({ merged: false, ci: { name: "typecheck", log: expect.stringContaining("TS2554") } });
    });

    it("waits on a running check without merging, and journals the wait once", async () => {
      const t = setup({ rollup: () => [{ ...done, status: "IN_PROGRESS", conclusion: "" }] });
      await t.land();
      await t.again();
      expect(t.direct()).toBe(false);
      expect(t.merges()).toHaveLength(1);
      expect(t.merges()[0]).toMatchObject({ merged: false, wait: true });
    });
  });

  describe("a merge repoints the cards forked from the merged branch", () => {
    const chain = () => {
      const t = setup();
      t.store.patchCard(t.card.id, { branch: "board/x" });
      const next = t.store.createCard({ title: "next", repoPath: "/repo", baseRef: "board/x", dependsOn: t.card.id });
      return { ...t, next };
    };

    it("the board's own merge", async () => {
      const t = chain();
      await t.again();
      expect(t.store.getCard(t.next.id)!.baseRef).toBe("main");
    });

    it("a merge GitHub reports — auto-merge, a human — seen by a Check, a card screen, the follower", () => {
      const t = chain();
      notePrOutcome(t.store, t.card.id, { state: "merged", url: "u", mergedAt: 1, conflicting: false, mergeable: false, createdAt: null });
      expect(t.store.getCard(t.next.id)!.baseRef).toBe("main");
    });

    it("a card with no baseRef (an older row) repoints to the base its PR was opened against", () => {
      const t = setup();
      t.store.patchCard(t.card.id, { branch: "board/x", baseRef: null });
      t.store.recordEvent(t.card.id, "card.pr_opened", { url: "u", base: "trunk" });
      const next = t.store.createCard({ title: "next", repoPath: "/repo", baseRef: "board/x", dependsOn: t.card.id });
      notePrOutcome(t.store, t.card.id, { state: "merged", url: "u", mergedAt: 1, conflicting: false, mergeable: false, createdAt: null });
      expect(t.store.getCard(next.id)!.baseRef).toBe("trunk");
    });

    it("a dependent already started is told its branch still carries the predecessor's commits", () => {
      const t = chain();
      t.store.recordEvent(t.next.id, "card.worktree", { branch: "board/next", base: "board/x" });
      const idle = t.store.createCard({ title: "idle", repoPath: "/repo", baseRef: "board/x", dependsOn: t.card.id });
      notePrOutcome(t.store, t.card.id, { state: "merged", url: "u", mergedAt: 1, conflicting: false, mergeable: false, createdAt: null });
      expect(t.store.listEvents(t.next.id).find((e) => e.type === "card.base_moved")?.payload).toEqual({ from: "board/x", to: "main", reason: "predecessor PR merged" });
      expect(t.store.listEvents(idle.id).some((e) => e.type === "card.base_moved")).toBe(false);
    });

    it("a PR the agent opened itself (only `pr_updated` in the journal), merged: journaled, its dependents rebound", async () => {
      const store = new BoardDb(":memory:");
      const card = store.createCard({ title: "t", repoPath: "/repo", baseRef: "main" });
      store.patchCard(card.id, { branch: "board/x" });
      store.recordEvent(card.id, "card.pr_updated", { url: "https://gh/o/r/pull/1", base: "main" });
      const next = store.createCard({ title: "next", repoPath: "/repo", baseRef: "board/x", dependsOn: card.id });
      const { gh } = ghDouble({ view: () => ({ state: "MERGED", mergedAt: "2026-10-12T11:00:00Z" }) });
      await mergeWhenReady(store, card.id, "/repo", "board/x", green, gh, () => NOW);
      expect(store.listEvents(card.id).filter((e) => e.type === "card.pr_merged")).toHaveLength(1);
      expect(store.getCard(next.id)!.baseRef).toBe("main");
    });

    it("the merge journaled by a card screen while the board's own merge was in flight is journaled once", async () => {
      const t = chain();
      const racing: GitRunner = async (args, cwd) => {
        if (args[0] === "pr" && args[1] === "merge" && !args.includes("--auto")) {
          notePrOutcome(t.store, t.card.id, { state: "merged", url: "u", mergedAt: 1, conflicting: false, mergeable: false, createdAt: null });
        }
        return t.gh(args, cwd);
      };
      await mergeWhenReady(t.store, t.card.id, "/repo", "board/x", green, racing, () => NOW);
      expect(t.merged()).toBe(1);
      expect(t.store.getCard(t.next.id)!.baseRef).toBe("main");
    });

    it("not on a closed PR: nothing landed", () => {
      const t = chain();
      notePrOutcome(t.store, t.card.id, { state: "closed", url: "u", mergedAt: null, conflicting: false, mergeable: false, createdAt: null });
      expect(t.store.getCard(t.next.id)!.baseRef).toBe("board/x");
    });
  });
});

// Incident 20/10 (card e3745ea1): « Fusionner » on a card whose PR was open, its branch rebased and
// pushed from elsewhere, merged the stale local branch into main, pushed nothing and filed the card.
describe("mergeCard: the PR when there is one, origin's version, and pushed", () => {
  function git(cwd: string, ...args: string[]): string {
    const r = Bun.spawnSync(["git", ...args], { cwd, env: gitFreeEnv });
    if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
    return r.stdout.toString().trim();
  }
  const noPr = fakeGit({ "pr view": { ok: false, stderr: "no pull requests found" } }).git;

  /** A repo on main, a card branch one commit ahead, both pushed to a bare origin. */
  const fixture = async () => {
    const repo = join(tmpdir(), `collie-mergepr-${Math.random().toString(36).slice(2)}`);
    const origin = `${repo}-origin.git`;
    await mkdir(repo, { recursive: true });
    git(tmpdir(), "init", "-q", "--bare", "-b", "main", origin);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.name", "t");
    git(repo, "config", "user.email", "t@t");
    git(repo, "config", "commit.gpgsign", "false");
    git(repo, "remote", "add", "origin", origin);
    await Bun.write(join(repo, "README"), "x\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "init");
    git(repo, "checkout", "-q", "-b", "board/x");
    await Bun.write(join(repo, "x.ts"), "export {};\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "x");
    git(repo, "push", "-q", "origin", "main", "board/x");
    git(repo, "checkout", "-q", "main");
    const store = new BoardDb(":memory:");
    const card = store.createCard({ title: "x", repoPath: repo, baseRef: "main" });
    store.patchCard(card.id, { branch: "board/x" });
    const cleanup = async () => {
      await rm(repo, { recursive: true, force: true });
      await rm(origin, { recursive: true, force: true });
    };
    return { repo, origin, store, card: store.getCard(card.id)!, cleanup };
  };

  it("an open PR is merged on GitHub — no local merge, the merge journaled", async () => {
    const t = await fixture();
    const before = git(t.repo, "rev-parse", "main");
    const { git: gh, calls } = fakeGit({
      "pr view": { stdout: JSON.stringify({ state: "OPEN", url: "https://x/pull/148", mergeable: "MERGEABLE", mergedAt: null, createdAt: null }) },
    });
    t.store.recordEvent(t.card.id, "card.pr_opened", { branch: "board/x", base: "main", url: "https://x/pull/148" });
    const r = await mergeCard(t.store, t.card, gh);
    expect(r).toMatchObject({ ok: true, value: { url: "https://x/pull/148" } });
    expect(calls.some((a) => a.join(" ") === "pr merge board/x --squash")).toBe(true);
    expect(git(t.repo, "rev-parse", "main")).toBe(before);
    expect(t.store.listEvents(t.card.id).some((e) => e.type === "card.pr_merged")).toBe(true);
    await t.cleanup();
  });

  it("card.prUrl: the PR the board opened for it, read from the journal", async () => {
    const t = await fixture();
    expect(prUrlOf(t.store, t.card.id)).toBeNull();
    t.store.recordEvent(t.card.id, "card.pr_opened", { branch: "board/x", base: "main", url: "https://x/pull/148" });
    expect(prUrlOf(t.store, t.card.id)).toBe("https://x/pull/148");
    await t.cleanup();
  });

  it("a conflicting PR is refused, nothing merged anywhere", async () => {
    const t = await fixture();
    const { git: gh, calls } = fakeGit({
      "pr view": { stdout: JSON.stringify({ state: "OPEN", url: "u", mergeable: "CONFLICTING", mergedAt: null, createdAt: null }) },
    });
    expect(await mergeCard(t.store, t.card, gh)).toMatchObject({ ok: false, error: { kind: "conflict" } });
    expect(calls.some((a) => a[1] === "merge")).toBe(false);
    await t.cleanup();
  });

  it("no PR: merges locally and pushes the base", async () => {
    const t = await fixture();
    expect((await mergeCard(t.store, t.card, noPr)).ok).toBe(true);
    expect(git(t.origin, "rev-parse", "main")).toBe(git(t.repo, "rev-parse", "main"));
    expect(git(t.repo, "cat-file", "-t", "origin/main:x.ts")).toBe("blob");
    await t.cleanup();
  });

  it("a local branch behind origin (rebased elsewhere) is refused, main untouched", async () => {
    const t = await fixture();
    const before = git(t.repo, "rev-parse", "main");
    // The orchestrator's rebase: origin's board/x is rewritten, the local one is the old version.
    const other = `${t.repo}-other`;
    git(tmpdir(), "clone", "-q", "-b", "board/x", t.origin, other);
    git(other, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--amend", "-m", "x rebased");
    git(other, "push", "-q", "-f", "origin", "board/x");
    const r = await mergeCard(t.store, t.card, noPr);
    expect(r).toMatchObject({ ok: false, error: { kind: "refused" } });
    expect(git(t.repo, "rev-parse", "main")).toBe(before);
    await rm(other, { recursive: true, force: true });
    await t.cleanup();
  });

  describe("merge direct (ADR 0043): the run's own merge, nobody watching", () => {
    it("a dirty checkout is refused, main untouched", async () => {
      const t = await fixture();
      const before = git(t.repo, "rev-parse", "main");
      await Bun.write(join(t.repo, "README"), "edited\n");
      const r = await mergeCard(t.store, t.card, noPr, { direct: true });
      expect(r).toMatchObject({ ok: false, error: { kind: "refused" } });
      expect(git(t.repo, "rev-parse", "main")).toBe(before);
      expect(await Bun.file(join(t.repo, "README")).text()).toBe("edited\n");
      await t.cleanup();
    });

    it("a checkout not on main is refused, nothing merged", async () => {
      const t = await fixture();
      const before = git(t.repo, "rev-parse", "main");
      git(t.repo, "checkout", "-q", "-b", "elsewhere");
      const r = await mergeCard(t.store, t.card, noPr, { direct: true });
      expect(r).toMatchObject({ ok: false, error: { kind: "refused" } });
      expect(git(t.repo, "rev-parse", "main")).toBe(before);
      await t.cleanup();
    });

    it("no remote: merged here, nothing to push, ok", async () => {
      const t = await fixture();
      git(t.repo, "remote", "remove", "origin");
      expect((await mergeCard(t.store, t.card, noPr, { direct: true })).ok).toBe(true);
      expect(git(t.repo, "cat-file", "-t", "main:x.ts")).toBe("blob");
      await t.cleanup();
    });

    it("a remote: merged and pushed", async () => {
      const t = await fixture();
      expect((await mergeCard(t.store, t.card, noPr, { direct: true })).ok).toBe(true);
      expect(git(t.origin, "rev-parse", "main")).toBe(git(t.repo, "rev-parse", "main"));
      await t.cleanup();
    });
  });

  it("a push origin refuses undoes the merge: not ok, so the card is not filed", async () => {
    const t = await fixture();
    const before = git(t.repo, "rev-parse", "main");
    await Bun.write(join(t.origin, "hooks", "pre-receive"), "#!/bin/sh\necho no >&2\nexit 1\n");
    await chmod(join(t.origin, "hooks", "pre-receive"), 0o755);
    const r = await mergeCard(t.store, t.card, noPr);
    expect(r).toMatchObject({ ok: false, error: { kind: "git" } });
    expect(git(t.repo, "rev-parse", "main")).toBe(before);
    expect(t.store.listEvents(t.card.id).some((e) => e.type === "card.merged")).toBe(false);
    await t.cleanup();
  });
});
