import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gitFreeEnv } from "./test-env.ts";

// The check runs on the author's machine, where an un-added file still exists on disk: it must name
// that file, and stay quiet about what .gitignore says is not the repo's.

const script = join(import.meta.dir, "check-untracked.sh");
let dir = "";
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

function repo(): string {
  dir = mkdtempSync(join(tmpdir(), "untracked-"));
  const git = (...a: string[]) => Bun.spawnSync(["git", "-C", dir, ...a], { env: gitFreeEnv });
  git("init", "-q");
  writeFileSync(join(dir, ".gitignore"), "ignored.txt\n");
  git("add", ".gitignore");
  return dir;
}
const run = (cwd: string) => Bun.spawnSync(["bash", script], { cwd, env: gitFreeEnv });

describe("check-untracked.sh", () => {
  it("fails and prints the path of an untracked file", () => {
    const d = repo();
    mkdirSync(join(d, "web/src"), { recursive: true });
    writeFileSync(join(d, "web/src/tag-chip.tsx"), "export {};");
    const r = run(d);
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("web/src/tag-chip.tsx");
  });

  it("ignores files covered by .gitignore", () => {
    const d = repo();
    writeFileSync(join(d, "ignored.txt"), "x");
    expect(run(d).exitCode).toBe(0);
  });

  it("passes on a clean tree", () => {
    expect(run(repo()).exitCode).toBe(0);
  });
});
