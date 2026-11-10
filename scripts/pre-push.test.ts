import { afterEach, describe, expect, it } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gitFreeEnv, pathWith, writeFakeBin } from "./test-env.ts";

// git hands its hooks GIT_DIR & co. A test that forgets gitFreeEnv then writes in the repository
// being pushed (a commit « init » on a card's branch, incident 10/11): the hook strips them itself.

const hook = join(import.meta.dir, "git-hooks/pre-push");
let tmp = "";
afterEach(() => tmp && rmSync(tmp, { recursive: true, force: true }));

describe.skipIf(process.platform === "win32" || !Bun.which("bash"))("pre-push", () => {
  it("runs the suites with no GIT_* variable, so a forgetful test cannot move a ref of the pushed repo", () => {
    tmp = mkdtempSync(join(tmpdir(), "pre-push-"));
    const repo = join(tmp, "repo");
    const bin = join(tmp, "bin");
    const seen = join(tmp, "seen");
    mkdirSync(join(repo, "scripts"), { recursive: true });
    mkdirSync(join(repo, "web"));
    mkdirSync(bin);
    cpSync(join(import.meta.dir, "check-untracked.sh"), join(repo, "scripts/check-untracked.sh"));
    writeFileSync(join(repo, "scripts/collie-board-ctl.test.sh"), "");
    writeFileSync(join(repo, "web/.gitkeep"), "");
    const git = (...a: string[]) => Bun.spawnSync(["git", "-C", repo, ...a], { env: gitFreeEnv }).stdout.toString();
    git("init", "-q");
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "real");
    const refs = () => git("for-each-ref") + git("rev-parse", "HEAD");
    const before = refs();
    expect(before).not.toBe("");

    // Every suite the hook starts is this `bun`: it records the GIT_* it was given, then does what a
    // test without gitFreeEnv does — `git init` + commit in a temp directory.
    writeFakeBin(bin, "bun", {
      sh: `env | grep '^GIT_' >> "${seen}"; echo ran >> "${seen}"
d=$(mktemp -d "${tmp}/fixture.XXXXXX") && cd "$d" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init`,
      cmd: "exit /b 0",
    });

    const r = Bun.spawnSync(["bash", hook], {
      cwd: repo,
      env: {
        ...gitFreeEnv,
        PATH: pathWith(bin),
        GIT_DIR: join(repo, ".git"),
        GIT_WORK_TREE: repo,
        GIT_INDEX_FILE: join(repo, ".git/index"),
        GIT_AUTHOR_NAME: "t",
      },
    });
    expect(r.exitCode).toBe(0);
    expect(readFileSync(seen, "utf8")).toMatch(/^(ran\n)+$/);
    expect(refs()).toBe(before);
  });
});
