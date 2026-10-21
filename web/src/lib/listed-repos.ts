import { useEffect, useSyncExternalStore } from "react";

import { apiRequest } from "./api";

// The repos the operator added to the project lists by hand (bridge `/api/repos/listed`). The project
// lists are the repos with cards ∪ these — never every repo the bridge knows (herd, scan): too many.
// One module store for the tabs, the sidebar and the dashboard, so an add shows up in all three.

let paths: string[] = [];
let last = 0;
const listeners = new Set<() => void>();
const publish = (next: string[]) => {
  paths = next;
  for (const fn of listeners) fn();
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Another device's add is a glance away, not a live feed. */
const THROTTLE_MS = 10_000;

function refresh(): void {
  if (Date.now() - last < THROTTLE_MS) return;
  last = Date.now();
  apiRequest<{ paths: string[] }>("/api/repos/listed").then((r) => publish(r.paths), () => {}); // a failed read keeps the last list
}

export function useListedRepos(): string[] {
  useEffect(refresh, []);
  return useSyncExternalStore(subscribe, () => paths);
}

/** Add a repo to the project lists, or take it off. Touches no card. */
export async function setRepoListed(path: string, listed: boolean): Promise<void> {
  const r = await apiRequest<{ paths: string[] }>("/api/repos/listed", {
    method: "POST",
    body: JSON.stringify({ path, listed }),
  });
  publish(r.paths);
}

/** Tests only: the store outlives a render. */
export function __setListedRepos(next: string[]): void {
  last = Date.now();
  publish(next);
}
