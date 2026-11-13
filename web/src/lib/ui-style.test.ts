import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { applyUiStyle, loadUiStyle, saveUiStyle } from "./ui-style";

describe("ui style", () => {
  afterEach(() => {
    localStorage.clear();
    applyUiStyle("semaphore");
  });

  it("defaults to Sémaphore, with no attribute on <html>", () => {
    expect(loadUiStyle()).toBe("semaphore");
    applyUiStyle(loadUiStyle());
    expect(document.documentElement.dataset.style).toBeUndefined();
  });

  it("keeps the classic choice and marks <html> for index.css", () => {
    saveUiStyle("classic");
    expect(loadUiStyle()).toBe("classic");
    expect(document.documentElement.dataset.style).toBe("classic");
    saveUiStyle("semaphore");
    expect(localStorage.getItem("collie:style")).toBeNull();
    expect(document.documentElement.dataset.style).toBeUndefined();
  });
});

// Two styles must not become two interfaces: only the setting and the boot sync may know the style.
it("no component branches on the style", () => {
  const src = resolve(__dirname, "..");
  const allowed = new Set(["lib/ui-style.ts", "hooks/use-theme-sync.ts", "components/theme-control.tsx"]);
  const readers = ["components", "routes", "hooks", "lib"].flatMap((d) =>
    readdirSync(join(src, d))
      .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
      .map((f) => `${d}/${f}`)
      .filter((f) => !allowed.has(f) && /ui-style|dataset\.style|data-style/.test(readFileSync(join(src, f), "utf8"))),
  );
  expect(readers).toEqual([]);
});
