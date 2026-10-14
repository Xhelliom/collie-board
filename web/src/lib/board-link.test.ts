import { describe, expect, it } from "vitest";

import { parseBoardLink } from "./board-link";

describe("parseBoardLink", () => {
  it("reads a card or a pane, relative or absolute", () => {
    expect(parseBoardLink("/card/abc")).toEqual({ kind: "card", id: "abc", path: "/card/abc" });
    expect(parseBoardLink("https://h.ts.net/pane/1-2/")?.id).toBe("1-2");
  });
  it("leaves every other link alone", () => {
    expect(parseBoardLink("/card/a/b")).toBeNull();
    expect(parseBoardLink("https://github.com/o/r/pull/3")).toBeNull();
    expect(parseBoardLink("/board/project?repo=%2Fx")).toBeNull();
  });
});
