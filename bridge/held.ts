// « En main » — the operator is talking to a card's worker, so the lead stays out (ADR 0058).
//
// `card.held` is the whole state: set by the operator's « Je le prends » or by any message they send
// to the worker from the app, cleared by « Rendre au lead », by the session ending, or by itself after
// {@link HELD_EXPIRE_MS} without a message. Nothing else is kept: whether the reminder was already
// said is read from the journal. No timer — {@link sweepHeld} rides `engine.onUpdate`.

import type { BoardDb, Card, CardHeld } from "./db.ts";

/** Without a message from the operator: a reminder in the bell… */
export const HELD_REMIND_MS = 60 * 60_000;
/** …then the card goes back to the lead by itself. */
export const HELD_EXPIRE_MS = 2 * HELD_REMIND_MS;

export const HELD_ERROR = "en main par l'opérateur — wait until they give it back to the lead; do not write to this worker";

type Db = Pick<BoardDb, "getCard" | "setHeld" | "recordEvent" | "openSessionFor">;

/** Take the card, or refresh `lastTouch` on one already in hand. Null: no such card, or no live worker to hold. */
export function hold(db: Db, cardId: string, now = Date.now()): Card | null {
  const card = db.getCard(cardId);
  if (!card || !db.openSessionFor(cardId)) return null;
  if (!card.held) db.recordEvent(cardId, "card.held", { by: "operator" });
  return db.setHeld(cardId, { by: "operator", at: card.held?.at ?? now, lastTouch: now });
}

/** Give it back to the lead — which picks up from the worker's current state, no round spent. */
export function release(db: Db, cardId: string, why: "operator" | "expired" | "ended" = "operator"): Card | null {
  const card = db.getCard(cardId);
  if (!card?.held) return card;
  db.recordEvent(cardId, "card.released", { why });
  return db.setHeld(cardId, null);
}

/** The operator wrote to a pane from the app: its open card, if it has one, is in hand. */
export function touchHeld(db: Db & Pick<BoardDb, "openSessionByPane">, paneId: string, now = Date.now()): void {
  const session = db.openSessionByPane(paneId);
  if (session) hold(db, session.cardId, now);
}

/** Whether the pane backs a card in hand — what refuses an agent writing to it. */
export function paneHeld(db: Pick<BoardDb, "openSessionByPane" | "getCard">, paneId: string): boolean {
  const session = db.openSessionByPane(paneId);
  return !!session && !!db.getCard(session.cardId)?.held;
}

/** What a held card is due, counted from the operator's last message. Pure. */
export function heldDue(held: CardHeld, now: number): "remind" | "expire" | null {
  const idle = now - held.lastTouch;
  return idle >= HELD_EXPIRE_MS ? "expire" : idle >= HELD_REMIND_MS ? "remind" : null;
}

/** Every tick: drop a held whose worker is gone, remind once per silence, expire. Never throws on its own. */
export function sweepHeld(db: Db & Pick<BoardDb, "listHeldCards" | "listEventsOf">, now = Date.now()): void {
  for (const card of db.listHeldCards()) {
    const held = card.held!;
    if (!db.openSessionFor(card.id)) {
      release(db, card.id, "ended");
      continue;
    }
    const due = heldDue(held, now);
    if (due === "expire") release(db, card.id, "expired");
    else if (due === "remind") {
      const said = db.listEventsOf(card.id, ["card.held_reminder"]).some((e) => (e.payload as { lastTouch?: number } | null)?.lastTouch === held.lastTouch);
      if (!said) db.recordEvent(card.id, "card.held_reminder", { lastTouch: held.lastTouch });
    }
  }
}
