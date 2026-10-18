// « Quoi de neuf depuis » — what moved in the orchestrator's repo while it was not looking: the
// operator's gestures (the audit trail, which carries the caller's pane) and the PR facts nobody
// gestured (the journal). Read per turn by a UserPromptSubmit hook or by the agent itself, so no loop
// of ours; the cursor is a ts the CALLER keeps — the notification log's id is not one (it restarts).
// Pure: the route reads the file and the journal, this folds them.

import type { BoardEvent } from "./db.ts";

/** Journal facts that no route gestured, so no audit line will tell of them. */
export const SINCE_EVENT_TYPES = ["card.pr_merged", "card.pr_closed"];

/** Never shown: what the orchestrator does to itself, and the operator's settings around it. */
const SKIP_ACTION = /^orchestrator\./;

/** A turn is not flooded: the newest ones, and a count of the rest. */
const MAX_LINES = 30;

export interface SinceInput {
  /** Raw audit.log lines (any order, partial or foreign lines are dropped). */
  auditLines: string[];
  /** Journal entries of {@link SINCE_EVENT_TYPES} for the repo's cards, newer than `since`. */
  events: BoardEvent[];
  repo: string;
  /** The orchestrator's own pane: its gestures are what it already knows. */
  pane: string;
  since: number;
  /** The repo an audit line touches, from its ids (card, phase, run); null when unknown. */
  repoOf: (detail: Record<string, unknown>) => string | null;
  /** A human label for the line's subject (a card title, a phase name), or null. */
  labelOf: (detail: Record<string, unknown>) => string | null;
}

const NOISE = new Set(["pane", "cardId", "phaseId", "runId", "repoPath", "path", "title", "name"]);

function brief(detail: Record<string, unknown>): string {
  const rest = Object.entries(detail).filter(([k, v]) => !NOISE.has(k) && v !== undefined);
  return rest.length ? ` ${JSON.stringify(Object.fromEntries(rest))}` : "";
}

const hhmm = (ts: number) => new Date(ts).toISOString().slice(11, 16);

/** The changes since `since`, as lines, and the cursor to send next time (the newest ts seen). */
export function sinceChanges(i: SinceInput): { cursor: number; count: number; summary: string } {
  const rows: { ts: number; line: string }[] = [];
  for (const raw of i.auditLines) {
    let a: { ts?: unknown; action?: unknown; detail?: unknown };
    try {
      a = JSON.parse(raw);
    } catch {
      continue;
    }
    const ts = typeof a.ts === "string" ? Date.parse(a.ts) : NaN;
    if (!(ts > i.since) || typeof a.action !== "string" || SKIP_ACTION.test(a.action)) continue;
    const d = (a.detail && typeof a.detail === "object" ? a.detail : {}) as Record<string, unknown>;
    if (d.pane === i.pane) continue;
    const repo = typeof d.repoPath === "string" ? d.repoPath : typeof d.path === "string" ? d.path : i.repoOf(d);
    if (repo !== i.repo) continue;
    const label = (typeof d.title === "string" ? d.title : null) ?? (typeof d.name === "string" ? d.name : null) ?? i.labelOf(d);
    const who = typeof d.pane === "string" ? ` (agent ${d.pane})` : "";
    rows.push({ ts, line: `${hhmm(ts)} ${a.action}${label ? ` « ${label} »` : ""}${brief(d)}${who}` });
  }
  for (const e of i.events) {
    if (!(e.ts > i.since)) continue;
    const label = e.cardId ? i.labelOf({ cardId: e.cardId }) : null;
    rows.push({ ts: e.ts, line: `${hhmm(e.ts)} ${e.type}${label ? ` « ${label} »` : ""}${brief((e.payload ?? {}) as Record<string, unknown>)}` });
  }
  rows.sort((a, b) => a.ts - b.ts);
  const cursor = rows.reduce((m, r) => Math.max(m, r.ts), i.since);
  if (!rows.length) return { cursor, count: 0, summary: "" };
  const shown = rows.slice(-MAX_LINES);
  const head = `Depuis ton dernier tour, sans toi dans ce dépôt (heures UTC)${rows.length > shown.length ? ` — ${rows.length - shown.length} plus anciens omis` : ""} :`;
  return { cursor, count: rows.length, summary: [head, ...shown.map((r) => `- ${r.line}`)].join("\n") };
}
