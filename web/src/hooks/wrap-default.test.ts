import { describe, expect, it } from "vitest";

import { wrapDefaultFor } from "./use-display-prefs";

// Measured on a real herd: panes run a median of 81 columns and a max of 233. A phone shows about
// 50 at 12px monospace, so no-wrap there means most lines run off the edge and reading the mirror
// becomes a horizontal pan — on the one screen this whole app exists for.
describe("wrapDefaultFor", () => {
  it("wraps on a phone", () => {
    expect(wrapDefaultFor(390)).toBe(true); // iPhone 14
    expect(wrapDefaultFor(412)).toBe(true); // Pixel
    expect(wrapDefaultFor(360)).toBe(true);
  });

  it("does NOT wrap on a wide screen — column alignment is what makes a TUI readable there", () => {
    expect(wrapDefaultFor(1024)).toBe(false);
    expect(wrapDefaultFor(1920)).toBe(false);
  });

  it("treats an unknown width as wide, so a headless render keeps upstream's behaviour", () => {
    expect(wrapDefaultFor(0)).toBe(false);
  });

  it("switches at the container width the app already uses", () => {
    expect(wrapDefaultFor(639)).toBe(true);
    expect(wrapDefaultFor(640)).toBe(false);
  });
});
