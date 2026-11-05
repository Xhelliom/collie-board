import { describe, expect, it } from "vitest";

import {
  DOUBLE_TAP_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  clampScale,
  doubleTapTarget,
  formatScale,
  isDoubleTap,
  pinchMove,
  pinchStart,
  zoomAbout,
} from "./zoom-gesture";

const at1 = { scale: 1, scroll: { x: 0, y: 0 } };

describe("zoom-gesture", () => {
  it("clamps the scale to 1…6, a non-finite one to 1", () => {
    expect(clampScale(0.2)).toBe(MIN_ZOOM);
    expect(clampScale(40)).toBe(MAX_ZOOM);
    expect(clampScale(Number.NaN)).toBe(MIN_ZOOM);
  });

  it("zoomAbout keeps the content under the point where it was", () => {
    const v = zoomAbout(at1, { x: 100, y: 50 }, 2);
    expect(v).toEqual({ scale: 2, scroll: { x: 100, y: 50 } });
    // Same glyph, same screen point: (scroll + at) / scale is unchanged.
    expect((v.scroll.x + 100) / v.scale).toBe(100);
  });

  it("a pinch scales with the spread and pans with the midpoint", () => {
    const start = pinchStart(at1, { x: 100, y: 100 }, { x: 200, y: 100 });
    expect(pinchMove(start, { x: 50, y: 100 }, { x: 250, y: 100 })).toEqual({ scale: 2, scroll: { x: 150, y: 100 } });
    // Both fingers moved 20px right, no spread change: the content follows them.
    expect(pinchMove(start, { x: 120, y: 100 }, { x: 220, y: 100 })).toEqual({ scale: 1, scroll: { x: -20, y: 0 } });
  });

  it("double tap: close in time and space, toggles 1× ⇄ 2.5×", () => {
    const first = { at: 0, point: { x: 10, y: 10 } };
    expect(isDoubleTap(null, first)).toBe(false);
    expect(isDoubleTap(first, { at: 200, point: { x: 20, y: 15 } })).toBe(true);
    expect(isDoubleTap(first, { at: 500, point: { x: 10, y: 10 } })).toBe(false);
    expect(isDoubleTap(first, { at: 100, point: { x: 90, y: 10 } })).toBe(false);
    expect(doubleTapTarget(1)).toBe(DOUBLE_TAP_ZOOM);
    expect(doubleTapTarget(3)).toBe(MIN_ZOOM);
  });

  it("formats the scale with at most one decimal", () => {
    expect(formatScale(1)).toBe("1×");
    expect(formatScale(2.5)).toBe("2.5×");
    expect(formatScale(2.2499)).toBe("2.2×");
  });
});
