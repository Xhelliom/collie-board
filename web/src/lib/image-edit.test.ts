import { describe, expect, it } from "vitest";

import { cropOf, rectFrom } from "./image-edit";

describe("image-edit geometry", () => {
  it("spans a rectangle from either drag direction, clamped to the image", () => {
    expect(rectFrom({ x: 0.75, y: 0.5 }, { x: 0.25, y: -0.5 })).toEqual({ x: 0.25, y: 0, w: 0.5, h: 0.5 });
  });

  it("takes the last real crop, ignores a tap, and is the whole image without one", () => {
    const big = { kind: "crop" as const, rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } };
    const tap = { kind: "crop" as const, rect: { x: 0.3, y: 0.3, w: 0, h: 0 } };
    expect(cropOf([])).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(cropOf([big, { kind: "pen", points: [] }, tap])).toEqual(big.rect);
  });
});
