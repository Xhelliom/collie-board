import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitFreeEnv } from "../scripts/test-env.ts";

import type { JournalEntry } from "./db.ts";
import { JOURNAL_REF, journalFailure, receiveJournal, sendJournal } from "./git.ts";

// ADR 0048 §2–3, lot 2: the journal's git plumbing, against a bare remote in a temp dir.

const A = "aaaaaaaaaaaa";
const B = "bbbbbbbbbbbb";

function sh(cwd: string, ...args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd, env: gitFreeEnv });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

/** A bare remote with a `main`, and `n` clones of it, each with an identity and a dirty worktree. */
function setup(n: number) {
  const root = mkdtempSync(join(tmpdir(), "journal-"));
  const bare = join(root, "remote.git");
  sh(root, "init", "--bare", "-b", "main", bare);
  const clones = Array.from({ length: n }, (_, i) => {
    const dir = join(root, `clone${i}`);
    sh(root, "clone", "-q", bare, dir);
    sh(dir, "config", "user.email", `p${i}@t`);
    sh(dir, "config", "user.name", `p${i}`);
    sh(dir, "config", "commit.gpgsign", "false");
    if (i === 0) {
      writeFileSync(join(dir, "code.txt"), "code\n");
      sh(dir, "add", "-A");
      sh(dir, "commit", "-qm", "code");
      sh(dir, "push", "-q", "origin", "main");
    } else sh(dir, "pull", "-q", "origin", "main");
    return dir;
  });
  return { root, bare, clones };
}

const ev = (entity: string, hlc: string, fields: Record<string, unknown>): JournalEntry => ({
  entity,
  event: { v: 1, hlc, type: entity === "roadmap" ? "roadmap.set" : "card.set", by: "t@t", fields },
});
const hlc = (n: number, pair: string) => `${String(n).padStart(13, "0")}.0000.${pair}`;

describe("journal over git — orphan branch, send, receive, union by writer", () => {
  test("first send creates the orphan branch; a second clone receives it", async () => {
    const { bare, clones } = setup(2);
    const [a, b] = clones as [string, string];
    const e1 = ev("cards/c1", hlc(1, A), { title: "one" });
    const e2 = ev("roadmap", hlc(2, A), { vision: "v" });

    expect(await receiveJournal(a, "origin")).toEqual({ ok: true, entries: [] }); // no branch yet
    expect(await sendJournal(a, "origin", A, [e1, e2])).toEqual({ ok: true, pushed: true });

    // Orphan: a root commit sharing no history with main, holding only this pair's files.
    expect(sh(bare, "rev-list", "--count", "collie-board").trim()).toBe("1");
    expect(Bun.spawnSync(["git", "merge-base", "collie-board", "main"], { cwd: bare, env: gitFreeEnv }).exitCode).toBe(1);
    expect(sh(bare, "ls-tree", "-r", "--name-only", "collie-board").trim().split("\n")).toEqual([
      `cards/c1/${A}.jsonl`,
      `roadmap/${A}.jsonl`,
    ]);

    const got = await receiveJournal(b, "origin");
    expect(got).toEqual({ ok: true, entries: [e1, e2] });
    // Read means read: once marked, nothing comes back twice.
    expect(await sendJournal(b, "origin", B, [])).toEqual({ ok: true, pushed: false });
    expect(await receiveJournal(b, "origin")).toEqual({ ok: true, entries: [] });
  });

  test("two writers on one card: a rejected push, then the union, with no conflict", async () => {
    const { bare, clones } = setup(2);
    const [a, b] = clones as [string, string];
    const ea = ev("cards/c1", hlc(1, A), { title: "from A" });
    const eb = ev("cards/c1", hlc(2, B), { status: "doing" });

    expect((await sendJournal(a, "origin", A, [ea])).ok).toBe(true);
    // B has not fetched: its push is not a fast-forward.
    const refused = await sendJournal(b, "origin", B, [eb]);
    expect(refused).toMatchObject({ ok: false, kind: "rejected" });

    // Next tick: receive, then send the same outbox again.
    expect(await receiveJournal(b, "origin")).toEqual({ ok: true, entries: [ea] });
    expect(await sendJournal(b, "origin", B, [eb])).toEqual({ ok: true, pushed: true });

    expect(sh(bare, "ls-tree", "-r", "--name-only", "collie-board").trim().split("\n")).toEqual([
      `cards/c1/${A}.jsonl`,
      `cards/c1/${B}.jsonl`,
    ]);
    expect(await receiveJournal(a, "origin")).toEqual({ ok: true, entries: [eb] });

    // A appends again: its file grows, B's stays, and resending a line already sent adds nothing.
    const ea2 = ev("cards/c1", hlc(3, A), { title: "again" });
    expect((await sendJournal(a, "origin", A, [ea, ea2])).ok).toBe(true);
    expect(sh(bare, "show", `collie-board:cards/c1/${A}.jsonl`).trim().split("\n")).toHaveLength(2);
    expect(await receiveJournal(b, "origin")).toEqual({ ok: true, entries: [ea2] });
  });

  test("never checks out: the operator's worktree, index, HEAD and branches are untouched", async () => {
    const { clones } = setup(1);
    const [a] = clones as [string];
    writeFileSync(join(a, "code.txt"), "dirty, uncommitted\n");
    writeFileSync(join(a, "scratch.txt"), "untracked\n");
    sh(a, "add", "scratch.txt");
    const before = [sh(a, "status", "--porcelain"), sh(a, "rev-parse", "HEAD"), sh(a, "branch", "--list"), sh(a, "diff", "--cached")];

    expect((await sendJournal(a, "origin", A, [ev("cards/c1", hlc(1, A), { title: "x" })])).ok).toBe(true);
    expect((await receiveJournal(a, "origin")).ok).toBe(true);

    expect([sh(a, "status", "--porcelain"), sh(a, "rev-parse", "HEAD"), sh(a, "branch", "--list"), sh(a, "diff", "--cached")]).toEqual(before);
    expect(readFileSync(join(a, "code.txt"), "utf8")).toBe("dirty, uncommitted\n");
    expect(sh(a, "rev-parse", "--verify", JOURNAL_REF).trim()).toMatch(/^[0-9a-f]{40}$/);
    expect(sh(a, "for-each-ref", "refs/heads")).not.toContain("collie-board");
  });
});

describe("journal over git — a refusal says which one", () => {
  test("denied: the remote refuses the branch (protected / 403)", async () => {
    const { bare, clones } = setup(1);
    const hook = join(bare, "hooks", "pre-receive");
    writeFileSync(hook, "#!/bin/sh\necho 'protected branch' >&2\nexit 1\n", { mode: 0o755 });
    const r = await sendJournal(clones[0]!, "origin", A, [ev("cards/c1", hlc(1, A), { title: "x" })]);
    expect(r).toMatchObject({ ok: false, kind: "denied" });
  });

  test("unreachable: the remote is gone", async () => {
    const { root, clones } = setup(1);
    const a = clones[0]!;
    sh(a, "remote", "set-url", "origin", join(root, "nowhere.git"));
    expect(await receiveJournal(a, "origin")).toMatchObject({ ok: false, kind: "unreachable" });
    expect(await sendJournal(a, "origin", A, [ev("cards/c1", hlc(1, A), { title: "x" })])).toMatchObject({ ok: false, kind: "unreachable" });
  });

  test("GitHub's own words land in the right kind", () => {
    expect(journalFailure("remote: Permission to o/r.git denied to u.\nfatal: unable to access 'https://github.com/o/r.git/': The requested URL returned error: 403").kind).toBe("denied");
    expect(journalFailure(" ! [remote rejected] collie-board -> collie-board (protected branch hook declined)").kind).toBe("denied");
    expect(journalFailure(" ! [rejected]        collie-board -> collie-board (fetch first)").kind).toBe("rejected");
    expect(journalFailure("fatal: unable to access 'https://github.com/o/r.git/': Could not resolve host: github.com").kind).toBe("unreachable");
    expect(journalFailure("fatal: bad object").kind).toBe("error");
  });

  test("a remote name or entity that could be an option is refused before git runs", async () => {
    const git = async () => {
      throw new Error("git must not run");
    };
    expect(await receiveJournal("/r", "--upload-pack=x", git)).toMatchObject({ ok: false, kind: "error" });
    expect(await sendJournal("/r", "origin", A, [ev("cards/../x", hlc(1, A), {})], git)).toMatchObject({ ok: false, kind: "error" });
  });
});
