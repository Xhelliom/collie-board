import { describe, expect, it, vi } from "vitest";
import type { DataStrategyFunctionArgs, createBrowserRouter } from "react-router";

import { addTickPull, attachTick, runTick, tickDataStrategy } from "./tick";

type Router = ReturnType<typeof createBrowserRouter>;

function fakeRouter(loaders: Record<string, () => unknown>, skip: string[] = []): Router {
  const matches = Object.entries(loaders).map(([id, loader]) => ({
    params: {},
    route: { id, loader, ...(skip.includes(id) ? { shouldRevalidate: () => false } : {}) },
  }));
  return { state: { matches } } as unknown as Router;
}

// What the router hands dataStrategy on a revalidation: every match loads, `resolve` calls the override.
function strategyArgs(url: string, loaders: Record<string, () => unknown>): DataStrategyFunctionArgs {
  const matches = Object.entries(loaders).map(([id, loader]) => ({
    route: { id },
    shouldLoad: true,
    resolve: async (override: (h: () => unknown) => unknown) => ({ type: "data", result: await override(loader) }),
  }));
  return { matches, request: new Request(url) } as unknown as DataStrategyFunctionArgs;
}

describe("runTick + tickDataStrategy", () => {
  it("fetches first, then the revalidation answers from those results without re-running the loaders", async () => {
    const root = vi.fn(() => Promise.resolve("snap"));
    const gallery = vi.fn(() => "never on a poll");
    attachTick(fakeRouter({ root, gallery }, ["gallery"]));
    const order: string[] = [];
    const remove = addTickPull(async () => {
      order.push("pull");
      return () => order.push("show");
    });

    let strategy: Promise<unknown> | undefined;
    await runTick(
      () => {
        order.push("revalidate");
        strategy = tickDataStrategy(strategyArgs(window.location.href, { root }));
      },
      () => true,
    );
    remove();

    expect(await strategy).toEqual({ root: { type: "data", result: "snap" } });
    expect(root).toHaveBeenCalledTimes(1); // the tick's call, not a second one from the revalidation
    expect(gallery).not.toHaveBeenCalled(); // shouldRevalidate: false stays out of the tick
    await Promise.resolve();
    expect(order).toEqual(["pull", "revalidate", "show"]);
  });

  it("a revalidation the tick did not prepare runs its loaders", async () => {
    const root = vi.fn(() => "fresh");
    expect(await tickDataStrategy(strategyArgs(window.location.href, { root }))).toEqual({ root: { type: "data", result: "fresh" } });
    expect(root).toHaveBeenCalledTimes(1);
  });

  it("does not revalidate when a navigation started during the fetch", async () => {
    attachTick(fakeRouter({ root: () => "snap" }));
    const revalidate = vi.fn();
    await runTick(revalidate, () => false);
    expect(revalidate).not.toHaveBeenCalled();
    // …and the prepared results are not handed to the next revalidation either.
    const root = vi.fn(() => "fresh");
    await tickDataStrategy(strategyArgs(window.location.href, { root }));
    expect(root).toHaveBeenCalledTimes(1);
  });
});
