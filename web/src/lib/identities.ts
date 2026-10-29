import { useSyncExternalStore } from "react";

import type { CardView } from "./board";

// Who is who on a shared board (ADR 0048 §5): per shared repo, this pair's git identity and every
// identity the repo knows. Rides `/api/cards` — whichever fetch read it last publishes it here, so the
// tile, the card page and the editor agree without a request of their own. Unshared repos are absent:
// that absence is what keeps all of this off a board nobody else sees.

export interface RepoIdentities {
  me: string | null;
  people: string[];
}

let current: Record<string, RepoIdentities> = {};
let key = "{}";
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function publishIdentities(next: Record<string, RepoIdentities> | undefined): void {
  const k = JSON.stringify(next ?? {});
  if (k === key) return; // every poll brings it back: same content, same reference, no re-render
  key = k;
  current = next ?? {};
  for (const fn of listeners) fn();
}

export function useIdentities(): Record<string, RepoIdentities> {
  return useSyncExternalStore(subscribe, () => current);
}

/** A repo's identities, or undefined when it is not shared. */
export function useRepoIdentities(repo: string | null | undefined): RepoIdentities | undefined {
  const all = useIdentities();
  return repo ? all[repo] : undefined;
}

/** What a screen calls someone: « me » for this pair, else the email's local part. */
export function personName(email: string, me: string | null, meLabel: string): string {
  return email === me ? meLabel : email.split("@")[0] || email;
}

/** « À moi »: a shared repo's card assigned to this pair. An unshared repo's card is everyone's — kept. */
export function assignedToMe(card: Pick<CardView, "repoPath" | "assignee">, ids: Record<string, RepoIdentities>): boolean {
  const repo = card.repoPath ? ids[card.repoPath] : undefined;
  return !repo || (repo.me !== null && card.assignee === repo.me);
}
