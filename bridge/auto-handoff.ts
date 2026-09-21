// Auto handoff — write the note while the prompt cache is warm, offer it once the cache has gone cold.
//
// Claude Code's prompt cache lives five minutes. A session left at its prompt longer than that is
// reloaded whole, uncached, on its next turn — on a long conversation, the most expensive message of
// the day. A fresh session opened on a handoff note costs a page. So just before the cache expires,
// the board asks the idle agent for its handoff note — one turn, on a warm cache — and stores it on
// the session. When the operator comes back after the cache is gone, the pane screen offers to start
// a fresh session from that note instead. Declining, or simply typing into the pane, leaves the
// session exactly as it was.
//
// ONLY THE NOTE IS AUTOMATIC. Replacing the agent stays a tap, for the reason handoff.ts gives: only
// the operator knows whether the next turn wants the whole conversation or just the note.
//
// Idle is measured from the last OBSERVED end of a `working` spell, in memory. A pane that was
// already quiet when the bridge started has no known start, and gets no ask: prompting it once the
// cache is gone would pay for exactly the reload this exists to avoid.

import { promptAndConfirm } from "./cards.ts";
import type { Config } from "./config.ts";
import {
  type BoardDb,
  type CardSession,
  isAutoHandoffOffered,
  isAutoHandoffPending,
  PROMPT_CACHE_TTL_MS,
} from "./db.ts";
import { handoffPrompt, NO_AGENT, readHandoffNote, swapToFreshSession } from "./handoff.ts";
import type { HerdrClient } from "./herdr-client.ts";
import type { EngineSnapshot } from "./state-engine.ts";

/**
 * How long a session sits quiet before the note is asked for. ponytail: calibration knob — one
 * minute of margin under the TTL covers the idle poll cadence (12 s) and the prompt's own settle.
 */
const ASK_AFTER_MS = 4 * 60 * 1000;

/** Same guard as the manual handoff's: the agent is idle the instant it is prompted. */
const SETTLE_MS = 10_000;

/** A note that never lands (refused, crashed, stuck on a prompt) stops being waited for. */
const DEADLINE_MS = 30 * 60 * 1000;

export class AutoHandoff {
  /** paneId → when its last `working` spell ended. Runtime state, in memory only. */
  private readonly quietSince = new Map<string, number>();
  private readonly lastStatus = new Map<string, string>();
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly db: BoardDb,
    private readonly herdr: HerdrClient,
    private readonly now: () => number = Date.now,
  ) {}

  /** Called on every successful poll. Never throws. */
  update(snap: EngineSnapshot): void {
    if (snap.bridge === "disconnected") return;
    const now = this.now();
    const panes = new Map(snap.agents.map((p) => [p.paneId, p]));

    for (const p of snap.agents) {
      const prev = this.lastStatus.get(p.paneId);
      this.lastStatus.set(p.paneId, p.status);
      if (p.status === "working") this.quietSince.delete(p.paneId);
      else if (prev === "working") this.quietSince.set(p.paneId, now);
    }
    for (const id of [...this.lastStatus.keys()]) {
      if (panes.has(id)) continue;
      this.lastStatus.delete(id);
      this.quietSince.delete(id);
    }

    const boardDefault = this.db.autoHandoff();
    for (const session of this.db.listOpenSessions()) {
      const pane = session.paneId ? panes.get(session.paneId) : undefined;
      if (!pane || this.inFlight.has(session.id)) continue;
      const quiet = pane.status === "idle" || pane.status === "done";
      const busy = pane.status === "working" || pane.status === "blocked";

      if (isAutoHandoffPending(session)) {
        const age = now - session.autoHandoffAt!;
        if (age > DEADLINE_MS) this.db.patchSession(session.id, { autoHandoffAt: null });
        else if (age >= SETTLE_MS && quiet) this.run(session, () => this.collect(session));
        continue;
      }
      if (session.autoHandoffAt !== null) {
        // On offer, and the conversation went on without it: that is a "no".
        if (busy) this.db.patchSession(session.id, { autoHandoffAt: null });
        continue;
      }

      // A manual handoff owns the pane; the cache is Claude Code's; a blocked agent is asking something.
      if (session.handoffRequestedAt !== null || pane.agent !== "claude" || !quiet) continue;
      const since = this.quietSince.get(pane.paneId);
      if (since === undefined) continue;
      const idle = now - since;
      if (idle < ASK_AFTER_MS || idle >= PROMPT_CACHE_TTL_MS) continue;
      // The card's own choice, else the board pref (off by default). Both gate ONLY this ask: a note
      // already asked for still lands or expires, or its marker would freeze the card's column.
      const choice = this.db.getCard(session.cardId)?.autoHandoff ?? null;
      if (choice === "on" || (choice === null && boardDefault)) this.run(session, () => this.ask(session));
    }
  }

  private run(session: CardSession, job: () => Promise<void>): void {
    this.inFlight.add(session.id);
    void job()
      .catch(() => {})
      .finally(() => this.inFlight.delete(session.id));
  }

  private async ask(session: CardSession): Promise<void> {
    // Marker FIRST: the prompt flips the pane to `working` before promptAndConfirm returns, and
    // reconcile() and the notification hook must already know that spell is the board's.
    const at = this.now();
    this.db.patchSession(session.id, { autoHandoffAt: at, handoffMd: null });
    try {
      await promptAndConfirm(this.herdr, session.paneId!, handoffPrompt());
      this.db.recordEvent(session.cardId, "handoff.auto_requested", { sessionId: session.id });
    } catch {
      this.db.patchSession(session.id, { autoHandoffAt: null });
    }
  }

  private async collect(session: CardSession): Promise<void> {
    const card = this.db.getCard(session.cardId);
    if (!card) return;
    const note = await readHandoffNote(card, session.autoHandoffAt!);
    if (note === null) return;
    this.db.patchSession(session.id, { handoffMd: note, autoHandoffAt: this.now() });
    this.db.recordEvent(card.id, "handoff.auto_stored", { sessionId: session.id, noteChars: note.length });
  }
}

export type ResumeError = { kind: "refused" | "herdr"; message: string };

/**
 * The operator's answer to the offer. `accept`: replace the pane with a fresh agent opened on the
 * stored note. Otherwise: drop the offer, keep the note on the session, touch nothing else.
 */
export async function answerAutoHandoff(
  db: BoardDb,
  herdr: HerdrClient,
  cfg: Config,
  cardId: string,
  accept: boolean,
): Promise<{ ok: true; paneId: string | null } | { ok: false; error: ResumeError }> {
  const card = db.getCard(cardId);
  const session = db.openSessionFor(cardId);
  if (!card || !session?.paneId) return { ok: false, error: { kind: "refused", message: NO_AGENT } };
  if (!accept) {
    db.patchSession(session.id, { autoHandoffAt: null });
    return { ok: true, paneId: session.paneId };
  }
  if (!isAutoHandoffOffered(session, Date.now())) {
    return { ok: false, error: { kind: "refused", message: "no stored handoff on offer" } };
  }
  try {
    const next = await swapToFreshSession(db, herdr, cfg, card, session, session.handoffMd!);
    return { ok: true, paneId: next.paneId };
  } catch (err) {
    return { ok: false, error: { kind: "herdr", message: (err as Error).message } };
  }
}
