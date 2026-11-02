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
  // The thread back to the delivery (optional: an older bridge does not send them).
  phaseId?: string | null;
  runId?: string | null;
  /** The card's PR, or its lot's for a one-PR lot. */
  prUrl?: string | null;
  /** The repo's name — only when the view spans every repo. */
  project?: string | null;
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

export interface DeliveryLot {
  runId: string | null;
  lot: string | null;
  /** The PR every entry of the lot shares (a one-PR lot), else null. */
  prUrl: string | null;
  /** Its latest delivery. */
  at: number;
  entries: RecetteEntry[];
}

export interface DeliveryPhase {
  phase: string | null;
  at: number;
  lots: DeliveryLot[];
}

/** « By delivery »: phases, then lots, then entries, each ordered by its latest merge, newest first. Pure. */
export function byDelivery(entries: readonly RecetteEntry[]): DeliveryPhase[] {
  const phases = new Map<string, DeliveryPhase & { byLot: Map<string, DeliveryLot> }>();
  for (const e of [...entries].sort((a, b) => b.deliveredAt - a.deliveredAt)) {
    const pk = e.phaseId ?? e.phase ?? "";
    let p = phases.get(pk);
    if (!p) phases.set(pk, (p = { phase: e.phase, at: e.deliveredAt, lots: [], byLot: new Map() }));
    const lk = e.runId ?? e.lot ?? "";
    let l = p.byLot.get(lk);
    if (!l) {
      p.byLot.set(lk, (l = { runId: e.runId ?? null, lot: e.lot, prUrl: null, at: e.deliveredAt, entries: [] }));
      p.lots.push(l);
    }
    l.entries.push(e);
  }
  return [...phases.values()].map(({ byLot: _, ...p }) => ({
    ...p,
    lots: p.lots.map((l) => {
      const pr = l.entries[0]!.prUrl ?? null;
      return { ...l, prUrl: l.lot && l.entries.every((e) => (e.prUrl ?? null) === pr) ? pr : null };
    }),
  }));
}

/** « PR #12 » off a GitHub pull URL, « PR » otherwise. Pure. */
export function prLabel(url: string): string {
  const n = /\/pull\/(\d+)/.exec(url)?.[1];
  return n ? `PR #${n}` : "PR";
}

export type Grouping = "usage" | "delivery";
const GROUPING_KEY = "collie-board-recette-grouping";

export function loadGrouping(): Grouping {
  try {
    return localStorage.getItem(GROUPING_KEY) === "delivery" ? "delivery" : "usage";
  } catch {
    return "usage";
  }
}

export function saveGrouping(g: Grouping): void {
  try {
    localStorage.setItem(GROUPING_KEY, g);
  } catch {
    // private mode: the choice lasts the visit
  }
}
