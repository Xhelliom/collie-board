import { describe, expect, it } from "bun:test";

import { normalizePath, pathKey, samePath } from "./paths.ts";

describe("paths", () => {
  it("on win32, spells a Git for Windows path with \\ and compares without case", () => {
    expect(normalizePath("C:/Users/me/repo/", "win32")).toBe("C:\\Users\\me\\repo");
    expect(samePath("C:/x", "C:\\X", "win32")).toBe(true);
    expect(samePath("C:/x", "C:\\y", "win32")).toBe(false);
    expect(pathKey("C:/Users/Me", "win32")).toBe("c:\\users\\me");
  });

  it("is the identity off win32 — Linux paths stay byte for byte, and case still counts", () => {
    for (const p of ["/home/me/repo", "/home/me/repo/", "", "rel/x"]) {
      expect(normalizePath(p, "linux")).toBe(p);
      expect(pathKey(p, "linux")).toBe(p);
    }
    expect(samePath("/r/a", "/r/A", "linux")).toBe(false);
  });
});
