import { renderHook, act } from "@testing-library/react";

import { usePendingConfirm } from "./use-pending-confirm";

// The shared two-tap-confirm engine behind every destructive action (Kill, /clear, Ctrl-D). The
// arm→fire path is exercised through components, but the timeout and the "arm A then tap B" reset
// are only pinned here.
describe("usePendingConfirm", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("arms on the first confirm and fires on the second", () => {
    const { result } = renderHook(() => usePendingConfirm());

    let first: boolean | undefined;
    act(() => {
      first = result.current.confirm("kill");
    });
    expect(first).toBe(false);
    expect(result.current.pending).toBe("kill");

    let second: boolean | undefined;
    act(() => {
      second = result.current.confirm("kill");
    });
    expect(second).toBe(true);
    expect(result.current.pending).toBeNull();
  });

  it("auto-disarms after the timeout", () => {
    const { result } = renderHook(() => usePendingConfirm(3000));
    act(() => {
      result.current.confirm("kill");
    });
    expect(result.current.pending).toBe("kill");
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.pending).toBeNull();
  });

  it("arming a different id replaces the pending one (no stale confirm carries over)", () => {
    const { result } = renderHook(() => usePendingConfirm());
    act(() => {
      result.current.confirm("a");
    });
    expect(result.current.pending).toBe("a");

    let bConfirmed: boolean | undefined;
    act(() => {
      bConfirmed = result.current.confirm("b");
    });
    expect(bConfirmed).toBe(false); // b arms fresh, does not fire
    expect(result.current.pending).toBe("b");
  });

  // jsdom has no navigator.vibrate — the arm path must survive that (iOS Safari is the real case).
  it("buzzes on arming where the Vibration API exists, and not where it doesn't", () => {
    const { result } = renderHook(() => usePendingConfirm());
    expect(() => act(() => void result.current.confirm("kill"))).not.toThrow();

    const vibrate = vi.fn();
    // Spreading `navigator` would yield {} — its properties live on the prototype — so stub the one
    // member the hook touches rather than pretending to clone the real thing.
    vi.stubGlobal("navigator", { vibrate });
    act(() => {
      result.current.confirm("other"); // arms (different id) → buzz
    });
    expect(vibrate).toHaveBeenCalledWith(10);
    act(() => {
      result.current.confirm("other"); // confirming tap → no buzz
    });
    expect(vibrate).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("reset() disarms immediately", () => {
    const { result } = renderHook(() => usePendingConfirm());
    act(() => {
      result.current.confirm("kill");
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.pending).toBeNull();
  });
});
