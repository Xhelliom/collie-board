import { describe, expect, it } from "vitest";

import { expandPastes, isCollapsiblePaste, liveChips, pasteLabel, pasteMarker } from "./paste-chips";

describe("paste chips", () => {
  it("collapses from 5 lines or 300 characters", () => {
    expect(isCollapsiblePaste("a\nb\nc\nd")).toBe(false);
    expect(isCollapsiblePaste("a\nb\nc\nd\ne")).toBe(true);
    expect(isCollapsiblePaste("x".repeat(299))).toBe(false);
    expect(isCollapsiblePaste("x".repeat(300))).toBe(true);
  });

  it("expands every marker and drops a chip whose marker was deleted", () => {
    const chips = [
      { n: 1, text: "one\ntwo" },
      { n: 2, text: "gone" },
    ];
    const input = `look ${pasteMarker(1)} please`;
    expect(liveChips(input, chips)).toEqual([chips[0]]);
    expect(expandPastes(input, chips)).toBe("look one\ntwo please");
  });

  it("labels a chip by its first non-empty line", () => {
    expect(pasteLabel("\n  hello world  \nmore")).toBe("hello world");
  });
});
