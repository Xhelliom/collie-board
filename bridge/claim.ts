// ADR 0048 §7: launching a card of a shared repo claims it first, by a push the remote can refuse —
// two pairs never launch the same card. The push is journal-sync.ts's; this is what a launch asks,
// kept apart so cards.ts and remote-launch.ts reach it without importing the routes.

import type { BoardDb, Card, CardClaim, Run } from "./db.ts";

export type ClaimResult = { ok: true } | { ok: false; error: string; offline?: true };

/** The running sync's claim, registered by JournalSync. None (tests, sync off): nothing is claimed. */
let claimer: ((repo: string, cardId: string, force: boolean) => Promise<ClaimResult>) | null = null;

export function setClaimer(fn: typeof claimer): void {
  claimer = fn;
}

/** The claim that keeps `card` from launching on `pair`: another pair's, on a card not finished. Done or archived releases it. */
export function claimHolder(card: Pick<Card, "claim" | "status">, pair: string): CardClaim | null {
  const c = card.claim;
  return c && c.pair !== pair && card.status !== "done" && card.status !== "archived" ? c : null;
}

export function claimReason(c: CardClaim): string {
  const at = new Date(c.at);
  return `taken by ${c.by} at ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/** Claim a shared card before launching it; null when it may launch, else why not. An unshared repo: always null. */
export async function claimForLaunch(db: BoardDb, card: Card): Promise<string | null> {
  if (!card.repoPath || !db.repoShare(card.repoPath) || !claimer) return null;
  const r = await claimer(card.repoPath, card.id, false);
  if (r.ok) return null;
  if (!r.offline) return r.error;
  // §7: offline nobody can be told — only a card assigned to this pair's identity is nobody else's to take.
  const me = db.peerIdentity(card.repoPath);
  if (me && card.assignee === me) return null;
  return `offline: the claim could not be pushed, and only a card assigned to you launches offline (${r.error})`;
}

/** « Reprendre la main »: claim the card over another pair's claim. The operator's gesture, confirmed in the UI. */
export async function takeOver(card: Card): Promise<ClaimResult> {
  if (!card.repoPath || !claimer) return { ok: false, error: "this card's board is not shared" };
  return claimer(card.repoPath, card.id, true);
}

/** §7: an orchestrator never launches a card of a shared repo assigned to someone else, even online. Null: it may. */
export function assignedElsewhere(db: Pick<BoardDb, "repoShare" | "peerIdentity">, card: Pick<Card, "repoPath" | "assignee">): string | null {
  if (!card.repoPath || !card.assignee || !db.repoShare(card.repoPath)) return null;
  return card.assignee === db.peerIdentity(card.repoPath) ? null : `this card is assigned to ${card.assignee} — an agent never launches another person's card`;
}

/** §7: a lot belongs to its creator — only that pair launches, resumes and drives it. Null: this pair may. */
export function lotOwnerRefusal(db: Pick<BoardDb, "ownsRun">, run: Pick<Run, "createdPair" | "createdBy">): string | null {
  return db.ownsRun(run) ? null : `this lot is ${run.createdBy ?? "another pair"}'s — only the pair that created it launches or resumes it`;
}
