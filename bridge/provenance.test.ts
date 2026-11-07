// ADR 0010 under herdr-core (ADR 0052 §5): an hc terminal exports HC_TERMINAL_ID and no HERDR_PANE_ID,
// so anything that relays the pane id as `x-collie-pane` must relay both — or an agent becomes `human`.
// This scans every relay site; the behaviour itself is tested in mcp.test.ts and since-hook.test.ts.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";

const root = join(import.meta.dir, "..");
const sources = ["bridge/**/*.ts", "skills/**/*.{ts,md,sh}", "scripts/**/*.{ts,sh}", "web/src/**/*.{ts,tsx}"]
  // `/`-joined on every platform: Glob answers in the host's separator (`bridge\mcp.ts` on win32).
  .flatMap((p) => [...new Glob(p).scanSync({ cwd: root })].map((f) => f.replaceAll("\\", "/")))
  .filter((f) => !/\.test\.tsx?$/.test(f));

describe("provenance: HC_TERMINAL_ID is relayed wherever HERDR_PANE_ID is", () => {
  it("no shell relay sends $HERDR_PANE_ID without the hc fallback", () => {
    const bare = sources.filter((f) => /x-collie-pane: \$HERDR_PANE_ID\b/.test(readFileSync(join(root, f), "utf8")));
    expect(bare).toEqual([]);
  });

  it("no code reads env.HERDR_PANE_ID without reading HC_TERMINAL_ID", () => {
    const bare = sources.filter((f) => {
      const s = readFileSync(join(root, f), "utf8");
      return /env\.HERDR_PANE_ID\b/.test(s) && !/env\.HC_TERMINAL_ID\b/.test(s);
    });
    expect(bare).toEqual([]);
  });

  it("the scan does see the relay sites (a moved file must not pass it silently)", () => {
    expect(sources).toContain("bridge/mcp.ts");
    expect(sources).toContain("skills/collie-board/since-hook.ts");
  });
});
