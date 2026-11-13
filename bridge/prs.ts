// Open PRs — the pull requests still open, cards' and the board's own off-card ones (`docs(plan)`).
//
// Without `check`, the journal alone: `card.pr_opened` puts a card on it, `card.pr_merged` /
// `card.pr_closed` take it off — one query, never leaves the machine (the dashboard's count, the MCP).
// With `check` — the screen's open, and its « Re-read » tap — GitHub is read: one `gh pr list` per
// repo, which is the truth (ADR 0014: a read on a gesture, never a timer). A journal row GitHub no
// longer lists open is asked about by itself and what it became is written back, which is how a row
// leaves. Two reads closer than MIN_READ_MS share the first: tapping twice does not ask twice.

import type { BoardDb, BoardEvent, Card } from "./db.ts";
import { boardBranchPrefix } from "./config.ts";
import { closePr, enableAutoMerge, listPrs, prStatusOf, type GhPr, type GitRunner, type PrStatus } from "./git.ts";
import { rollingPlanPr } from "./plan-export.ts";
import { notePrOutcome, prStatusFor } from "./integrate.ts";

export { notePrOutcome };

const OVER = new Set(["card.pr_merged", "card.pr_closed"]);

/** card id → the PR it still has open, folded from the journal oldest first. Pure + exported. */
export function openPrsOf(
  events: readonly BoardEvent[],
): Map<string, { url: string | null; ts: number; autoMerge?: "armed" | "refused" }> {
  const open = new Map<string, { url: string | null; ts: number; autoMerge?: "armed" | "refused" }>();
  for (const e of events) {
    if (!e.cardId) continue;
    if (e.type === "card.pr_opened") {
      open.set(e.cardId, { url: (e.payload as { url?: string | null } | null)?.url ?? null, ts: e.ts });
    } else if (e.type === "card.pr_updated" && !open.has(e.cardId)) {
      // A PR the agent opened itself (`gh pr create`): the board's first word on it is `pr_updated`.
      open.set(e.cardId, { url: (e.payload as { url?: string | null } | null)?.url ?? null, ts: e.ts });
    } else if (OVER.has(e.type)) {
      open.delete(e.cardId);
    } else if (e.type === "card.automerge_armed" || e.type === "card.automerge_refused") {
      const row = open.get(e.cardId);
      if (row) row.autoMerge = e.type === "card.automerge_armed" ? "armed" : "refused";
    }
  }
  return open;
}

export interface OpenPr {
  card: Pick<Card, "id" | "title" | "status" | "repoPath" | "branch">;
  url: string | null;
  openedAt: number;
  /** Only on a check: what GitHub said, null when it could not be asked. */
  pr?: PrStatus | null;
  /** What GitHub said when the run asked it to merge this PR by itself (ADR 0017). Absent: nobody asked. */
  autoMerge?: "armed" | "refused";
  /** Only on a check: the row as `gh pr list` saw it open — absent once it is over. */
  github?: GhPr;
}

/** A PR GitHub lists that is on no card. `plan`: the board's own lot-end export. */
export type LoosePr = GhPr & { repoPath: string; origin: "plan" | "other"; /** Plan PR superseded by the rolling one (#N): the operator closes it, never the board. */ replacedBy?: number };

export interface PrsReading {
  prs: OpenPr[];
  /** Only on a check: open PRs on no card. */
  others?: LoosePr[];
  /** Only on a check: each repo's 10 newest merged, newest first — the screen keeps 10 of its scope. */
  merged?: (GhPr & { repoPath: string; cardId: string | null })[];
  /** Only on a check: when GitHub was read. */
  checkedAt?: number;
}

/** The floor between two GitHub reads: a double tap, or a screen reopened, shares the last one. */
export const MIN_READ_MS = 15_000;
let lastRead: { at: number; value: PrsReading } | null = null;
/** A gesture (merge, close) changed GitHub: the next read must not be the cached one. */
export function forgetPrRead(): void {
  lastRead = null;
}

/** The list, newest PR first. `check` reads GitHub (see the header). */
export async function openPrs(db: BoardDb, check = false, gh?: GitRunner, now: () => number = Date.now): Promise<PrsReading> {
  if (check && lastRead && now() - lastRead.at < MIN_READ_MS) return lastRead.value;
  const rows: { row: OpenPr; card: Card }[] = [];
  for (const [id, { url, ts, autoMerge }] of openPrsOf(db.listPrEvents())) {
    const card = db.getCard(id);
    if (!card) continue;
    rows.push({ card, row: { card: pick(card), url, openedAt: ts, ...(autoMerge ? { autoMerge } : {}) } });
  }
  if (!check) return { prs: sortRows(rows) };

  const cards = db.listCards({ includeArchived: true });
  const repos = [...reposOf(db)];
  const byBranch = new Map(cards.filter((c) => c.repoPath && c.branch).map((c) => [`${c.repoPath}\0${c.branch}`, c]));
  const read = await Promise.all(repos.map(async (repoPath) => ({ repoPath, open: await listPrs(repoPath, "open", gh), merged: await listPrs(repoPath, "merged", gh) })));

  const others: LoosePr[] = [];
  const merged: NonNullable<PrsReading["merged"]> = [];
  const seen = new Set<string>();
  for (const { repoPath, open, merged: m } of read) {
    for (const pr of open ?? []) {
      // By url first: a lot's cards share the lot branch's PR, which is on none of their own branches.
      const journaled = rows.filter((r) => r.row.url === pr.url);
      for (const r of journaled) {
        r.row.github = pr;
        seen.add(r.card.id);
      }
      if (journaled.length) continue;
      const card = byBranch.get(`${repoPath}\0${pr.branch}`);
      if (!card) {
        others.push({ ...pr, repoPath, origin: pr.branch.startsWith(`${boardBranchPrefix()}plan-`) ? "plan" : "other" });
        continue;
      }
      seen.add(card.id);
      const row = rows.find((r) => r.card.id === card.id);
      // Open on GitHub but unknown to the journal (an agent's own `gh pr create`): it is on the list.
      if (row) row.row.github = pr;
      else rows.push({ card, row: { card: pick(card), url: pr.url, openedAt: pr.createdAt ?? now(), github: pr } });
    }
    for (const pr of m ?? []) merged.push({ ...pr, repoPath, cardId: rows.find((r) => r.row.url === pr.url)?.card.id ?? byBranch.get(`${repoPath}\0${pr.branch}`)?.id ?? null });
  }
  // A journal row GitHub no longer lists open — or whose repo could not be listed: asked by itself,
  // and journaled if it is over, which is how it leaves.
  await Promise.all(
    rows
      .filter(({ card }) => !seen.has(card.id))
      .map(async ({ row, card }) => {
        // The journaled url names the PR exactly — a lot card's PR is not on the card's branch.
        const n = /\/pull\/(\d+)$/.exec(row.url ?? "")?.[1];
        row.pr = n && card.repoPath ? await prStatusOf(card.repoPath, n, gh) : await prStatusFor(card, now, true, gh);
        notePrOutcome(db, card.id, row.pr);
      }),
  );
  for (const { row } of rows) {
    if (row.github) row.pr = { state: "open", url: row.github.url, mergedAt: null, conflicting: row.github.conflicting, mergeable: row.github.mergeable, createdAt: row.github.createdAt };
  }
  for (const o of others) {
    const roll = o.origin === "plan" ? rollingPlanPr(others.filter((x) => x.repoPath === o.repoPath && x.origin === "plan")) : null;
    if (roll && roll.number !== o.number) o.replacedBy = roll.number;
  }
  merged.sort((a, b) => (b.mergedAt ?? 0) - (a.mergedAt ?? 0));
  const value: PrsReading = {
    prs: sortRows(rows),
    others: others.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
    merged,
    checkedAt: now(),
  };
  lastRead = { at: now(), value };
  return value;
}

const pick = ({ id, title, status, repoPath, branch }: Card): OpenPr["card"] => ({ id, title, status, repoPath, branch });
const sortRows = (rows: { row: OpenPr }[]) => rows.map((r) => r.row).sort((a, b) => b.openedAt - a.openedAt);

/** The repos the screen reads: every card's, and the ones added by hand, less the hidden ones. */
export function reposOf(db: BoardDb): Set<string> {
  const hidden = db.hiddenRepos();
  const all = [...db.listCards({ includeArchived: true }).map((c) => c.repoPath), ...db.listedRepos()];
  return new Set(all.filter((p): p is string => !!p && !hidden.has(p)));
}

/**
 * The operator's Merge / Close tap on a PR, by number — the only way to land or drop one that is on
 * no card. A card's PR merges through its card (`integration` merge), which journals the landing.
 * Merges now (no `--auto`): the operator chose it, as on the card. The repo must be one the board reads.
 */
export async function prGesture(
  db: BoardDb,
  repoPath: string,
  number: number,
  what: "merge" | "close",
  gh?: GitRunner,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!reposOf(db).has(repoPath)) return { ok: false, status: 404, error: "unknown repo" };
  if (!Number.isSafeInteger(number) || number <= 0) return { ok: false, status: 400, error: "bad PR number" };
  const r = what === "merge" ? await enableAutoMerge(repoPath, String(number), gh, []) : await closePr(repoPath, String(number), gh);
  forgetPrRead();
  return r.ok ? r : { ok: false, status: 409, error: r.error };
}
