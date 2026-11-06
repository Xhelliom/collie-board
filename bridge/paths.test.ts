import { describe, expect, it } from "bun:test";

import { normalizePath, pathKey, repoPathOf, samePath } from "./paths.ts";

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

describe("repoPathOf", () => {
  it("on win32, takes a drive or UNC path in either spelling and keys it as /api/repos does", () => {
    expect(repoPathOf("C:\\Users\\me\\git\\sw-to-crew", "win32")).toBe("C:\\Users\\me\\git\\sw-to-crew");
    expect(repoPathOf("C:/Users/me/git/sw-to-crew/", "win32")).toBe("C:\\Users\\me\\git\\sw-to-crew");
    expect(repoPathOf("//host/share/repo", "win32")).toBe("\\\\host\\share\\repo");
    expect(repoPathOf("/home/me/repo", "win32")).toBe("/home/me/repo"); // as accepted before, byte for byte
    for (const bad of ["sw-to-crew", "C:repo", "\\x", "", 3, null]) expect(repoPathOf(bad, "win32")).toBeNull();
  });

  it("off win32, absolute is a leading / and the path is kept byte for byte", () => {
    expect(repoPathOf("/home/me/repo/", "linux")).toBe("/home/me/repo/");
    for (const bad of ["C:\\x", "C:/x", "rel", "", undefined]) expect(repoPathOf(bad, "linux")).toBeNull();
  });
});
