import { useEffect, useSyncExternalStore } from "react";

import { apiRequest } from "./api";
import type { AgentView } from "./types";

// The agent sessions the operator pinned to the quick access (bridge `/api/board/pins`). Stored on the
// bridge, so the phone and the PC share them. One module store for every pin button and list: the
// hook asks again on the caller's tick, throttled — no loop of its own (CLAUDE.md).

export interface Pin {
  session: string;
  name: string;
}

/** herdr's agent session — it survives a reboot, the pane id doesn't. A pane without one can't be pinned. */
export const pinKey = (a: Pick<AgentView, "agentSessionId" | "agentSessionPath">): string | null =>
  a.agentSessionId ?? a.agentSessionPath ?? null;

let pins: Pin[] = [];
let last = 0;
const listeners = new Set<() => void>();
const publish = (next: Pin[]) => {
  pins = next;
  for (const fn of listeners) fn();
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** The root poll ticks every 1.5 s; another device's pin is a glance away, not a live feed. */
const THROTTLE_MS = 10_000;

function refresh(): void {
  if (Date.now() - last < THROTTLE_MS) return;
  last = Date.now();
  apiRequest<{ pins: Pin[] }>("/api/board/pins").then((r) => publish(r.pins), () => {}); // a failed read keeps the last list
}

/** `tick`: anything that changes on the caller's revalidation (the HomeData object), so pins set elsewhere show up. */
export function usePins(tick?: unknown): Pin[] {
  useEffect(refresh, [tick]);
  return useSyncExternalStore(subscribe, () => pins);
}

export async function setPinned(session: string, name: string, pinned: boolean): Promise<void> {
  const r = await apiRequest<{ pins: Pin[] }>("/api/board/pins", {
    method: "POST",
    body: JSON.stringify({ session, name, pinned }),
  });
  publish(r.pins);
}

/** Tests only: the store outlives a render. */
export function __setPins(next: Pin[]): void {
  last = Date.now();
  publish(next);
}
