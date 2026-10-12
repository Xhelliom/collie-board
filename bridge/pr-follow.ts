// "PR & done" (ADR 0035): the tap opens the PR and journals `card.pr_follow`; the card is filed only
// when the PR merges. This follows those PRs on `engine.onUpdate` — no timer — reading everything from
// the journal, so a bridge restart picks every follow up again on its first tick.

import type { BoardDb, Card } from "./db.ts";
import { parseGate, runGate, type GateResult } from "./gate.ts";
import { worktreePathFor, type PrStatus } from "./git.ts";
import type { HerdrClient } from "./herdr-client.ts";
import { mergeWhenReady, prStatusFor, type MergeGate } from "./integrate.ts";
import { notePrOutcome } from "./prs.ts";
import type { EngineSnapshot } from "./state-engine.ts";
import { fileAsDone } from "./wrapup.ts";

/** GitHub's checks take minutes; the tick is 1.5 s. Same pace as a run's `land` step. */
const FOLLOW_EVERY_MS = 30_000;

export interface FollowPorts {
  /** `prStatusFor(card, now, true)`: fresh, a cached "open" would hide a merge. */
  prStatus(card: Card): Promise<PrStatus | null>;
  /** The gate verdict for this follow, run at most once and journaled as `run.gate { runId }`. */
  gate(card: Card, runId: string): Promise<MergeGate>;
  /** `mergeWhenReady` — journals `run.merge` (and `card.pr_merged` when it merged). */
  land(card: Card, gate: MergeGate): Promise<void>;
  fileAsDone(card: Card): void;
}

/** card id → the follow on its current PR, folded from the PR events oldest first. Pure + exported. */
export function followsOf(events: readonly { id: number; cardId: string | null; type: string }[]): Map<string, { followId: number; merged: boolean }> {
  const out = new Map<string, { followId: number | null; merged: boolean }>();
  for (const e of events) {
    if (!e.cardId) continue;
    if (e.type === "card.pr_opened") out.set(e.cardId, { followId: null, merged: false });
    else if (e.type === "card.pr_closed") out.delete(e.cardId);
    else if (e.type === "card.pr_merged") { const f = out.get(e.cardId); if (f) f.merged = true; }
    // A re-push of a PR already open journals `pr_updated`, not `pr_opened`: the follow attaches to the open PR.
    else if (e.type === "card.pr_follow") { const f = out.get(e.cardId); if (f && !f.merged) f.followId = e.id; }
  }
  return new Map([...out].flatMap(([id, f]) => (f.followId === null ? [] : [[id, { followId: f.followId, merged: f.merged }]])));
}

export const followRunId = (followId: number): string => `pr-follow-${followId}`;

export class PrFollower {
  private readonly asked = new Map<string, number>();
  private readonly busy = new Set<string>();

  constructor(
    private readonly db: BoardDb,
    private readonly ports: FollowPorts,
    private readonly now: () => number = Date.now,
  ) {}

  update(snap: EngineSnapshot): void {
    if (snap.bridge === "disconnected") return;
    for (const [cardId, { followId, merged }] of followsOf(this.db.listPrEvents())) {
      const card = this.db.getCard(cardId);
      if (!card || card.status === "done" || card.status === "archived" || this.busy.has(cardId)) continue;
      // Merged while the bridge was down between the merge and the filing: file it now.
      if (merged) { this.ports.fileAsDone(card); continue; }
      const asked = this.asked.get(cardId);
      if (asked !== undefined && this.now() - asked < FOLLOW_EVERY_MS) continue;
      this.asked.set(cardId, this.now());
      this.busy.add(cardId);
      void this.tick(card, followRunId(followId))
        .catch(() => {})
        .finally(() => this.busy.delete(cardId));
    }
  }

  /** One ask. Exported through `update` only; public so a test can await it. */
  async tick(card: Card, runId: string): Promise<void> {
    // A red check, a red gate, a conflict: the board said no and why (`run.merge`). The follow ends
    // there — a new "PR & done" tap after the fix journals a new one. Only "checks running" waits.
    const last = this.db.listEvents(card.id, 200).find((e) => e.type === "run.merge" && (e.payload as { runId?: string }).runId === runId);
    if (last && !(last.payload as { wait?: boolean }).wait) return;
    const pr = await this.ports.prStatus(card);
    notePrOutcome(this.db, card.id, pr); // merged by GitHub's auto-merge or by hand counts too
    if (pr?.state === "merged") return this.ports.fileAsDone(this.db.getCard(card.id)!);
    if (pr?.state !== "open") return;
    await this.ports.land(card, await this.ports.gate(card, runId));
    const merge = this.db.listEvents(card.id, 20).find((e) => e.type === "run.merge" && (e.payload as { runId?: string }).runId === runId);
    if ((merge?.payload as { merged?: boolean } | undefined)?.merged) this.ports.fileAsDone(this.db.getCard(card.id)!);
  }
}

/** The real ports, gated like a run (ADR 0027/0029): the repo's gate runs once in the card's checkout. */
export function prFollowHook(db: BoardDb, herdr: HerdrClient): (snap: EngineSnapshot) => void {
  const follower = new PrFollower(db, {
    prStatus: (card) => prStatusFor(card, Date.now, true),
    gate: async (card, runId) => {
      const command = card.repoPath ? db.repoGate(card.repoPath) : null;
      if (!command) return { runId, ok: true, why: "no gate set" };
      const ran = db.listEvents(card.id, 200).find((e) => e.type === "run.gate" && (e.payload as { runId?: string }).runId === runId);
      let ok = (ran?.payload as { ok?: boolean } | undefined)?.ok;
      if (ok === undefined) {
        const argv = parseGate(command);
        const worktree = card.repoPath && card.branch ? await worktreePathFor(card.repoPath, card.branch) : null;
        const r: GateResult = !argv ? { kind: "error", message: "empty gate command" } : !worktree ? { kind: "error", message: "the checkout is gone" } : await runGate(argv, worktree);
        ok = r.kind === "pass";
        db.recordRunEvent(card.id, "run.gate", { runId, command, ok, ...(r.kind === "fail" ? { summary: r.summary } : r.kind === "error" ? { summary: r.message } : {}) });
      }
      return { runId, ok, why: ok ? "gate green" : "the gate is red — not merging" };
    },
    land: (card, gate) => mergeWhenReady(db, card.id, card.repoPath!, card.branch!, gate),
    fileAsDone: (card) => fileAsDone(db, herdr, card),
  });
  return (snap) => follower.update(snap);
}
