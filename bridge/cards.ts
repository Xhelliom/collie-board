// Card lifecycle — where the durable board meets the ephemeral herd.
//
// THE CENTRAL RULE (see db.ts): `card` is durable, `session` is ephemeral. This module is the one
// place the two are reconciled, and it runs off the SAME snapshot poll Collie already does — no
// second source of truth, no event-sourcing, nothing to resync. Every tick:
//
//   1. an open session whose pane is gone → the session is `lost` and the card is `orphaned`
//      (relaunchable from its last handoff, never an error state);
//   2. a card with a live pane mirrors that pane's `agent_status` into its column, which is what
//      makes cards move on their own;
//   3. the pane's reported agent-session id is copied onto the session, so the transcript (and the
//      context gauge built on it) can be found later even after the pane dies.
//
// Nothing here writes runtime state INTO the database beyond those three facts: a card's live
// status, cwd and agent all still come from the snapshot on every read.

import type { BoardDb, Card, CardSession, CardStatus } from "./db.ts";
import type { EngineSnapshot } from "./state-engine.ts";
import type { AgentStatus, AgentView } from "./types.ts";

/**
 * How long after a session opens before its pane is allowed to be "missing".
 *
 * A card is started and its session recorded in the same breath as `worktree.create` returns, but
 * the snapshot that proves the pane exists is up to one poll interval behind. Without this window
 * the very next tick would orphan a card that started perfectly. It only ever DELAYS an orphaning,
 * never suppresses one.
 */
const ORPHAN_GRACE_MS = 15_000;

/** How Herdr's agent status maps onto a board column. `unknown` deliberately maps to nothing. */
const STATUS_COLUMN: Partial<Record<AgentStatus, CardStatus>> = {
  working: "working",
  // An idle agent is sitting at its prompt with the task still open — that is "in progress" on a
  // board, not "waiting for you". Herdr fires `blocked` when it actually wants an answer.
  idle: "working",
  blocked: "blocked",
  done: "review",
};

/** The runtime half of a card — read fresh from the snapshot, never stored. */
export interface CardRuntime {
  paneId: string;
  agent: string;
  agentStatus: AgentStatus;
  cwd: string;
  workspaceId: string;
  workspaceLabel: string;
}

/** A card as the API serves it: durable fields, its open session, and live herd state. */
export interface CardView extends Card {
  /** The session currently running for this card, or null (backlog, done, orphaned…). */
  session: CardSession | null;
  /** Live pane state, or null when no pane backs this card right now. */
  runtime: CardRuntime | null;
  /** How many sessions this card has been through — the handoff chain's length. */
  sessionCount: number;
}

function runtimeOf(pane: AgentView): CardRuntime {
  return {
    paneId: pane.paneId,
    agent: pane.agent,
    agentStatus: pane.status,
    cwd: pane.cwd,
    workspaceId: pane.workspaceId,
    workspaceLabel: pane.workspaceLabel,
  };
}

/** Index a snapshot's panes (agents AND bare shells) by pane id. */
export function panesById(snap: EngineSnapshot): Map<string, AgentView> {
  const map = new Map<string, AgentView>();
  for (const p of [...snap.agents, ...snap.shellPanes]) map.set(p.paneId, p);
  return map;
}

/**
 * Decide what a single open session's pane implies, without touching the database. Pure so the
 * whole reconciliation grammar — including the grace window and the "leave it alone" cases — is
 * unit-testable with plain objects.
 *
 * `null` means "nothing to do".
 */
export function reconcileOne(
  card: Card,
  session: CardSession,
  pane: AgentView | undefined,
  now: number,
): { kind: "orphan" } | { kind: "column"; status: CardStatus } | null {
  if (pane === undefined) {
    // Not yet visible in a snapshot taken moments after the start — give it one grace window.
    if (session.paneId === null) return null;
    if (now - session.startedAt < ORPHAN_GRACE_MS) return null;
    return card.status === "orphaned" ? null : { kind: "orphan" };
  }
  const status = STATUS_COLUMN[pane.status];
  if (!status || status === card.status) return null;
  return { kind: "column", status };
}

/**
 * Reconcile the whole board against one snapshot. Called from the state engine's update hook, so it
 * runs at exactly the poll cadence and nowhere else.
 *
 * A DISCONNECTED snapshot is ignored outright: its pane list is the last good one, not a current
 * one, and treating "the bridge lost Herdr" as "every pane vanished" would orphan the entire board
 * on a socket blip.
 */
export function reconcile(db: BoardDb, snap: EngineSnapshot, now: number = Date.now()): void {
  if (snap.bridge === "disconnected") return;
  const panes = panesById(snap);

  for (const session of db.listOpenSessions()) {
    const card = db.getCard(session.cardId);
    if (!card) continue;
    const pane = session.paneId ? panes.get(session.paneId) : undefined;

    // Copy the agent's own session id across as soon as Herdr reports one: the pane will die, the
    // transcript won't, and this is the only link between them.
    if (pane?.agentSessionId && pane.agentSessionId !== session.agentSessionId) {
      db.patchSession(session.id, { agentSessionId: pane.agentSessionId });
    }

    const action = reconcileOne(card, session, pane, now);
    if (!action) continue;
    if (action.kind === "orphan") {
      db.closeSession(session.id, "lost");
      db.setStatus(card.id, "orphaned", "pane vanished from snapshot");
    } else {
      db.setStatus(card.id, action.status, `agent ${pane?.status}`);
    }
  }
}

/** Assemble the API view of every card, merging in live snapshot state. */
export function cardViews(db: BoardDb, snap: EngineSnapshot, opts: { includeArchived?: boolean } = {}): CardView[] {
  const panes = panesById(snap);
  return db.listCards(opts).map((card) => {
    const session = db.openSessionFor(card.id);
    const pane = session?.paneId ? panes.get(session.paneId) : undefined;
    return {
      ...card,
      session,
      runtime: pane ? runtimeOf(pane) : null,
      sessionCount: db.listSessions(card.id).length,
    };
  });
}

/** One card's view, or null when the id is unknown. */
export function cardView(db: BoardDb, snap: EngineSnapshot, id: string): CardView | null {
  const card = db.getCard(id);
  if (!card) return null;
  const session = db.openSessionFor(card.id);
  const pane = session?.paneId ? panesById(snap).get(session.paneId) : undefined;
  return {
    ...card,
    session,
    runtime: pane ? runtimeOf(pane) : null,
    sessionCount: db.listSessions(card.id).length,
  };
}
