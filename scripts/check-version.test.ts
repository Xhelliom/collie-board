import { describe, expect, it } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A big CHANGELOG used to kill check-version.sh with 141 (sed SIGPIPE'd by `head -1`, pipefail, set -e).
describe("check-version.sh with a 300 KB CHANGELOG", () => {
  it("exits 0, 20 times in a row", () => {
    const root = mkdtempSync(join(tmpdir(), "cv-"));
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "web"));
    cpSync(join(import.meta.dir, "check-version.sh"), join(root, "scripts", "check-version.sh"));
    writeFileSync(join(root, "herdr-plugin.toml"), 'id = "x"\nversion = "1.2.3"\n');
    writeFileSync(join(root, "package.json"), '{\n  "version": "1.2.3"\n}\n');
    writeFileSync(join(root, "web", "package.json"), '{\n  "version": "1.2.3"\n}\n');
    const old = Array.from({ length: 6000 }, (_, i) => `## [0.0.${i}] - 2020-01-01\n- an old entry\n`).join("\n");
    writeFileSync(join(root, "CHANGELOG.md"), `## [1.2.3] - 2026-11-14\n\n${old}`);
    for (let i = 0; i < 20; i++) {
      const p = Bun.spawnSync(["bash", join(root, "scripts", "check-version.sh")], { stdout: "pipe", stderr: "pipe" });
      expect(`${i}:${p.exitCode}:${p.stderr.toString()}`).toBe(`${i}:0:`);
    }
  });
});
