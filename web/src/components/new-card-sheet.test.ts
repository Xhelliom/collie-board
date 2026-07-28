import { describe, expect, it } from "vitest";

import { deriveTitle } from "./new-card-sheet";

// The title is derived, not typed — a dictated brain dump has to produce a usable card tile with no
// extra taps, so these are the shapes dictation actually produces.
describe("deriveTitle", () => {
  it("takes the first non-empty line", () => {
    expect(deriveTitle("\n\n  Add a diff view  \nscoped to the branch")).toBe("Add a diff view");
  });

  it("strips list and heading markers", () => {
    expect(deriveTitle("- add a diff view")).toBe("add a diff view");
    expect(deriveTitle("## Add a diff view")).toBe("Add a diff view");
    expect(deriveTitle("> add a diff view")).toBe("add a diff view");
  });

  it("returns empty for a blank dump, so Add stays disabled", () => {
    expect(deriveTitle("")).toBe("");
    expect(deriveTitle("   \n\n  ")).toBe("");
  });

  it("clips a long single-paragraph dump at a word boundary", () => {
    const dump =
      "add a diff view to the card page that is scoped to the card branch and renders stat first";
    const title = deriveTitle(dump, 40);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(41);
    expect(title).not.toMatch(/\s…$/); // no dangling space before the ellipsis
    // Clipped at a space, so the last word is whole.
    expect(dump.startsWith(title.slice(0, -1))).toBe(true);
  });

  it("hard-clips when there is no usable word boundary", () => {
    const title = deriveTitle("a".repeat(200), 20);
    expect(title).toBe(`${"a".repeat(20)}…`);
  });
});
