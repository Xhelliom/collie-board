// Open PRs — every card whose journal says it opened a pull request nobody has seen land yet.
//
// The journal IS the list: `card.pr_opened` puts a card on it, `card.pr_merged` / `card.pr_closed`
// take it off. Reading it is one query and never leaves the machine. GitHub is asked only on the
// Check tap — and by a card screen reading its own PR — and what it says about a PR that is over is
// written back, which is how a row leaves. No timer: watching GitHub is what ADR 0014 rules out.

import type { BoardDb, BoardEvent, Card } from "./db.ts";
import type { PrStatus } from "./git.ts";
import { prStatusFor } from "./integrate.ts";

const OVER = new Set(["card.pr_merged", "card.pr_closed"]);

/** card id → the PR it still has open, folded from the journal oldest first. Pure + exported. */
export function openPrsOf(events: readonly BoardEvent[]): Map<string, { url: string | null; ts: number }> {
  const open = new Map<string, { url: string | null; ts: number }>();
  for (const e of events) {
    if (!e.cardId) continue;
    if (e.type === "card.pr_opened") {
      open.set(e.cardId, { url: (e.payload as { url?: string | null } | null)?.url ?? null, ts: e.ts });
    } else if (OVER.has(e.type)) {
      open.delete(e.cardId);
    }
  }
  return open;
}

/**
 * Write down that a card's PR is over, the first time GitHub says so — and only then, so a card
 * screen re-reading a merged PR doesn't journal it again on every open. A merge is final; a close
 * can be undone on GitHub, and the card screen, which always asks, still says so if it is.
 */
export function notePrOutcome(db: BoardDb, cardId: string, pr: PrStatus | null): void {
  if (pr?.state !== "merged" && pr?.state !== "closed") return;
  const last = db.listEvents(cardId).find((e) => e.type === "card.pr_opened" || OVER.has(e.type));
  if (last?.type !== "card.pr_opened") return;
  db.recordEvent(cardId, `card.pr_${pr.state}`, { url: pr.url, ...(pr.mergedAt ? { mergedAt: pr.mergedAt } : {}) });
}

export interface OpenPr {
  card: Pick<Card, "id" | "title" | "status" | "repoPath" | "branch">;
  url: string | null;
  openedAt: number;
  /** Only on a check: what GitHub said, null when it could not be asked. */
  pr?: PrStatus | null;
}

/** The list, newest PR first. `check` asks GitHub about every row, fresh, and journals what is over. */
export async function openPrs(db: BoardDb, check = false): Promise<OpenPr[]> {
  const rows: { row: OpenPr; card: Card }[] = [];
  for (const [id, { url, ts }] of openPrsOf(db.listPrEvents())) {
    const card = db.getCard(id);
    if (!card) continue;
    const { title, status, repoPath, branch } = card;
    rows.push({ card, row: { card: { id, title, status, repoPath, branch }, url, openedAt: ts } });
  }
  rows.sort((a, b) => b.row.openedAt - a.row.openedAt);
  if (check) {
    // ponytail: one `gh pr view` per row, all at once — a board has a handful of open PRs. One
    // `gh pr list` per repo if that ever stops being true.
    await Promise.all(
      rows.map(async ({ row, card }) => {
        row.pr = await prStatusFor(card, Date.now, true);
        notePrOutcome(db, card.id, row.pr);
      }),
    );
  }
  return rows.map((r) => r.row);
}
