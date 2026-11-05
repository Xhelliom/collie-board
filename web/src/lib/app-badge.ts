// The installed app's icon carries how many agents wait on you. Two writers, because neither is
// always awake: the page sets it from its snapshot while open (blocked + finished-unseen panes), the
// service worker sets it on every herd push from the bridge's outstanding count (a clear is 0).
//
// Each session pushes on its own herd tag, and a worker keeps no state between pushes, so the worker
// stores every tag's last count in Cache Storage and shows their sum. Imported by both sides: no
// state, no side effect at load.

import type { AgentView } from "./types";

/** The Badging API's two calls, optional because most browsers have neither. */
export interface BadgeTarget {
  setAppBadge?(count?: number): Promise<void>;
  clearAppBadge?(): Promise<void>;
}

/** Show `count` on the icon, or nothing at zero. A browser that refuses is not an error. */
export async function showBadge(target: BadgeTarget | undefined, count: number): Promise<void> {
  try {
    if (count > 0) await target?.setAppBadge?.(count);
    else await target?.clearAppBadge?.();
  } catch {
    // Not installed, or no permission: the icon simply keeps no count.
  }
}

/** The page's count: panes blocked on you, plus finished ones you haven't opened (herdr's `done`). */
export function waitingCount(agents: AgentView[]): number {
  return agents.filter((a) => a.kind !== "shell" && (a.status === "blocked" || a.status === "done")).length;
}

/** What a push says about its tag's count, or `undefined` when it says nothing (another kind of
 *  push, or a bridge that predates the field — which must not zero the tag). */
export function slotCount(push: { type?: string; tag?: unknown; badge?: unknown }): number | undefined {
  if (typeof push.tag !== "string" || !push.tag.startsWith("collie:herd")) return undefined;
  if (push.type === "clear") return 0;
  const n = push.badge;
  return push.type === undefined && typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : undefined;
}

export type BadgeSlots = Record<string, number>;

/** The slots with one tag's count replaced; a zero tag is dropped. */
export function withSlot(slots: BadgeSlots, tag: string, count: number): BadgeSlots {
  const { [tag]: _replaced, ...rest } = slots;
  return count > 0 ? { ...rest, [tag]: count } : rest;
}

/** The one slice of Cache Storage this needs, so a test can fake it. */
export interface BadgeCaches {
  open(cacheName: string): Promise<Pick<Cache, "match" | "put">>;
}

const CACHE = "collie-badge";

/** Store one tag's new count and answer the sum over every tag. */
export async function recordSlot(caches: BadgeCaches, origin: string, tag: string, count: number): Promise<number> {
  const cache = await caches.open(CACHE);
  const key = `${origin}/badge.json`;
  let stored: BadgeSlots = {};
  try {
    const hit = await cache.match(key);
    if (hit) stored = (await hit.json()) as BadgeSlots;
  } catch {
    // A corrupt entry is rewritten below.
  }
  const slots = withSlot(typeof stored === "object" && stored !== null ? stored : {}, tag, count);
  await cache.put(key, new Response(JSON.stringify(slots), { headers: { "content-type": "application/json" } }));
  return Object.values(slots).reduce((sum, n) => sum + (Number.isInteger(n) && n > 0 ? n : 0), 0);
}
