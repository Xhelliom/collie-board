// A finished turn is read at the working → idle PASSAGE, not at Herdr's `done` (ADR 0037).
//
// `done` lasts an instant; a poll that misses it (or a pane the operator already looked at) goes
// working → idle and `STATUS_COLUMN` keeps the card in `working` for ever. So: once a pane was SEEN
// working since the last prompt and then stays idle for IDLE_LANDING_MS, the card lands in `review`
// with the reason `agent done` — the one board-notify.ts already reads as "the pane said it", so
// nothing notifies twice. Idle without a prior working is a start (starting → idle before the prompt
// is delivered) and moves nothing. Runtime state only, in memory: a bridge restart forgets it.

import { paneReason } from "./cards.ts";
import type { BoardDb } from "./db.ts";
import type { EngineSnapshot } from "./state-engine.ts";

/** How long a pane that worked must sit idle before its turn counts as finished. ponytail: calibration knob. */
export const IDLE_LANDING_MS = 45_000;

export class IdleLanding {
  /** paneId → when it was last seen `working`. */
  private readonly workingAt = new Map<string, number>();
  /** paneId → when its current idle spell began. */
  private readonly idleSince = new Map<string, number>();

  constructor(
    private readonly db: BoardDb,
    private readonly now: () => number = Date.now,
  ) {}

  /** Called on every successful poll. */
  update(snap: EngineSnapshot): void {
    if (snap.bridge === "disconnected") return;
    const now = this.now();
    const live = new Set(snap.agents.map((p) => p.paneId));
    for (const m of [this.workingAt, this.idleSince]) for (const id of [...m.keys()]) if (!live.has(id)) m.delete(id);

    for (const p of snap.agents) {
      if (p.status === "working") this.workingAt.set(p.paneId, now);
      if (p.status === "idle") {
        if (!this.idleSince.has(p.paneId)) this.idleSince.set(p.paneId, now);
      } else this.idleSince.delete(p.paneId);
    }

    for (const session of this.db.listOpenSessions()) {
      const since = session.paneId ? this.idleSince.get(session.paneId) : undefined;
      const worked = session.paneId ? this.workingAt.get(session.paneId) : undefined;
      if (since === undefined || worked === undefined || now - since < IDLE_LANDING_MS) continue;
      const card = this.db.getCard(session.cardId);
      if (card?.status !== "working") continue;
      // A prompt newer than the last observed work restarts the count (it is a new turn).
      const prompted = this.db.listEvents(card.id, 50).find((e) => e.type === "card.prompted")?.ts ?? 0;
      if (prompted >= worked) continue;
      this.db.setStatus(card.id, "review", paneReason("done"));
    }
  }
}
