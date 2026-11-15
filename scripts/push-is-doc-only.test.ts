import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { gitFreeEnv } from "./test-env.ts";

// The pre-push hook skips typecheck and suites only when the push is documentation alone.

const script = join(import.meta.dir, "push-is-doc-only.sh");
const zero = "0".repeat(40);
let dir = "";
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

function repo() {
  dir = mkdtempSync(join(tmpdir(), "doc-only-"));
  const git = (...a: string[]) =>
    Bun.spawnSync(["git", "-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { env: gitFreeEnv }).stdout.toString().trim();
  git("init", "-q", "-b", "main");
  const commit = (...files: string[]) => {
    for (const f of files) {
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      writeFileSync(join(dir, f), f + Math.random());
    }
    git("add", "-A");
    git("commit", "-q", "-m", "c");
    return git("rev-parse", "HEAD");
  };
  return { git, commit };
}
const run = (stdin: string) => Bun.spawnSync(["bash", script], { cwd: dir, env: gitFreeEnv, stdin: Buffer.from(stdin) }).exitCode;

describe.skipIf(!Bun.which("bash"))("push-is-doc-only.sh", () => {
  it("accepts a push of docs only", () => {
    const { commit } = repo();
    const base = commit("a.ts");
    const head = commit("README.md", "docs/x.txt", ".adr/0001.txt", "changes/f.txt");
    expect(run(`refs/heads/b ${head} refs/heads/b ${base}\n`)).toBe(0);
  });
  it("refuses a push touching code", () => {
    const { commit } = repo();
    const base = commit("a.ts");
    commit("README.md");
    const head = commit("bridge/x.ts");
    expect(run(`refs/heads/b ${head} refs/heads/b ${base}\n`)).toBe(1);
  });
  it("compares a new branch with its base (origin/HEAD), not with nothing", () => {
    const { git, commit } = repo();
    const base = commit("a.ts");
    git("update-ref", "refs/remotes/origin/main", base);
    git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    const head = commit("notes.md");
    expect(run(`refs/heads/n ${head} refs/heads/n ${zero}\n`)).toBe(0);
    const code = commit("x.ts");
    expect(run(`refs/heads/n ${code} refs/heads/n ${zero}\n`)).toBe(1);
  });
  it("runs everything when the base cannot be computed or there is nothing to read", () => {
    const { commit } = repo();
    const head = commit("notes.md");
    expect(run(`refs/heads/n ${head} refs/heads/n ${zero}\n`)).toBe(1); // no origin/HEAD
    expect(run(`refs/heads/n ${head} refs/heads/n ${"1".repeat(40)}\n`)).toBe(1); // unknown remote sha
    expect(run("")).toBe(1);
  });
});
