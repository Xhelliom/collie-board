import { renderHook, act } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useDisplayPrefs } from "./use-display-prefs";

// Measured on a real herd: panes run a median of 81 columns and a max of 233. A phone shows about
// 50 at 12px monospace, so no-wrap there means most lines run off the edge and reading the mirror
// becomes a horizontal pan — on the one screen this whole app exists for.
//
// The default is READ THROUGH `useMediaQuery` now, so the same test covers both halves: the 640px
// threshold, and the fact that dragging the window across it re-decides.

const realMatchMedia = window.matchMedia;
const STORAGE_KEY = "collie:display-prefs:v3";

/** A matchMedia whose `(width < Npx)` answers follow a width the test can move. */
function viewport(initial: number) {
  const listeners = new Set<() => void>();
  let width = initial;
  window.matchMedia = ((query: string) => ({
    get matches() {
      return width < Number(/\d+/.exec(query)![0]);
    },
    media: query,
    addEventListener: (_: string, cb: () => void) => void listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => void listeners.delete(cb),
  })) as unknown as typeof window.matchMedia;
  return (next: number) => {
    width = next;
    act(() => listeners.forEach((cb) => cb()));
  };
}

const wrapAt = (width: number) => {
  viewport(width);
  return renderHook(() => useDisplayPrefs()).result.current.prefs.wrap;
};

afterEach(() => {
  window.matchMedia = realMatchMedia;
  localStorage.clear();
});

describe("the wrap default", () => {
  it("wraps on a phone", () => {
    expect(wrapAt(390)).toBe(true); // iPhone 14
    expect(wrapAt(412)).toBe(true); // Pixel
    expect(wrapAt(360)).toBe(true);
  });

  it("does NOT wrap on a wide screen — column alignment is what makes a TUI readable there", () => {
    expect(wrapAt(1024)).toBe(false);
    expect(wrapAt(1920)).toBe(false);
  });

  it("switches at the container width the app already uses", () => {
    expect(wrapAt(639)).toBe(true);
    expect(wrapAt(640)).toBe(false);
  });

  it("treats a viewport-less render as wide, so a headless render keeps upstream's behaviour", () => {
    // @ts-expect-error — the SSR/jsdom shape the hook guards for.
    window.matchMedia = undefined;
    expect(renderHook(() => useDisplayPrefs()).result.current.prefs.wrap).toBe(false);
  });

  it("re-decides when the window is resized across the threshold", () => {
    const resize = viewport(1440);
    const { result } = renderHook(() => useDisplayPrefs());
    expect(result.current.prefs.wrap).toBe(false);
    resize(500); // window dragged narrow — or the laptop unplugged from the external display
    expect(result.current.prefs.wrap).toBe(true);
    resize(1440);
    expect(result.current.prefs.wrap).toBe(false);
  });

  it("stops following the viewport once the user has picked — the stored choice wins forever", () => {
    const resize = viewport(1440);
    const { result } = renderHook(() => useDisplayPrefs());
    act(() => result.current.setWrap(false));
    resize(390);
    expect(result.current.prefs.wrap).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).wrap).toBe(false);
  });
});
