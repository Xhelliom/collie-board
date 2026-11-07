import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

// The environment every test hands to the git it spawns. Git exports GIT_DIR & co to its hooks and
// reads them BEFORE cwd or `-C`: left in, a fixture's `git init` / `clone --bare` / `config` lands
// on the REAL repository (core.bare=true, user.name=t). It must travel with the tests — the pre-push
// hook that runs is the MAIN checkout's (core.hooksPath), not the branch's — and it must be passed
// explicitly: Bun.spawn without `env` inherits the process's original environment, whatever
// process.env says since.
const { GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_PREFIX, GIT_COMMON_DIR, GIT_OBJECT_DIRECTORY, ...rest } = process.env;
export const gitFreeEnv: Record<string, string | undefined> = rest;

// Windows refuses a symlink without Developer Mode or elevation (EPERM). The symlink-escape tests are
// security tests: they skip where the fixture can't be built, they are never deleted.
export const canSymlink =
  process.platform !== "win32" ||
  (() => {
    const dir = mkdtempSync(join(tmpdir(), "collie-symlink-"));
    try {
      symlinkSync(dir, join(dir, "probe"));
      return true;
    } catch {
      return false;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();

/**
 * A fake executable `name` in `dir`, found on PATH by `Bun.spawn([name, …])` on every platform: a
 * `#!/bin/sh` script off win32, and a `name.cmd` beside it for win32, which runs no shebang and
 * finds a command through PATHEXT. Each side gets its own body, in its own syntax (`$3` / `%3`).
 */
export function writeFakeBin(dir: string, name: string, body: { sh: string; cmd: string }): void {
  writeFileSync(join(dir, name), `#!/bin/sh\n${body.sh}\n`, { mode: 0o755 });
  writeFileSync(join(dir, `${name}.cmd`), `@echo off\r\n${body.cmd}\r\n`);
}

/** `dir` put first on PATH, with the platform's own separator (`;` on win32, `:` elsewhere). */
export const pathWith = (dir: string, path = process.env.PATH ?? ""): string => `${dir}${delimiter}${path}`;
