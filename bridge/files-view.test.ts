import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canSymlink } from "../scripts/test-env.ts";

import { existingPaths, handleFilesRoute, paneRoot, parseRelPath, resolveInRoot } from "./files-view.ts";

describe("parseRelPath", () => {
  test("accepts a plain relative path", () => {
    expect(parseRelPath("src/a.ts")).toBe("src/a.ts");
    expect(parseRelPath("README.md")).toBe("README.md");
  });
  test.each([
    ["absolute", "/etc/passwd"],
    ["parent", "../x.ts"],
    ["parent inside", "src/../../x.ts"],
    ["dot segment", "./src/a.ts"],
    ["empty segment", "src//a.ts"],
    ["trailing slash", "src/"],
    ["dotfile", ".env"],
    ["dot folder", ".git/config"],
    ["nested dotfile", "a/.ssh/id_rsa"],
    ["backslash", "src\\a.ts"],
    ["colon", "C:/x"],
    ["nul", "a\0.ts"],
    ["empty", ""],
  ])("refuses %s", (_, p) => {
    expect(parseRelPath(p)).toBeNull();
  });
  test("refuses a non-string and an overlong path", () => {
    expect(parseRelPath(42)).toBeNull();
    expect(parseRelPath(null)).toBeNull();
    expect(parseRelPath("a/".repeat(2100) + "b")).toBeNull();
  });
});

describe("on disk", () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "files-view-")));
  const root = join(home, "repo");
  const outside = join(home, "secret.txt");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.ts"), "line1\nline2\n");
  writeFileSync(join(root, ".env"), "TOKEN=x");
  writeFileSync(join(root, "bin.dat"), new Uint8Array([1, 0, 2]));
  writeFileSync(outside, "nope");
  // win32 grants a symlink only in Developer Mode or elevated (EPERM otherwise): the symlink cases
  // skip there (`canSymlink`), the rest of the confinement is still checked.
  if (canSymlink) {
    symlinkSync(outside, join(root, "out.txt"));
    symlinkSync(join(root, ".env"), join(root, "env.txt"));
  }
  afterAll(() => rmSync(home, { recursive: true, force: true }));

  test("paneRoot: a folder below home, never home itself nor outside", async () => {
    expect(await paneRoot(root, home)).toBe(root);
    expect(await paneRoot(home, home)).toBeNull();
    expect(await paneRoot("/", home)).toBeNull();
    expect(await paneRoot(undefined, home)).toBeNull();
  });

  test("resolveInRoot: a file inside, nothing else", async () => {
    expect(await resolveInRoot(root, "src/a.ts")).toBe(join(root, "src", "a.ts"));
    expect(await resolveInRoot(root, "src")).toBeNull(); // a folder
    expect(await resolveInRoot(root, "missing.ts")).toBeNull();
    expect(await resolveInRoot(root, "../secret.txt")).toBeNull();
  });

  test.skipIf(!canSymlink)("resolveInRoot: a symlink never leads out, nor into a dotfile", async () => {
    expect(await resolveInRoot(root, "out.txt")).toBeNull(); // symlink leading out
    expect(await resolveInRoot(root, "env.txt")).toBeNull(); // symlink into a dotfile
  });

  test("existingPaths: the grouped call keeps only what exists inside", async () => {
    expect(await existingPaths(root, ["src/a.ts", "out.txt", "nope.ts", "src/a.ts", 3])).toEqual(["src/a.ts"]);
    expect(await existingPaths(root, "src/a.ts")).toEqual([]);
  });

  const cwdOf = (id: string) => (id === "p1" ? root : id === "home" ? home : undefined);
  const call = (path: string, init?: RequestInit) =>
    handleFilesRoute(new URL(path, "http://x").pathname, new Request(`http://x${path}`, init), cwdOf, home);

  test("route: exists, read, and the same 404 for every refusal", async () => {
    const ex = await call("/api/pane/p1/files/exists", { method: "POST", body: JSON.stringify({ paths: ["src/a.ts", ".env"] }) });
    expect(await ex!.json()).toEqual({ existing: ["src/a.ts"] });
    const ok = await call("/api/pane/p1/file?path=src/a.ts");
    expect(await ok!.text()).toBe("line1\nline2\n");
    for (const bad of ["p1/file?path=../secret.txt", "p1/file?path=out.txt", "p1/file?path=bin.dat", "home/file?path=secret.txt", "zz/file?path=src/a.ts"]) {
      expect((await call(`/api/pane/${bad}`))!.status).toBe(404);
    }
    expect(await call("/api/pane/p1/artifacts")).toBeNull();
  });
});
