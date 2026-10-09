// What the operator says to a worker, kept so the lead can read it (ADR 0017).
//
// The lead judges each time a worker lands, and until now it could not know the operator had spoken
// to the worker in between — so it sent a corrective message that contradicted theirs. The text goes
// in the journal as `card.operator_said`; the coordinator hands the ones since the lead's last
// verdict to its next question. Only the operator's: the lead's own prompts go through
// `promptAndConfirm`, not through the routes that call this.

import type { BoardDb } from "./db.ts";

/** A pasted log is not an instruction; the lead needs the gist. */
const MAX_CHARS = 2_000;

/** The pane's open card, if it has one. A shell pane or an unknown pane records nothing. */
export function recordOperatorSaid(db: Pick<BoardDb, "openSessionByPane" | "recordEvent">, paneId: string, text: string): void {
  const said = text.trim();
  const session = said ? db.openSessionByPane(paneId) : null;
  if (!session) return;
  db.recordEvent(session.cardId, "card.operator_said", { text: said.slice(0, MAX_CHARS) });
}
