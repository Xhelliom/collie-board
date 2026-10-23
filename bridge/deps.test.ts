import { expect, test } from "bun:test";
import { join } from "node:path";
import { installDirs } from "./deps.ts";

const files = (...f: string[]) => (p: string) => f.includes(p);

test("installs where a lockfile exists and node_modules does not", () => {
  expect(installDirs(files("bun.lock", join("web", "bun.lock")))).toEqual(["", "web"]);
  expect(installDirs(files("bun.lock", join("web", "bun.lock"), "node_modules"))).toEqual(["web"]);
});

test("no lockfile, nothing to install", () => {
  expect(installDirs(files("package.json"))).toEqual([]);
});
