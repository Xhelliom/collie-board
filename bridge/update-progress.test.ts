import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseUpdateStep, readUpdateProgress, UPDATE_STEP_FILE } from "./update-progress.ts";

const dir = mkdtempSync(join(tmpdir(), "update-step-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("update progress", () => {
  test("parses the ctl's one line, refuses anything else", () => {
    expect(parseUpdateStep("build\n")).toEqual({ step: "build", failed: false });
    expect(parseUpdateStep("fetch failed")).toEqual({ step: "fetch", failed: true });
    expect(parseUpdateStep("typecheck")).toBeNull();
    expect(parseUpdateStep("")).toBeNull();
  });

  test("reads a fresh file, ignores a stale one, a missing one, or no config dir", () => {
    expect(readUpdateProgress(dir)).toBeNull();
    expect(readUpdateProgress("")).toBeNull();
    const file = join(dir, UPDATE_STEP_FILE);
    writeFileSync(file, "restart\n");
    expect(readUpdateProgress(dir)).toEqual({ step: "restart", failed: false });
    const hourAgo = (Date.now() - 3_600_000) / 1000;
    utimesSync(file, hourAgo, hourAgo);
    expect(readUpdateProgress(dir)).toBeNull();
  });
});
