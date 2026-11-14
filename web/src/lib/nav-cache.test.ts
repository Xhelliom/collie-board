import { describe, expect, it, vi } from "vitest";

import { attachNavCache, navCached } from "./nav-cache";

describe("navCached", () => {
  it("a navigation shows the last data at once, then one revalidation refreshes it; a poll always fetches", async () => {
    const load = vi.fn(async () => load.mock.calls.length);
    // No router attached: a plain fetch every time.
    expect(await navCached("/x", load)).toBe(1);

    let listener: (s: unknown) => void = () => {};
    const router = {
      state: { navigation: { state: "idle" } },
      subscribe: (fn: (s: unknown) => void) => ((listener = fn), () => {}),
      revalidate: vi.fn(),
      routes: [],
    };
    attachNavCache(router as never);

    // A revalidation (navigation idle) fetches and refreshes the entry.
    expect(await navCached("/x", load)).toBe(2);

    // A navigation to a seen screen: no fetch, last data.
    router.state.navigation.state = "loading";
    expect(await navCached("/x", load)).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
    listener({ navigation: { state: "loading" } });
    expect(router.revalidate).not.toHaveBeenCalled();
    listener({ navigation: { state: "idle" } });
    listener({ navigation: { state: "idle" } });
    expect(router.revalidate).toHaveBeenCalledTimes(1);

    // A navigation to an unseen screen joins a load already in flight (a prefetch) instead of starting another.
    router.state.navigation.state = "idle";
    let release!: (v: string) => void;
    const slow = vi.fn(() => new Promise<string>((r) => (release = r)));
    const prefetched = navCached("/y", slow);
    router.state.navigation.state = "loading";
    const nav = navCached("/y", slow);
    release("y");
    expect(await nav).toBe("y");
    expect(await prefetched).toBe("y");
    expect(slow).toHaveBeenCalledTimes(1);

    // The joined load is aborted (its navigation superseded): the joiner loads for itself, never the abort.
    router.state.navigation.state = "idle";
    let abort!: () => void;
    const first = vi.fn(() => new Promise<string>((_, j) => (abort = () => j(new DOMException("x", "AbortError")))));
    const superseded = navCached("/z", first).catch((e: Error) => e.name);
    router.state.navigation.state = "loading";
    const joined = navCached("/z", async () => "z");
    abort();
    expect(await superseded).toBe("AbortError");
    expect(await joined).toBe("z");

    // Any other failure still reaches the joiner (its error page stays).
    router.state.navigation.state = "idle";
    let fail!: () => void;
    const broken = navCached("/w", () => new Promise<string>((_, j) => (fail = () => j(new Error("boom"))))).catch(() => {});
    router.state.navigation.state = "loading";
    const joinedBroken = navCached("/w", async () => "w");
    fail();
    await broken;
    await expect(joinedBroken).rejects.toThrow("boom");
  });
});
