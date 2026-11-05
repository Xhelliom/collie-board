import { describe, expect, it } from "vitest";

import { lineLabel, numberDiff } from "./diff-comments";

describe("numberDiff", () => {
  it("numbers code lines from the hunk header and leaves headers alone", () => {
    const lines = numberDiff("--- a/x\n+++ b/x\n@@ -3,2 +3,2 @@\n ctx\n-gone\n+came\n\\ No newline at end of file");
    expect(lines.map((l) => [l.code, l.oldNo, l.newNo])).toEqual([
      [false, null, null],
      [false, null, null],
      [false, null, null],
      [true, 3, 3],
      [true, 4, null],
      [true, null, 4],
      [false, null, null],
    ]);
  });
});

describe("lineLabel", () => {
  it("joins consecutive lines into ranges, a removal by its old number", () => {
    const lines = numberDiff("@@ -3,2 +3,3 @@\n ctx\n-gone\n+a\n+b");
    expect(lineLabel(lines.slice(1))).toBe("+3, -4, +4–5");
  });
});
