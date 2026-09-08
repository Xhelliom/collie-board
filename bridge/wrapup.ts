// Wrapup — the last thing an agent is asked before its card is filed away.
//
// A handoff exists because a session dies before its task does; a wrapup is the opposite case. The
// operator has decided the task is finished, and the agent that did the work is the only party that
// knows what it actually did — the diff shows which lines moved, not which of the acceptance
// criteria that was meant to satisfy, nor what was tried and dropped along the way.
//
// So marking a card Done asks for one last note. The card is ALREADY `done` and its session already
// closed by the time this runs (see `releaseSession` and ADR 0002): the note is written to a card
// that has stopped moving, and nothing here can move it back. What the note feeds is the copilot's
// review, which turns whatever is still undone into the next cards.
//
// It reuses the handoff's whole asynchronous machine — the marker lives in a column so a pending
// request survives a restart, the deadline stops it firing days later, and the note ON DISK is the
// real "the agent has finished writing" signal (an idle status only says it stopped talking). The
// one thing it does NOT do is drive the pane beyond that one ask: the prompt tells the agent to
// commit before it writes the note (never push), so by the time the note exists the work is no
// longer sitting uncommitted for merge or cleanup to refuse. Reading the diff or pushing is still
// something you do from the terminal yourself.
//
// That ORDER has no enforcement, so the note's existence is not on its own the signal `collect()`
// waits on: an agent that writes its report first would otherwise hand the copilot a `(no changes)`
// diff for work that lands a second later — twice, in 0.137. So a note over an EMPTY checkout is
// held for {@link EMPTY_DIFF_GRACE_MS} before it is collected. A card whose work is genuinely empty
// is filed one grace window late, which costs nothing; the deadline still ends every wait.
//
// Once the wrapup itself is no longer pending — collected, or given up on — there is nothing left in
// the checkout worth waiting for, so `WrapupCoordinator` tries to clean it up on its own. This is the
// tap-only rule's one exception, and only barely: it does not merge, push, or decide anything a
// refusal wouldn't already have decided for the manual button — `cleanupCard` refuses exactly the
// same way either way, so the worst an automatic attempt can do is nothing. `card.keepWorktree` is
// the escape hatch for a branch the operator wants to poke at after the fact.

import { join } from "node:path";

import { promptAndConfirm, releaseSession } from "./cards.ts";
import type { BoardDb, Card, CardSession } from "./db.ts";
import { diffStat, worktreePathFor } from "./git.ts";
import type { HerdrClient } from "./herdr-client.ts";
import { cleanupCard } from "./integrate.ts";
import type { EngineSnapshot } from "./state-engine.ts";

/** Where the agent writes its closing note, relative to the card's checkout. */
export const WRAPUP_REL_PATH = ".board/wrapup.md";

/** Cap on the note we read back — same reasoning as the handoff's: a note is a page of prose. */
const MAX_WRAPUP_BYTES = 128 * 1024;

/** How long a requested wrapup may sit unfinished before we stop waiting for it. */
const WRAPUP_DEADLINE_MS = 30 * 60 * 1000;

/**
 * Grace period before a requested wrapup is considered finishable. The agent is idle at the instant
 * we prompt it and takes a poll or two to flip to `working`, so without this the very next tick
 * would read a note that isn't written yet and file an empty wrapup.
 */
const WRAPUP_SETTLE_MS = 10_000;

/**
 * How long a note that sits over a checkout with NOTHING in it is held before we believe it. Long
 * enough for the commit an agent writes its note ahead of, short enough that a card with genuinely
 * nothing to show is only reviewed a tick late. Bounded by the deadline above either way.
 */
const EMPTY_DIFF_GRACE_MS = 60_000;

/**
 * What the agent is asked for. Deliberately not a handoff note: nobody is picking this up, so "the
 * precise next step" is the wrong question. What the review needs is a claim against the acceptance
 * criteria — including the ones the agent knows it did not meet, which is the part a diff can never
 * show and the part that becomes the next cards. Pure + exported so the wording is reviewable.
 *
 * Commit comes FIRST, ahead of the note, so the copilot never reviews — and merge/cleanup never
 * runs — against work still sitting uncommitted. Nothing here polls for a commit, and nothing
 * enforces the order beyond the instruction itself, which is why `collect()` refuses to believe a
 * note that measures zero until {@link EMPTY_DIFF_GRACE_MS} has passed.
 */
export function wrapupPrompt(card: Card): string {
  const parts = [
    "The owner has marked this task finished. Before it is filed away, two things, in this order:",
    "",
    "1. Commit everything you changed here. Do NOT push, and do not touch any other checkout.",
    `2. Write a short report of what you actually did, to ${WRAPUP_REL_PATH} (create the directory if`,
    "   needed) — the report is not read until your work is committed, so commit first.",
    "",
    "The task was:",
    "",
    card.spec?.trim() || card.title.trim(),
  ];
  if (card.acceptance.length > 0) {
    parts.push("", "It was meant to be done when all of these held:", ...card.acceptance.map((a) => `- ${a}`));
  }
  parts.push(
    "",
    "Cover, in this order:",
    "",
    "1. What you did — the substance, not the file list. git has the file list.",
    card.acceptance.length > 0
      ? "2. Each criterion above, one line each: met, partly met, or not met — and how you know."
      : "2. What you consider finished, and how you know.",
    "3. What you did NOT do: anything you left out, worked around, or could not verify.",
    "4. Anything the next person should know before touching this again.",
    "",
    "Be honest about 2 and 3 — an overstated report becomes a card nobody knows is missing.",
    "Write the file and nothing else. Do not summarise it back to me.",
  );
  return parts.join("\n");
}

/**
 * Ask the card's agent for its closing note. Called after the session has been closed, so the session
 * is passed in rather than looked up. Returns as soon as the prompt is delivered — the poll loop
 * collects the note (see {@link WrapupCoordinator}).
 *
 * Never throws: this hangs off a status change the operator has already made, and a card that is
 * `done` must not become an error because its agent had wandered off.
 */
export async function requestWrapup(
  db: BoardDb,
  herdr: HerdrClient,
  session: CardSession,
  card: Card,
  sleep?: (ms: number) => Promise<void>,
): Promise<boolean> {
  if (!session.paneId || session.handoffRequestedAt !== null) return false;
  try {
    await promptAndConfirm(herdr, session.paneId, wrapupPrompt(card), sleep);
  } catch (err) {
    // Its OWN event, not the `wrapup.failed` a collection failure records, because the consequence
    // differs: a collection failure still clears the pending marker, so `autoCleanup` runs and the
    // checkout goes away. A request that never landed sets no marker at all — the coordinator never
    // hears about this card again, and the worktree stays behind with nothing said about it. The
    // card screen reads this event to say so and offer the tap that finishes the job.
    db.recordEvent(card.id, "wrapup.unasked", { sessionId: session.id, error: (err as Error).message });
    return false;
  }
  db.patchSession(session.id, { handoffRequestedAt: Date.now() });
  db.recordEvent(card.id, "wrapup.requested", { sessionId: session.id, paneId: session.paneId });
  return true;
}

/**
 * File a card as done: end its session, set the column, ask the agent for its closing note.
 *
 * One function because the ORDER is a rule, not a detail. The session closes before the status is
 * set, or the next poll reconciles the decision away (ADR 0002); the wrapup is asked for last,
 * against the session that just closed. Callers that need this are the manual "Done" and the
 * merge-and-done gesture, and they must not each rediscover the sequence.
 */
export function fileAsDone(db: BoardDb, herdr: HerdrClient, card: Card): void {
  const ending = db.openSessionFor(card.id);
  releaseSession(db, card.id, "done");
  db.setStatus(card.id, "done", "manual");
  if (ending?.paneId) void requestWrapup(db, herdr, ending, card);
}

/**
 * Collects wrapup notes whose agent has gone quiet. Driven by the same snapshot poll as everything
 * else — no new timer (the fork's rule), and the work is one file read per pending wrapup, of which
 * there is normally zero (plus one `git diff --numstat`, and only once a note is actually there).
 */
export class WrapupCoordinator {
  private readonly inFlight = new Set<string>();
  /** When each session's checkout was FIRST seen holding a note over nothing. See `collect`. */
  private readonly emptySince = new Map<string, number>();

  constructor(
    private readonly db: BoardDb,
    private readonly herdr: HerdrClient,
    private readonly now: () => number = Date.now,
    /** Injectable so a test can watch it get called without a real repo and a real herdr. */
    private readonly cleanup: typeof cleanupCard = cleanupCard,
    /** Injectable for the same reason — {@link probeCheckout} needs a checkout on disk. */
    private readonly probe: typeof probeCheckout = probeCheckout,
  ) {}

  /** Called on every successful poll. Never throws — a wrapup must not break the loop. */
  update(snap: EngineSnapshot): void {
    if (snap.bridge === "disconnected") return;
    const status = new Map([...snap.agents, ...snap.shellPanes].map((p) => [p.paneId, p.status]));

    for (const session of this.db.listPendingWrapups()) {
      if (this.inFlight.has(session.id) || !session.paneId) continue;

      // The agent never wrote it — refused, crashed, or the operator took the pane back for
      // something else. Clear the marker rather than letting it fire days from now.
      if (this.now() - session.handoffRequestedAt! > WRAPUP_DEADLINE_MS) {
        this.db.patchSession(session.id, { handoffRequestedAt: null });
        this.emptySince.delete(session.id);
        this.db.recordEvent(session.cardId, "wrapup.expired", { sessionId: session.id });
        void this.autoCleanup(session.cardId);
        continue;
      }
      if (this.now() - session.handoffRequestedAt! < WRAPUP_SETTLE_MS) continue;

      // `blocked` is not "finished": it is a question, and reading a half-written note would file
      // the wrong thing. `done` and `idle` both mean the turn is over. A pane that has VANISHED is
      // handled too — there is no note coming, so let the deadline close it out rather than
      // spinning; the operator closed the terminal, which is their right.
      const paneStatus = status.get(session.paneId);
      if (paneStatus !== "done" && paneStatus !== "idle") continue;

      this.inFlight.add(session.id);
      void this.collect(session).finally(() => this.inFlight.delete(session.id));
    }
  }

  private async collect(session: CardSession): Promise<void> {
    const card = this.db.getCard(session.cardId);
    if (!card) return;
    try {
      // No note yet: leave the marker and try again next tick, until the deadline gives up for us.
      // Pending, so nothing here has settled — no cleanup attempt yet either.
      const { note, empty } = await this.probe(card);
      if (note === null) return;
      // A note over a checkout that measures ZERO is, far more often than not, an agent that wrote
      // its report ahead of the commit the prompt asked for first. Collecting it now releases the
      // copilot onto a `(no changes)` diff for work that lands a second later. So hold, the same way
      // "no note yet" holds — and let go once the grace has passed, because a card really can end
      // with nothing to show and must still be filed.
      if (empty && !this.graceElapsed(session.id)) return;
      this.emptySince.delete(session.id);
      this.db.patchSession(session.id, { handoffMd: note, handoffRequestedAt: null });
      this.db.recordEvent(card.id, "wrapup.collected", {
        sessionId: session.id,
        noteChars: note.length,
      });
    } catch (err) {
      this.db.patchSession(session.id, { handoffRequestedAt: null });
      this.emptySince.delete(session.id);
      this.db.recordEvent(card.id, "wrapup.failed", { error: (err as Error).message });
    }
    // Reached only once the marker is actually cleared above — collected or failed, both mean the
    // wait is over.
    await this.autoCleanup(card.id);
  }

  /**
   * Tidy up on its own once a wrapup is no longer pending. Reuses `cleanupCard` itself, so it is
   * exactly as safe as the manual "Clean up worktree" tap: a branch that is neither merged nor
   * pushed, or a checkout with uncommitted work, refuses just the same and leaves the worktree for
   * the operator to deal with by hand. `keepWorktree` is the one thing that skips the attempt
   * outright — set once, ahead of the tap it otherwise replaces.
   */
  private async autoCleanup(cardId: string): Promise<void> {
    const card = this.db.getCard(cardId);
    if (!card || card.keepWorktree) return;
    await this.cleanup(this.db, this.herdr, card, {});
  }

  /** Whether an empty checkout has been empty long enough to be believed. Starts the clock. */
  private graceElapsed(sessionId: string): boolean {
    const since = this.emptySince.get(sessionId);
    if (since === undefined) {
      this.emptySince.set(sessionId, this.now());
      return false;
    }
    return this.now() - since >= EMPTY_DIFF_GRACE_MS;
  }
}

/**
 * What the coordinator needs to see in a card's checkout: the note the agent wrote, and whether the
 * checkout it wrote it in shows any work at all. One function because both answers come from the
 * same worktree lookup, and the diff is only worth measuring once a note exists — which is normally
 * never. `.board/` is already filtered out of a {@link diffStat}, so the note never counts as work.
 */
export async function probeCheckout(card: Card): Promise<{ note: string | null; empty: boolean }> {
  const empty = { note: null, empty: true };
  if (!card.repoPath || !card.branch) return empty;
  const checkout = await worktreePathFor(card.repoPath, card.branch);
  if (!checkout) return empty;
  const file = Bun.file(join(checkout, WRAPUP_REL_PATH));
  if (!(await file.exists())) return empty;
  const note = (await file.slice(0, MAX_WRAPUP_BYTES).text()).trim() || null;
  if (note === null) return empty;
  const stat = await diffStat(checkout, card.baseRef);
  return { note, empty: stat.files.length === 0 };
}
