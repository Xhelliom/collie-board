import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gitFreeEnv } from "./test-env.ts";

// Audit P6: the gate skips the suites only on the very commit the pre-push ran them green on.
const script = join(import.meta.dir, "tests-passed.sh");
let repo = "";
afterEach(() => repo && rmSync(repo, { recursive: true, force: true }));

const git = (...a: string[]) => Bun.spawnSync(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { env: gitFreeEnv });
const run = (...a: string[]) => Bun.spawnSync(["bash", script, ...a], { cwd: repo, env: gitFreeEnv }).exitCode;
const commit = (file: string) => (writeFileSync(join(repo, file), file), git("add", "-A"), git("commit", "-q", "-m", file));

describe.skipIf(process.platform === "win32" || !Bun.which("bash"))("tests-passed.sh", () => {
  it("skips only on the noted commit with a clean tree; any gap runs everything", () => {
    repo = mkdtempSync(join(tmpdir(), "tests-passed-"));
    git("init", "-q");
    commit("a");
    expect(run()).toBe(1); // no note: run
    run("record");
    expect(run()).toBe(0); // same commit: skip
    writeFileSync(join(repo, "a"), "changed");
    expect(run()).toBe(1); // same commit, edited tree: run
    git("checkout", "-q", "--", "a");
    expect(run()).toBe(0);
    writeFileSync(join(repo, "new"), "x");
    expect(run()).toBe(1); // an untracked file: run
    rmSync(join(repo, "new"));
    commit("b");
    expect(run()).toBe(1); // another commit: run
  });

  it("a record on a dirty tree forgets the previous note", () => {
    repo = mkdtempSync(join(tmpdir(), "tests-passed-"));
    git("init", "-q");
    commit("a");
    run("record");
    writeFileSync(join(repo, "a"), "changed");
    run("record");
    git("checkout", "-q", "--", "a");
    expect(run()).toBe(1);
  });
});
