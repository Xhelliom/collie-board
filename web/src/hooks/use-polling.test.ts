import { act, renderHook } from "@testing-library/react";

import { SUPERSEDE_MS, intervalFor, usePolling } from "./use-polling";
import { isCatchingUp, resetIdleLock, setLocked } from "@/lib/idle";
import type { HomeData } from "@/lib/loaders";
import type { AgentView } from "@/lib/types";

// usePolling reads useRevalidator(); drive its state/revalidate directly (hoisted so the vi.mock
// factory can close over the holder). intervalFor is pure and doesn't touch it.
const rr = vi.hoisted(() => ({ state: "idle" as "idle" | "loading", revalidate: vi.fn() }));
vi.mock("react-router", () => ({
  useRevalidator: () => ({ state: rr.state, revalidate: rr.revalidate }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAgent(paneId: string, status: AgentView["status"]): AgentView {
  return {
    paneId,
    workspaceId: "w1",
    workspaceLabel: "test",
    workspaceNumber: 1,
    tabId: "w1:t1",
    agent: "claude",
    status,
    cwd: "/",
    focused: false,
  };
}

function makeShell(paneId: string): AgentView {
  return {
    paneId,
    workspaceId: "w1",
    workspaceLabel: "test",
    workspaceNumber: 1,
    tabId: "w1:t1",
    agent: "shell",
    status: "unknown",
    cwd: "/",
    focused: false,
    kind: "shell",
  };
}

function makeData(agents: AgentView[], shellPanes: AgentView[] = []): HomeData {
  return {
    bridge: "connected",
    device: undefined,
    agents,
    shellPanes,
    workspaces: [],
    tabs: [],
    sessions: [],
    copilotPaneId: null,
    session: undefined,
    snoozedUntil: null,
    notifyCount: 0,
    update: undefined,
    error: false,
    authError: false,
  };
}

const HOT = 1500;
const COLD = 4000;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("intervalFor", () => {
  it("returns COLD when data is undefined and no pane is open", () => {
    expect(intervalFor(undefined)).toBe(COLD);
  });

  it("returns COLD on home even while an agent works elsewhere", () => {
    const data = makeData([makeAgent("w1:p1", "idle"), makeAgent("w1:p2", "working"), makeAgent("w1:p3", "blocked")]);
    expect(intervalFor(data)).toBe(COLD);
    expect(intervalFor(data, null)).toBe(COLD);
  });

  it("returns COLD on an idle open pane even while another agent works", () => {
    const data = makeData([makeAgent("w1:p1", "idle"), makeAgent("w1:p2", "working")]);
    expect(intervalFor(data, "w1:p1")).toBe(COLD);
  });

  it("returns HOT when the open pane itself is working or blocked", () => {
    const data = makeData([makeAgent("w1:p1", "working"), makeAgent("w1:p2", "blocked")]);
    expect(intervalFor(data, "w1:p1")).toBe(HOT);
    expect(intervalFor(data, "w1:p2")).toBe(HOT);
  });

  it("returns HOT when the open pane is a shell (no status to say it moved)", () => {
    const data = makeData([], [makeShell("w1:s1")]);
    expect(intervalFor(data, "w1:s1")).toBe(HOT);
  });

  it("returns COLD when a paneId is given but it matches no pane", () => {
    const data = makeData([makeAgent("w1:p1", "working")], [makeShell("w1:s1")]);
    expect(intervalFor(data, "w99:phantom")).toBe(COLD);
  });

  it("returns HOT on the project page while one of its lots is launched and not finished", () => {
    const data = makeData([]);
    expect(intervalFor(data, null, [{ launchedAt: 1, finished: false }])).toBe(HOT);
    expect(intervalFor(data, null, [{ launchedAt: null }, { launchedAt: 1, finished: true }])).toBe(COLD);
    expect(intervalFor(data, null, [])).toBe(COLD);
  });
});

// The self-heal: a revalidation wedged in "loading" (a black-holed fetch) would otherwise no-op
// every future tick, since the fast-path only revalidates while idle. Once it has been loading past
// SUPERSEDE_MS, a tick kicks a fresh revalidate() to supersede the hung one.
describe("usePolling — superseding a wedged revalidation", () => {
  const hotData = () => makeData([makeAgent("w1:p1", "working")]); // HOT (open + working) → 1500ms tick interval

  beforeEach(() => {
    vi.useFakeTimers();
    rr.state = "idle";
    rr.revalidate.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT revalidate on a tick before SUPERSEDE_MS has elapsed", () => {
    rr.state = "loading"; // stuck loading from the very first render
    renderHook(() => usePolling(hotData(), "w1:p1"));
    vi.advanceTimersByTime(SUPERSEDE_MS - 1); // several HOT ticks, all still within the grace window
    expect(rr.revalidate).not.toHaveBeenCalled();
  });

  it("DOES revalidate once a load has been stuck past SUPERSEDE_MS", () => {
    rr.state = "loading";
    renderHook(() => usePolling(hotData(), "w1:p1"));
    vi.advanceTimersByTime(SUPERSEDE_MS); // a tick now sees the load has aged past the threshold
    expect(rr.revalidate).toHaveBeenCalled();
  });

  it("still uses the plain idle fast-path when not loading", () => {
    rr.state = "idle";
    renderHook(() => usePolling(hotData(), "w1:p1"));
    vi.advanceTimersByTime(1_500); // one HOT tick
    expect(rr.revalidate).toHaveBeenCalled();
  });

  // The idle lock pauses polling rather than unmounting the route tree, so the tick is the only thing
  // holding the socket off while the cover is up — and releasing it must refetch AT ONCE, since no
  // loader re-runs on its own with the tree still mounted.
  it("does not tick while idle-locked", () => {
    rr.state = "idle";
    setLocked(true);
    try {
      renderHook(() => usePolling(hotData(), "w1:p1"));
      vi.advanceTimersByTime(1_500 * 5); // several HOT intervals behind the cover
      expect(rr.revalidate).not.toHaveBeenCalled();
    } finally {
      resetIdleLock();
    }
  });

  it("revalidates immediately when the lock is released", () => {
    rr.state = "idle";
    setLocked(true);
    try {
      const { rerender } = renderHook(() => usePolling(hotData(), "w1:p1"));
      expect(rr.revalidate).not.toHaveBeenCalled();
      act(() => setLocked(false));
      rerender();
      expect(rr.revalidate).toHaveBeenCalled(); // no waiting out an interval
    } finally {
      resetIdleLock();
    }
  });

  // The cover outlives the lock by exactly one refetch: releasing enters the catch-up beat, and only
  // the revalidator coming to rest ends it. Without this the cover would drop straight back onto the
  // frozen screen it just warned about.
  it("holds the catch-up beat from release until the revalidation settles", () => {
    rr.state = "idle";
    setLocked(true);
    try {
      const { rerender } = renderHook(() => usePolling(hotData(), "w1:p1"));
      act(() => setLocked(false));
      rerender();
      expect(isCatchingUp()).toBe(true);

      rr.state = "loading"; // the refetch is in flight — still covered
      rerender();
      expect(isCatchingUp()).toBe(true);

      rr.state = "idle"; // settled — the cover can go
      rerender();
      expect(isCatchingUp()).toBe(false);
    } finally {
      resetIdleLock();
    }
  });

  // Regression: some phones report navigator.onLine === false even when the network is fine (it stuck
  // false after an airplane-mode toggle). The tick must NOT gate on it — otherwise polling wedges
  // forever and the app can never discover the connection came back. A stuck-false flag still polls.
  it("keeps polling even when navigator.onLine reports false (the flag can lie — never wedge)", () => {
    rr.state = "idle";
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    try {
      renderHook(() => usePolling(hotData(), "w1:p1"));
      vi.advanceTimersByTime(1_500); // one HOT tick with the flag stuck false
      expect(rr.revalidate).toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(navigator, "onLine"); // restore the prototype getter
    }
  });
});
