// Handoff — the sequence that makes a card outlive its sessions.
//
// A session dies when its context fills. The task doesn't. So the card carries the memory across:
// the outgoing agent writes down what it knows, the pane is replaced, and the incoming agent starts
// from that note plus the original spec. Three sessions later the card still tells the whole story.
//
// WHY IT IS ASYNCHRONOUS. The obvious implementation is `agent.prompt` with `wait: {until:["done"]}`
// and do the rest when it returns — but that turns one HTTP request into a multi-minute hold, over a
// phone link, on a screen the user will background. So the request only ASKS: it prompts the agent
// and stamps `session.handoff_requested_at`. The poll loop that already watches every pane finishes
// the job when the agent goes idle. The marker is a database column, not a field in memory, because
// a board whose entire premise is durable memory cannot lose a pending handoff to a restart.
//
// WHY IT IS NEVER AUTOMATIC. The context gauge can say "70 %", but only the operator knows whether
// the agent is three edits into a refactor. A handoff fired there costs more than it saves. The
// threshold nudges; the tap decides.

import { join } from "node:path";

import type { Config } from "./config.ts";
import { agentNameFor, launchAgent, promptAndConfirm } from "./cards.ts";
import type { BoardDb, Card, CardSession } from "./db.ts";
import { worktreePathFor } from "./git.ts";
import type { HerdrClient } from "./herdr-client.ts";
import type { EngineSnapshot } from "./state-engine.ts";

/** Where the outgoing agent writes its note, relative to the card's checkout. */
export const HANDOFF_REL_PATH = ".board/handoff.md";

/** Cap on the note we read back. A handoff is a page of prose; anything larger is a mistake. */
const MAX_HANDOFF_BYTES = 128 * 1024;

/**
 * How long a requested handoff may sit unfinished before we give up on it.
 *
 * The agent might refuse, crash, or block on a permission prompt instead of writing the file. The
 * marker must not outlive the situation that created it, or a card would try to complete a handoff
 * from three days ago the next time its agent happens to go idle.
 */
const HANDOFF_DEADLINE_MS = 30 * 60 * 1000;

/**
 * Grace period before a requested handoff is even considered finishable.
 *
 * The agent is `idle` at the instant we prompt it, and its status takes a poll or two to flip to
 * `working` — so without this the very next tick would see "idle, handoff requested" and swap the
 * pane out from under an agent that hasn't typed a character. Belt to the braces of "the note must
 * exist on disk" below.
 */
const HANDOFF_SETTLE_MS = 10_000;

/**
 * What the outgoing agent is asked to write.
 *
 * Prose, not a form. The expensive thing to lose in a session is not the file list — git has that —
 * it is WHY: the approach that was tried and abandoned, the constraint discovered halfway through,
 * the test that looks unrelated but isn't. So the instruction leads with decisions-and-why and asks
 * for a precise next step rather than a summary. Pure + exported so the wording is reviewable.
 */
export function handoffPrompt(): string {
  return [
    `Write a handoff note to ${HANDOFF_REL_PATH} (create the directory if needed), for the agent that`,
    "will pick this task up after you. Cover, in this order:",
    "",
    "1. Current state — what works now, what is half-done, what is untouched.",
    "2. Decisions taken AND WHY. This is the part that cannot be recovered from the diff.",
    "3. Files touched, with a word on what changed in each.",
    "4. The precise next step. Not 'continue the work' — the actual next thing to do.",
    "5. Traps: anything that cost you time and would cost the next agent the same.",
    "",
    "Write the file and nothing else. Do not summarise it back to me.",
  ].join("\n");
}

/**
 * What the incoming agent is opened with: the note, the original spec, and its acceptance criteria.
 * The note is referenced by PATH rather than pasted — the file is right there in its cwd, and
 * reading it is a cheaper, more reliable first move than trusting a paste to have survived. Pure +
 * exported.
 */
export function continuationPrompt(card: Card): string {
  const parts = [
    `You are continuing a task another agent was working on. Read ${HANDOFF_REL_PATH} first — it is`,
    "the previous agent's handoff note. Then carry on from the next step it names.",
    "",
    "The original task:",
    "",
    card.spec?.trim() || card.title.trim(),
  ];
  if (card.acceptance.length > 0) {
    parts.push(
      "",
      "Acceptance criteria — this task is done when all of these hold:",
      ...card.acceptance.map((a) => `- ${a}`),
    );
  }
  return parts.join("\n");
}

export type HandoffError =
  | { kind: "no-session"; message: string }
  | { kind: "already-requested"; message: string }
  | { kind: "herdr"; message: string };

/**
 * Ask the card's agent to write its handoff note. Returns as soon as the prompt is delivered — the
 * poll loop completes the rest (see {@link HandoffCoordinator}).
 */
export async function requestHandoff(
  db: BoardDb,
  herdr: HerdrClient,
  cardId: string,
  /** Injectable so the tests don't pay promptAndConfirm's settle window. */
  sleep?: (ms: number) => Promise<void>,
): Promise<{ ok: true; session: CardSession } | { ok: false; error: HandoffError }> {
  const session = db.openSessionFor(cardId);
  if (!session?.paneId) {
    return { ok: false, error: { kind: "no-session", message: "this card has no running agent" } };
  }
  if (session.handoffRequestedAt !== null) {
    return {
      ok: false,
      error: { kind: "already-requested", message: "a handoff is already in progress" },
    };
  }
  try {
    await promptAndConfirm(herdr, session.paneId, handoffPrompt(), sleep);
  } catch (err) {
    return { ok: false, error: { kind: "herdr", message: (err as Error).message } };
  }
  const updated = db.patchSession(session.id, { handoffRequestedAt: Date.now() })!;
  db.recordEvent(cardId, "handoff.requested", { sessionId: session.id, paneId: session.paneId });
  return { ok: true, session: updated };
}

/**
 * Finishes handoffs whose agent has gone quiet. Driven by the same snapshot poll as everything else.
 *
 * Re-entrancy is guarded per card rather than globally: completing one handoff takes seconds (a new
 * pane, an agent launch, a readiness wait) and the poll ticks far faster than that, so without this
 * a single handoff would be started a dozen times over.
 */
export class HandoffCoordinator {
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly db: BoardDb,
    private readonly herdr: HerdrClient,
    private readonly cfg: Config,
    private readonly now: () => number = Date.now,
  ) {}

  /** Called on every successful poll. Never throws — a handoff failure must not break the loop. */
  update(snap: EngineSnapshot): void {
    if (snap.bridge === "disconnected") return;
    const status = new Map([...snap.agents, ...snap.shellPanes].map((p) => [p.paneId, p.status]));

    for (const session of this.db.listOpenSessions()) {
      if (session.handoffRequestedAt === null || !session.paneId) continue;
      if (this.inFlight.has(session.cardId)) continue;

      // The agent never wrote it (refused, crashed, sat on a permission prompt). Clear the marker
      // rather than letting it fire days later, the next time this pane happens to go idle.
      if (this.now() - session.handoffRequestedAt > HANDOFF_DEADLINE_MS) {
        this.db.patchSession(session.id, { handoffRequestedAt: null });
        this.db.recordEvent(session.cardId, "handoff.expired", { sessionId: session.id });
        continue;
      }

      // Don't act on the idle state the agent was in when we prompted it.
      if (this.now() - session.handoffRequestedAt < HANDOFF_SETTLE_MS) continue;

      // `done` and `idle` both mean "the agent finished its turn". `blocked` does NOT — it is asking
      // a question, and closing its pane would throw the question away with it.
      const paneStatus = status.get(session.paneId);
      if (paneStatus !== "done" && paneStatus !== "idle") continue;

      this.inFlight.add(session.cardId);
      void this.complete(session).finally(() => this.inFlight.delete(session.cardId));
    }
  }

  private async complete(session: CardSession): Promise<void> {
    const db = this.db;
    const card = db.getCard(session.cardId);
    if (!card) return;

    if (!card.workspaceId) {
      // Nothing to open a fresh pane in. Clear the marker rather than retrying every tick forever.
      db.patchSession(session.id, { handoffRequestedAt: null });
      db.recordEvent(card.id, "handoff.failed", { error: "card has no workspace" });
      return;
    }

    try {
      // 1. The note on disk is the REAL "the agent has finished writing" signal — an agent status of
      //    idle only says it stopped talking. No note yet: leave the marker and try again next tick,
      //    until the deadline gives up for us.
      const note = await this.readNote(card);
      if (note === null) return;
      db.patchSession(session.id, { handoffMd: note, handoffRequestedAt: null });

      // 2. New pane FIRST, then close the old one. The other order risks taking the workspace down
      //    with its last pane, which would take the worktree's window with it.
      const created = await this.herdr.createTab(card.workspaceId, { label: card.title.slice(0, 40) });

      const oldPaneId = session.paneId!;
      db.closeSession(session.id, "handoff");
      try {
        await this.herdr.closePane(oldPaneId);
      } catch {
        // A pane that's already gone is the outcome we wanted anyway.
      }

      // 3. Chain a new session onto the card, then bring its agent up.
      const kind = card.agentKind ?? this.cfg.boardAgentKind;
      const next = db.openSession({ cardId: card.id, paneId: created.paneId, agentKind: kind });
      db.recordEvent(card.id, "handoff.completed", {
        from: session.id,
        to: next.id,
        paneId: created.paneId,
        noteChars: note?.length ?? 0,
      });

      await launchAgent(this.herdr, created.paneId, kind, agentNameFor(card.branch ?? card.title));
      await promptAndConfirm(this.herdr, created.paneId, continuationPrompt(card), undefined, {
        firstAfterLaunch: true,
      });
      db.setStatus(card.id, "working", "handed off to a fresh session");
    } catch (err) {
      // Whatever failed, the marker is cleared and the card keeps whatever session it has — the
      // operator can look at it, and reconciliation will orphan it if the pane really is gone.
      db.patchSession(session.id, { handoffRequestedAt: null });
      db.recordEvent(session.cardId, "handoff.failed", { error: (err as Error).message });
    }
  }

  /** The note the outgoing agent wrote, or null when it wrote none. */
  private async readNote(card: Card): Promise<string | null> {
    if (!card.repoPath || !card.branch) return null;
    const checkout = await worktreePathFor(card.repoPath, card.branch);
    if (!checkout) return null;
    try {
      const file = Bun.file(join(checkout, HANDOFF_REL_PATH));
      if (!(await file.exists())) return null;
      const text = await file.slice(0, MAX_HANDOFF_BYTES).text();
      return text.trim() || null;
    } catch {
      return null;
    }
  }
}
