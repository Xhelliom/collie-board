// Commits that reach a card's branch AFTER the card was merged and filed (incident cimaise 08/11, card
// 94374e94: merged at 21:44, its agent's pane outlived the merge and committed ten more times — none of
// it ever reached main). Nothing integrates a done card again, so the board says it: `card.late_commits`
// on the card, which the orchestrator nudger turns into a message and a bell entry.
//
// Rides `engine.onUpdate`, throttled here: one `git for-each-ref` per repo a minute, and a `rev-list`
// only for a done card whose branch still exists and has stopped moving.
//
// shortcut: reads the refs this machine has (local branch + origin's remote-tracking one), never
// fetches — a push made from another machine is seen at the next fetch; fetch here if that bites.

import type { BoardDb, Card } from "./db.ts";
import { baseOf, runGit, type GitRunner } from "./git.ts";
import type { EngineSnapshot } from "./state-engine.ts";

export const SCAN_EVERY_MS = 60_000;
/** A branch still being committed to is not reported yet: one alert for the burst, not one per commit. */
export const QUIET_MS = 5 * 60_000;

/** The ways a card's work lands: merged locally, its PR merged, or folded into its lot's branch. */
const LANDED = ["card.merged", "card.pr_merged", "card.lot_merged"];
export const LATE_COMMITS = "card.late_commits";

export class LateCommits {
  private at = -Infinity;
  private running = false;
  /** card id → the head(s) last seen, since when, and whether that head was already examined. In memory: a restart examines once more, the journal dedupes. */
  private readonly seen = new Map<string, { head: string; since: number; done: boolean }>();

  constructor(
    private readonly db: BoardDb,
    private readonly git: GitRunner = runGit,
    private readonly now: () => number = Date.now,
  ) {}

  async update(snap: EngineSnapshot): Promise<void> {
    if (snap.bridge === "disconnected" || this.running || this.now() - this.at < SCAN_EVERY_MS) return;
    this.at = this.now();
    this.running = true;
    try {
      const byRepo = new Map<string, Card[]>();
      for (const c of this.db.listCardsWithStatus("done")) if (c.repoPath && c.branch) byRepo.set(c.repoPath, [...(byRepo.get(c.repoPath) ?? []), c]);
      for (const [repo, cards] of byRepo) {
        const r = await this.git(["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/remotes/origin"], repo);
        if (!r.ok) continue;
        const refs = new Map(r.stdout.split("\n").filter(Boolean).map((l) => l.split(" ") as [string, string]));
        for (const card of cards) await this.examine(card, refs);
      }
    } finally {
      this.running = false;
    }
  }

  private async examine(card: Card, refs: Map<string, string>): Promise<void> {
    const names = [`refs/heads/${card.branch}`, `refs/remotes/origin/${card.branch}`].filter((n) => refs.has(n));
    if (!names.length) return void this.seen.delete(card.id);
    const head = names.map((n) => refs.get(n)).join(" ");
    const was = this.seen.get(card.id);
    if (was?.head !== head) return void this.seen.set(card.id, { head, since: was ? this.now() : -Infinity, done: false });
    if (was.done || this.now() - was.since < QUIET_MS) return;
    was.done = true;

    const events = this.db.listEventsOf(card.id, [...LANDED, LATE_COMMITS]);
    const landed = events.findLast((e) => LANDED.includes(e.type));
    if (!landed || (events.findLast((e) => e.type === LATE_COMMITS)?.payload as { head?: string } | undefined)?.head === head) return;
    const base = await baseOf(card, this.git);
    if (!base) return;
    // Committed after the landing (a squash-merge leaves the older ones outside the base for ever), not
    // in the base, and touching more than `.board/` — the closing note an agent commits there is not work.
    const since = Math.floor(((landed.payload as { mergedAt?: number } | null)?.mergedAt ?? landed.ts) / 1000);
    const n = await this.git(["rev-list", "--count", `--max-age=${since}`, ...names, "--not", base, "--", ".", ":(exclude).board"], card.repoPath!);
    const count = n.ok ? Number(n.stdout.trim()) : 0;
    if (count > 0) this.db.recordEvent(card.id, LATE_COMMITS, { branch: card.branch, base, count, head });
  }
}
