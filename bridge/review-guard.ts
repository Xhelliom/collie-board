import type { BoardDb, Card } from "./db.ts";
import type { EngineSnapshot } from "./state-engine.ts";
import { baseOf, diffStat, isBoardPath, parseNumstat, resolveBase, runGit, worktreePathFor, type GitRunner } from "./git.ts";

/** What a card's branch holds against its base. `committed` is the only state that is a review. */
export type BranchWork = "committed" | "uncommitted" | "nothing";

/**
 * Commits first, then the working tree — the same two questions `diffStat` mixes, kept apart because
 * the right move differs: `uncommitted` is one prompt to the agent still sitting in the branch,
 * `nothing` is a card that never started. `.board/` is the bridge's own plumbing, never the work.
 */
export async function branchWork(cwd: string, baseRef: string | null, git: GitRunner = runGit): Promise<BranchWork> {
  const base = await resolveBase(cwd, baseRef, git);
  const committed = await git(["diff", "--numstat", base, "HEAD"], cwd);
  if (committed.ok && parseNumstat(committed.stdout).some((f) => !isBoardPath(f.path))) return "committed";
  return (await diffStat(cwd, baseRef, git)).files.length > 0 ? "uncommitted" : "nothing";
}

/** The journal line that says why the card did not reach review. Pure. */
export function refusalReason(work: Exclude<BranchWork, "committed">, branch: string, base: string): string {
  return work === "uncommitted"
    ? `review refused: ${branch} holds uncommitted work only (nothing committed vs ${base}) — ask the agent to commit`
    : `review refused: ${branch} has nothing vs ${base} — no commit, no file; the work was never done`;
}

/** An exploration delivers a conclusion; a card with no branch has no diff to measure. */
const needsCode = (c: Card): c is Card & { repoPath: string; branch: string } =>
  !!c.repoPath && !!c.branch && c.category !== "explore";

/**
 * Rides `engine.onUpdate` (no timer). A card seen in `review` is checked ONCE per stay there — the
 * set forgets it when it leaves, so a second landing is checked again. A refused card goes back to
 * `working`, the column an idle pane maps to, so `reconcile()` leaves it there. The refusal is the
 * `card.status` journal entry's reason, on the card; it raises no alert of its own (ADR 0011).
 */
export class ReviewGuard {
  private checked = new Set<string>();
  constructor(private db: BoardDb, private git: GitRunner = runGit) {}

  async onUpdate(snap: EngineSnapshot): Promise<void> {
    if (snap.bridge === "disconnected") return;
    const inReview = this.db.listCardsWithStatus("review");
    const ids = new Set(inReview.map((c) => c.id));
    for (const id of this.checked) if (!ids.has(id)) this.checked.delete(id);
    for (const card of inReview) {
      if (this.checked.has(card.id) || !needsCode(card)) continue;
      this.checked.add(card.id);
      const cwd = await worktreePathFor(card.repoPath, card.branch, this.git);
      if (!cwd) continue;
      const base = await baseOf(card, this.git);
      const work = await branchWork(cwd, base, this.git);
      // ADR 0041: a card folded into its lot measures empty against the lot's branch — it delivered.
      if (work === "committed" || (work === "nothing" && this.db.listEvents(card.id, 200).some((e) => e.type === "card.lot_merged"))) continue;
      this.db.setStatus(card.id, "working", refusalReason(work, card.branch, base ?? "HEAD"));
    }
  }
}
