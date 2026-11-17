import { startTransition } from "react";
import type { DataStrategyFunction, createBrowserRouter } from "react-router";

// One React commit per poll tick (audit P12). A bare revalidate() commits twice — its "loading" state,
// then its data — and every pull riding the tick (the reading view's transcript) once more when its own
// answer lands. So the tick fetches FIRST: it runs the screen's loaders and the pulls, then revalidates,
// and the loaders answer from those results at once. The router's two updates and the pulls' land
// before React renders, in one transition: one commit.
//
// Waiting is capped: past TICK_WAIT_MS the tick revalidates anyway (the loaders join the fetches in
// flight), so a slow bridge shows "loading" as before and the stall signals keep their clock.

type Router = ReturnType<typeof createBrowserRouter>;
/** Fetches, and returns how to show what it fetched — called inside the tick's commit. */
export type Pull = () => Promise<(() => void) | undefined>;

export const TICK_WAIT_MS = 1_000;

const pulls = new Set<Pull>();
let router: Router | undefined;
let running = false;
// The loaders' results for the revalidation the tick is about to start, by route id.
let ready: { url: string; data: Map<string, Promise<unknown>> } | null = null;

export function attachTick(r: Router): void {
  router = r;
}

/** Ride the poll tick: `pull` runs before each revalidation and its result shows in the same commit. */
export function addTickPull(pull: Pull): () => void {
  pulls.add(pull);
  return () => pulls.delete(pull);
}

function urlOf(href: string): string {
  const u = new URL(href);
  return u.pathname + u.search;
}

/**
 * One poll tick. `revalidate` is the router's; `stillIdle` re-checks, after the wait, that no navigation
 * or other revalidation started meanwhile — a revalidate() then would interrupt it.
 */
export async function runTick(revalidate: () => void, stillIdle: () => boolean): Promise<void> {
  if (running) return; // the previous tick is still fetching
  running = true;
  try {
    const data = new Map<string, Promise<unknown>>();
    if (router) {
      const url = new URL(window.location.href);
      const request = new Request(url);
      for (const m of router.state.matches) {
        const route = m.route;
        if (typeof route.loader !== "function") continue;
        const args = { currentUrl: url, nextUrl: url, currentParams: m.params, nextParams: m.params, defaultShouldRevalidate: true };
        if (route.shouldRevalidate && !route.shouldRevalidate(args)) continue;
        // Our loaders read only `request` and `params` (same call as nav-cache's prefetch).
        const run = Promise.resolve((route.loader as (a: { request: Request; params: typeof m.params }) => unknown)({ request, params: m.params }));
        run.catch(() => {}); // the revalidation reports it
        data.set(route.id, run);
      }
    }
    const shows = [...pulls].map((p) => p().catch(() => undefined));
    let waited: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled([...data.values(), ...shows]),
      new Promise((r) => (waited = setTimeout(r, TICK_WAIT_MS))),
    ]);
    clearTimeout(waited);
    if (stillIdle()) {
      ready = { url: urlOf(window.location.href), data };
      revalidate();
    }
    // Resolved pulls show in this same task, so in the revalidation's render; a late one shows alone.
    for (const s of shows) void s.then((show) => show && startTransition(show));
  } finally {
    running = false;
  }
}

/** The router's dataStrategy: a revalidation the tick prepared answers from its results. */
export const tickDataStrategy: DataStrategyFunction = async ({ matches, request }) => {
  const pre = ready && request.method === "GET" && ready.url === urlOf(request.url) ? ready.data : undefined;
  ready = null;
  const toLoad = matches.filter((m) => m.shouldLoad);
  const results = await Promise.all(toLoad.map((m) => m.resolve((handler) => (pre?.get(m.route.id) as ReturnType<typeof handler> | undefined) ?? handler())));
  return Object.fromEntries(results.map((r, i) => [toLoad[i]!.route.id, r]));
};
