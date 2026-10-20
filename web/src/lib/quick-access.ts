import { useEffect, useRef, useState } from "react";

import { conditionalGet } from "./board";

// The desktop sidebar's quick access (bridge/project-quick.ts), and the project the « Projects » entry
// reopens. The root loader carries no card, so this is ONE request, made when the root poll hands the
// nav a fresh snapshot — no loop of its own (CLAUDE.md: anything periodic hangs off the root's tick).

export interface QuickProject {
  repoPath: string;
  lot: { id: string; name: string | null; done: number; total: number; blocked: boolean; finished: boolean };
  ts: number;
}

export interface QuickAccess {
  projects: QuickProject[];
  waiting: { cardId: string; title: string; repoPath: string; text: string }[];
}

export const fetchQuickAccess = (signal?: AbortSignal): Promise<QuickAccess> => conditionalGet("/api/project/quick", signal);

/** The root poll ticks every 1.5 s; the sidebar is a glance, so it asks at most this often. */
const THROTTLE_MS = 10_000;

/** `tick` changes on every root revalidation (the HomeData object); `enabled` is false where nothing shows it. */
export function useQuickAccess(tick: unknown, enabled: boolean): QuickAccess | null {
  const [q, setQ] = useState<QuickAccess | null>(null);
  const last = useRef(0);
  useEffect(() => {
    if (!enabled || Date.now() - last.current < THROTTLE_MS) return;
    last.current = Date.now();
    fetchQuickAccess().then(setQ, () => {}); // a failed read keeps the last list: the next tick asks again
  }, [tick, enabled]);
  return q;
}

const LAST_PROJECT_KEY = "collie:last-project";

/** The project last opened — what the « Projects » entry reopens. Not the board's repo scope (ADR 0006): reading a project does not rescope the board. */
export function loadLastProject(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY) || null;
  } catch {
    return null;
  }
}

export function saveLastProject(repo: string): void {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, repo);
  } catch {
    // Private mode: the entry falls back to the board's scope.
  }
}
