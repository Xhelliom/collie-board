import type { LoaderFunctionArgs } from "react-router";

import { apiRequest } from "./api";
import { loadRepoScope, type CardView } from "./board";

// The recette (bridge/recette.ts): what the operator tests by hand once cards are delivered. Read
// whole (`all=1`) — the counter needs the OK ones too — and filtered here.

export type CheckStatus = "ok" | "ko" | "skip";
export type RecetteState = "todo" | "ok" | "ko";

export interface RecetteStep {
  id: string;
  text: string;
  expected?: string;
  shot?: string;
  verdict: { status: CheckStatus; by: string; at: number; note?: string } | null;
}

export interface RecetteEntry {
  cardId: string;
  /** What the user can now do — the entry's title. */
  capability: string;
  repoPath: string | null;
  assignee: string | null;
  state: RecetteState;
  /** A KO whose follow-up card is delivered: over, like an OK. */
  followUpDone: boolean;
  /** Image deliverables of the card, newest first. */
  shots: string[];
  deliveredAt: number;
  phase: string | null;
  lot: string | null;
  steps: RecetteStep[];
}

export interface RecetteGroup {
  usage: string | null;
  entries: RecetteEntry[];
}

export const fetchRecette = (repo: string | null, signal?: AbortSignal): Promise<{ groups: RecetteGroup[] }> =>
  apiRequest(`/api/recette?all=1${repo ? `&repo=${encodeURIComponent(repo)}` : ""}`, { signal });

export const postVerdict = (
  cardId: string,
  stepId: string,
  body: { status: CheckStatus; note?: string; followUp?: boolean },
): Promise<{ ok: true; followUp: CardView | null }> =>
  apiRequest(`/api/cards/${encodeURIComponent(cardId)}/checks/${encodeURIComponent(stepId)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export async function recetteLoader({ request }: LoaderFunctionArgs): Promise<{ repo: string | null; groups: RecetteGroup[] }> {
  const repo = new URL(request.url).searchParams.get("repo") ?? loadRepoScope();
  return { repo, groups: (await fetchRecette(repo)).groups };
}

/** Still the operator's to look at: untested, or KO with no delivered fix. Pure. */
export const isPending = (e: RecetteEntry): boolean => e.state === "todo" || (e.state === "ko" && !e.followUpDone);

/** A step with a verdict that needs nothing more — folded away at once. Pure. */
export const stepSettled = (s: RecetteStep): boolean => s.verdict?.status === "ok" || s.verdict?.status === "skip";

export function recetteCounts(entries: readonly RecetteEntry[]): Record<RecetteState, number> {
  const out = { todo: 0, ok: 0, ko: 0 };
  for (const e of entries) out[e.state]++;
  return out;
}

/** Search over what the operator reads: the capability, the capture names and the steps. Pure. */
export function matchesQuery(e: RecetteEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [e.capability, ...e.shots, ...e.steps.flatMap((s) => [s.text, s.expected ?? ""])].some((x) => x.toLowerCase().includes(q));
}

const VISIT_KEY = "collie-board-recette-visit:";

/** When the Recette was last opened for this repo (0: never). */
export function lastVisit(repo: string | null): number {
  try {
    return Number(localStorage.getItem(VISIT_KEY + (repo ?? "")) ?? 0) || 0;
  } catch {
    return 0;
  }
}

export function markVisit(repo: string | null): void {
  try {
    localStorage.setItem(VISIT_KEY + (repo ?? ""), String(Date.now()));
  } catch {
    // private mode: every visit is the first
  }
}
