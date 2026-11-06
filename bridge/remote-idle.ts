// A card run on a peer that stops without delivering (incident 06/11, « Sonde Windows »): its pane went
// idle, the card stayed `working`, nobody heard. No session row here for `reconcile()` or `IdleLanding`
// to read (remote-launch.ts), so this reads the transitions off the peer herd's own read (peer-herd.ts,
// `onRead`) — no loop of its own.
//
// At the passage to idle, GitHub is asked ONCE for the branch's PR: one found is attached like a PR the
// agent opened itself (`card.pr_updated` + `card.pr_follow`, so `PrFollower` files the card at its
// merge). None: `card.remote_idle` — read by the orchestrator through `/api/orchestrator/since` — and it
// retracts (ADR 0011) with `card.remote_idle_cleared` when the pane works again or its PR turns up, or
// by the card ending (`card.remote_ended`, done, archived).

import type { BoardDb, Card } from "./db.ts";
import { prUrlOf } from "./cards.ts";
import type { PrStatus } from "./git.ts";
import { notePrOutcome, prStatusFor } from "./integrate.ts";
import { REMOTE_ENDED, REMOTE_LAUNCHED, remoteSessionFor, type RemoteSession } from "./remote-launch.ts";

export const REMOTE_IDLE = "card.remote_idle";
export const REMOTE_IDLE_CLEARED = "card.remote_idle_cleared";

const stopped = (s: string) => s === "idle" || s === "done";

export class RemoteIdle {
  /** peer → paneId → status at its last read. In memory: a restart starts from the first read again. */
  private readonly last = new Map<string, Map<string, string>>();

  constructor(
    private readonly db: BoardDb,
    /** Fresh: a cached "no PR" from before the push would hide it. Injected so tests need no GitHub. */
    private readonly prOf: (card: Card) => Promise<PrStatus | null> = (c) => prStatusFor(c, Date.now, true),
  ) {}

  /** One peer's agents, as just read from a connected peer. Resolves once the PR asks it started are back. */
  async seen(peer: string, agents: readonly Record<string, unknown>[]): Promise<void> {
    const prev = this.last.get(peer) ?? new Map<string, string>();
    const next = new Map<string, string>();
    const asks: Promise<void>[] = [];
    for (const a of agents) {
      if (typeof a.paneId !== "string" || typeof a.status !== "string") continue;
      next.set(a.paneId, a.status);
      const was = prev.get(a.paneId);
      // A first sighting is no transition; done → idle is the same stop.
      if (was === undefined || was === a.status || (stopped(was) && stopped(a.status))) continue;
      const found = this.cardOf(peer, a.paneId);
      if (!found) continue;
      if (a.status === "working") this.clear(found.card, "working");
      else if (stopped(a.status)) asks.push(this.stoppedAt(found.card, found.session));
    }
    this.last.set(peer, next);
    await Promise.all(asks);
  }

  private cardOf(peer: string, paneId: string): { card: Card; session: RemoteSession } | null {
    for (const card of this.db.listCards()) {
      if (card.environment?.peer !== peer) continue;
      const session = remoteSessionFor(this.db, card.id);
      if (session?.paneId === paneId) return { card, session };
    }
    return null;
  }

  /** Whether the card's newest remote word is an idle not retracted since. */
  private open(card: Card): boolean {
    if (card.status === "done" || card.status === "archived") return false;
    return this.db.lastEventOf(card.id, [REMOTE_IDLE, REMOTE_IDLE_CLEARED, REMOTE_LAUNCHED, REMOTE_ENDED])?.type === REMOTE_IDLE;
  }

  private clear(card: Card, why: "working" | "pr"): void {
    if (this.open(card)) this.db.recordEvent(card.id, REMOTE_IDLE_CLEARED, { why });
  }

  private async stoppedAt(card: Card, s: RemoteSession): Promise<void> {
    if (card.status === "done" || card.status === "archived") return;
    const branch = card.branch ?? (s.branch || null);
    const pr = branch && card.repoPath ? await this.prOf({ ...card, branch }).catch(() => null) : null;
    if (pr && pr.state !== "closed") {
      // The follower and the card screen read the PR off `card.branch`: a remote card had none here.
      if (!card.branch) this.db.patchCard(card.id, { branch: branch! }, "branch of its PR on the peer");
      if (prUrlOf(this.db, card.id) !== pr.url) {
        this.db.recordEvent(card.id, "card.pr_updated", { branch, url: pr.url });
        this.db.recordEvent(card.id, "card.pr_follow", { remote: s.peer });
      }
      notePrOutcome(this.db, card.id, pr); // already merged: journaled now, the follower files the card
      return this.clear(card, "pr");
    }
    if (!this.open(card)) this.db.recordEvent(card.id, REMOTE_IDLE, { peer: s.peer, environment: s.environment, paneId: s.paneId, branch });
  }
}
