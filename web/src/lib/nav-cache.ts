// Stale-while-revalidate for a NAVIGATION: a screen already seen renders at once from what it last
// showed, and one revalidation runs as soon as it is on screen. A poll (a revalidation) always really
// fetches and refreshes the entry. No timer: the refresh hangs off the router's own state.
//
// Navigation vs revalidation is read from the router: during a navigation `state.navigation` is
// "loading"; a revalidation leaves it "idle". That holds for a back/forward (POP) too, where the URL
// has already changed. Without an attached router (tests), every run is a plain fetch.

import { matchRoutes, type Params, type createBrowserRouter } from "react-router";

type Router = ReturnType<typeof createBrowserRouter>;

// ponytail: FIFO over the 20 last screens; the full card list is one shared reference, so an entry is cheap.
const MAX_ENTRIES = 20;
const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();
let router: Router | undefined;
let staleShown = false;

function remember(key: string, data: unknown): void {
  cache.delete(key);
  cache.set(key, data);
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
}

/** A navigation to `key` returns its last data at once (or joins a prefetch in flight); anything else runs `load`. */
export async function navCached<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (router?.state.navigation.state === "loading") {
    if (cache.has(key)) {
      staleShown = true;
      return cache.get(key) as T;
    }
    const pending = inflight.get(key);
    if (pending) return pending as Promise<T>;
  }
  const run = load();
  inflight.set(key, run);
  try {
    const data = await run;
    remember(key, data);
    return data;
  } finally {
    if (inflight.get(key) === run) inflight.delete(key);
  }
}

/** The key a loader caches its screen under: the URL, so `?repo=` and the card id each get their own. */
export function urlKey(request?: Request): string {
  if (!request) return "";
  const u = new URL(request.url);
  return u.pathname + u.search;
}

/** Warm the cache for a link before it is followed. Only the leaf's loader: the root's snapshot is already cached. */
export function prefetch(href: string): void {
  if (!router) return;
  const request = new Request(new URL(href, window.location.origin));
  const key = urlKey(request);
  if (cache.has(key) || inflight.has(key)) return;
  const leaf = matchRoutes(router.routes, href)?.at(-1);
  if (!leaf || typeof leaf.route.loader !== "function") return;
  // Our loaders read only `request` and `params`.
  const run = leaf.route.loader as (args: { request: Request; params: Params }) => unknown;
  Promise.resolve(run({ request, params: leaf.params })).catch(() => {});
}

// Links whose screen is worth warming on a touch or a hover: a project, a card.
const PREFETCHED = /^\/(board\/project\?|card\/)/;

function onPointer(e: Event): void {
  const a = (e.target as Element | null)?.closest?.("a[href]");
  const href = a?.getAttribute("href");
  if (href && PREFETCHED.test(href)) prefetch(href);
}

export function attachNavCache(r: Router): void {
  router = r;
  r.subscribe((state) => {
    if (!staleShown || state.navigation.state !== "idle") return;
    staleShown = false;
    r.revalidate();
  });
  document.addEventListener("pointerover", onPointer, { passive: true });
  document.addEventListener("pointerdown", onPointer, { passive: true });
}
