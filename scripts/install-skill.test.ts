import { describe, expect, it } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SCRIPT = join(ROOT, "scripts/install-skill.sh");
const SRC = join(ROOT, "skills/collie-board");

const run = (dir: string) => {
  const r = Bun.spawnSync(["bash", SCRIPT], { env: { ...process.env, CLAUDE_SKILLS_DIR: dir, CLAUDE_SKILLS_BACKUP_DIR: join(dir, "..", `${basename(dir)}-backup`) } });
  return { code: r.exitCode, out: r.stdout.toString() };
};
const fresh = () => mkdtempSync(join(tmpdir(), "collie-skill-"));

describe("scripts/install-skill.sh", () => {
  it("links the versioned skill into the skills directory, and says so again as a no-op", () => {
    const dir = fresh();
    expect(run(dir).code).toBe(0);
    expect(lstatSync(join(dir, "collie-board")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(dir, "collie-board"))).toBe(SRC);
    expect(readFileSync(join(dir, "collie-board/SKILL.md"), "utf8")).toContain("name: collie-board");
    expect(run(dir).out).toContain("already linked");
  });

  it("moves an existing real copy aside instead of deleting it", () => {
    const dir = fresh();
    mkdirSync(join(dir, "collie-board"));
    writeFileSync(join(dir, "collie-board/SKILL.md"), "my old copy");
    expect(run(dir).code).toBe(0);
    expect(lstatSync(join(dir, "collie-board")).isSymbolicLink()).toBe(true);
    // Kept OUTSIDE the skills directory, where a second SKILL.md of the same name would load as a duplicate.
    expect(readdirSync(dir)).toEqual(["collie-board"]);
    const backupDir = join(dir, "..", `${basename(dir)}-backup`);
    const backup = readdirSync(backupDir).find((f) => f.startsWith("collie-board."))!;
    expect(readFileSync(join(backupDir, backup, "SKILL.md"), "utf8")).toBe("my old copy");
  });

  it("replaces a stale link and leaves no backup for it", () => {
    const dir = fresh();
    symlinkSync("/nowhere", join(dir, "collie-board"));
    expect(run(dir).code).toBe(0);
    expect(readlinkSync(join(dir, "collie-board"))).toBe(SRC);
    expect(readdirSync(dir)).toEqual(["collie-board"]);
  });

  it("the skill it installs exists in the repo", () => {
    expect(existsSync(join(SRC, "SKILL.md"))).toBe(true);
  });
});
