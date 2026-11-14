// The sheet of one open PR — everything the operator reads before merging, without leaving Collie.
// Read-only (panes may ask too). `gh` runs through git.ts, the only place we shell out: the number is
// validated here as a plain integer and the repo must be one the board reads, or nothing is spawned.

import type { BoardDb } from "./db.ts";
import { prDiffText, prViewRaw, rerunFailed, type GitRunner } from "./git.ts";
import { openPrsOf, reposOf } from "./prs.ts";

export interface PrCheck {
  name: string;
  state: "success" | "failure" | "pending" | "skipped" | "cancelled";
  startedAt: number | null;
  completedAt: number | null;
  url: string;
  runId: string | null;
}

export interface PrDetail {
  number: number;
  title: string;
  body: string;
  author: string;
  createdAt: number | null;
  updatedAt: number | null;
  base: string;
  head: string;
  state: "open" | "merged" | "closed";
  mergeable: boolean;
  conflicting: boolean;
  isDraft: boolean;
  url: string;
  card: { id: string; title: string } | null;
  files: { path: string; additions: number; deletions: number }[];
  checks: PrCheck[];
  diff: string;
  diffTruncated: boolean;
}

/** A plain positive integer, nothing else — it ends up in an argv. Pure + exported. */
export function parsePrNumber(raw: string): number | null {
  return /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null;
}

/** One `statusCheckRollup` array as rows: a CheckRun has status/conclusion, a commit StatusContext has state. Pure + exported. */
export function parseCheckRows(rollup: unknown): PrCheck[] {
  if (!Array.isArray(rollup)) return [];
  const date = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) && !v.startsWith("0001") ? Date.parse(v) : null);
  return (rollup as Record<string, unknown>[]).flatMap((c) => {
    if (!c || typeof c !== "object") return [];
    let state: PrCheck["state"];
    if (typeof c.status === "string") {
      const done = c.status === "COMPLETED";
      const k = String(c.conclusion ?? "");
      state = !done ? "pending" : k === "SUCCESS" || k === "NEUTRAL" ? "success" : k === "SKIPPED" ? "skipped" : k === "CANCELLED" ? "cancelled" : "failure";
    } else {
      const k = String(c.state ?? "");
      state = k === "SUCCESS" ? "success" : k === "PENDING" || k === "EXPECTED" ? "pending" : "failure";
    }
    const url = String(c.detailsUrl ?? c.targetUrl ?? "");
    return [
      {
        name: String(c.name ?? c.context ?? "(unnamed check)"),
        state,
        startedAt: date(c.startedAt),
        completedAt: date(c.completedAt),
        url,
        runId: /\/actions\/runs\/(\d+)/.exec(url)?.[1] ?? null,
      },
    ];
  });
}

/** Shape `gh pr view --json …`; null when it is not a PR. The card and the diff are added by the caller. Pure + exported. */
export function parsePrDetail(stdout: string): Omit<PrDetail, "card" | "diff" | "diffTruncated"> | null {
  let r: Record<string, unknown>;
  try {
    r = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!r || typeof r.number !== "number" || typeof r.url !== "string") return null;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const date = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null);
  const state = r.state === "MERGED" ? "merged" : r.state === "CLOSED" ? "closed" : "open";
  const files = Array.isArray(r.files)
    ? (r.files as Record<string, unknown>[]).flatMap((f) =>
        typeof f?.path === "string" ? [{ path: f.path, additions: Number(f.additions) || 0, deletions: Number(f.deletions) || 0 }] : [],
      )
    : [];
  return {
    number: r.number,
    title: str(r.title),
    body: str(r.body),
    author: str((r.author as { login?: unknown } | null)?.login),
    createdAt: date(r.createdAt),
    updatedAt: date(r.updatedAt),
    base: str(r.baseRefName),
    head: str(r.headRefName),
    state,
    mergeable: r.mergeable === "MERGEABLE",
    conflicting: r.mergeable === "CONFLICTING",
    isDraft: r.isDraft === true,
    url: r.url,
    files,
    checks: parseCheckRows(r.statusCheckRollup),
  };
}

export async function prDetail(
  db: BoardDb,
  repoPath: string,
  rawNumber: string,
  gh?: GitRunner,
): Promise<{ ok: true; detail: PrDetail } | { ok: false; status: number; error: string }> {
  if (!reposOf(db).has(repoPath)) return { ok: false, status: 403, error: "unknown repo" };
  const number = parsePrNumber(rawNumber);
  if (!number) return { ok: false, status: 400, error: "bad PR number" };
  const [view, diff] = await Promise.all([prViewRaw(repoPath, number, gh), prDiffText(repoPath, number, gh)]);
  const d = view ? parsePrDetail(view) : null;
  if (!d) return { ok: false, status: 404, error: "PR not readable on GitHub" };
  // The card that carries it: by the journaled url first (a lot's cards share one PR), then by branch.
  const journaled = [...openPrsOf(db.listPrEvents())].find(([, v]) => v.url === d.url)?.[0];
  const card = (journaled && db.getCard(journaled)) || db.listCards({ includeArchived: true }).find((c) => c.repoPath === repoPath && c.branch === d.head);
  return {
    ok: true,
    detail: { ...d, card: card ? { id: card.id, title: card.title } : null, diff: diff?.diff ?? "", diffTruncated: diff?.truncated ?? false },
  };
}

/** The operator re-runs the failed jobs of one run: the repo must be one the board reads, ids are digits. The route refuses panes. */
export async function prRerun(
  db: BoardDb,
  repoPath: string,
  rawNumber: string,
  runId: unknown,
  gh?: GitRunner,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!reposOf(db).has(repoPath)) return { ok: false, status: 403, error: "unknown repo" };
  if (!parsePrNumber(rawNumber)) return { ok: false, status: 400, error: "bad PR number" };
  if (typeof runId !== "string" || !/^\d{1,15}$/.test(runId)) return { ok: false, status: 400, error: "bad run id" };
  const r = await rerunFailed(repoPath, runId, gh);
  return r.ok ? r : { ok: false, status: 409, error: r.error };
}
