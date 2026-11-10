import type { BoardDb, CardStatus } from "./db.ts";
import { hasRealChanges, parseWorktreeList, removeWorktreeAt, runGit, worktreeDirFor, type GitRunner } from "./git.ts";
import { ownerOf } from "./mux/composite.ts";
import type { Mux, WirePane } from "./mux/mux.ts";

// ─────────────────────────────────────────────────────────────────────────────
// The end of a card's checkout, where the engine keeps no workspace for it.
//
// herdr 0.9 removes a worktree by closing its workspace, panes included. hc has no workspace: the
// checkout is git's, and a terminal outlives the directory it was opened in. So the panes are closed
// by where they sit — and a filed card's leftovers (a clean checkout, a pane in a checkout already
// gone) are swept once at startup.
// ─────────────────────────────────────────────────────────────────────────────

/** hc's terminals sitting in `checkout`. herdr 0.9's are left to `removeWorktree`, which closes their workspace. */
export function hcPanesIn(panes: WirePane[], checkout: string): WirePane[] {
  return panes.filter((p) => ownerOf(p.pane_id) === "hc" && (p.cwd === checkout || p.cwd?.startsWith(`${checkout}/`)));
}

/** A close refused because the pane is already gone — the outcome we wanted (herdr: `pane_not_found`; hc: `no terminal "t3"`). */
export const isUnknownPane = (err: unknown): boolean => /not_found|no terminal/.test((err as Error)?.message ?? "");

/** Close panes; any refusal other than « already gone » is written on the card (`card.cleanup_failed`, stage `pane`). */
export async function closePanes(db: BoardDb, herdr: Mux, cardId: string, paneIds: string[]): Promise<void> {
  for (const paneId of new Set(paneIds)) {
    try {
      await herdr.closePane(paneId);
    } catch (err) {
      if (!isUnknownPane(err)) db.recordEvent(cardId, "card.cleanup_failed", { stage: "pane", paneId, error: (err as Error).message });
    }
  }
}

/** Close hc's terminals in a checkout about to go. A herd that cannot be listed is written on the card too. */
export async function closeHcPanesIn(db: BoardDb, herdr: Mux, cardId: string, checkout: string): Promise<void> {
  let panes: WirePane[];
  try {
    panes = await herdr.listPanes();
  } catch (err) {
    db.recordEvent(cardId, "card.cleanup_failed", { stage: "pane", error: (err as Error).message });
    return;
  }
  await closePanes(db, herdr, cardId, hcPanesIn(panes, checkout).map((p) => p.pane_id));
}

export type SweepChoice = "remove" | "report" | "keep";

/**
 * What the startup sweep does with a card's checkout. Only a filed card is touched, never while an
 * agent is at work in it; uncommitted work is reported, never removed. `remove` without a worktree
 * still closes the panes left in the directory it had.
 */
export function sweepChoice(c: { status: CardStatus; dirty: boolean; busy: boolean }): SweepChoice {
  if (c.status !== "done" && c.status !== "archived") return "keep";
  if (c.busy) return "keep";
  return c.dirty ? "report" : "remove";
}

const SWEEP_REPORT = "uncommitted changes — kept by the startup sweep";

/**
 * Once at startup: `git worktree prune` per repo, then each filed card's checkout — removed when
 * clean (the branch stays, so nothing is lost), reported on the card once when not.
 */
export async function sweepWorktrees(db: BoardDb, herdr: Mux, git: GitRunner = runGit): Promise<{ removed: string[]; reported: string[] }> {
  const out = { removed: [] as string[], reported: [] as string[] };
  const cards = db.listCards({ includeArchived: true }).filter((c) => c.repoPath && c.branch);
  const panes = await herdr.listPanes();
  // A branch a live card still works on is not a filed card's to remove (a reopened or piped card).
  const live = new Set(cards.filter((c) => sweepChoice({ status: c.status, dirty: false, busy: false }) === "keep").map((c) => `${c.repoPath}\n${c.branch}`));
  for (const repo of new Set(cards.map((c) => c.repoPath!))) {
    await git(["worktree", "prune"], repo);
    const listed = await git(["worktree", "list", "--porcelain"], repo);
    if (!listed.ok) continue;
    const trees = parseWorktreeList(listed.stdout);
    for (const card of cards) {
      if (card.repoPath !== repo || live.has(`${repo}\n${card.branch}`)) continue;
      const tree = trees.find((w) => w.branch === card.branch)?.path ?? null;
      // The main checkout is never a card's: every pane of the repo sits in it.
      if (tree && tree === trees[0]?.path) continue;
      const checkout = tree ?? worktreeDirFor(repo, card.branch!);
      const inside = hcPanesIn(panes, checkout);
      if (!tree && inside.length === 0) continue;
      const status = tree ? await git(["status", "--porcelain"], tree) : null;
      const choice = sweepChoice({
        status: card.status,
        // An unreadable status is not a clean one.
        dirty: status ? !status.ok || hasRealChanges(status.stdout) : false,
        busy: inside.some((p) => p.agent_status === "working" || p.agent_status === "blocked"),
      });
      if (choice === "keep") continue;
      if (choice === "report") {
        const told = db.listEvents(card.id, 500).some((e) => e.type === "card.cleanup_failed" && (e.payload as { error?: string } | null)?.error === SWEEP_REPORT);
        if (!told) db.recordEvent(card.id, "card.cleanup_failed", { stage: "worktree", error: SWEEP_REPORT });
        out.reported.push(checkout);
        continue;
      }
      await closePanes(db, herdr, card.id, inside.map((p) => p.pane_id));
      if (!tree) continue;
      const removed = await removeWorktreeAt(repo, tree, git);
      if (removed.ok) {
        db.recordEvent(card.id, "card.worktree_swept", { checkout: tree });
        out.removed.push(tree);
      } else db.recordEvent(card.id, "card.cleanup_failed", { stage: "worktree", error: removed.error });
    }
  }
  return out;
}
