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

import type { Config } from "./config.ts";
import type { BoardDb, Card, CardSession, CardStatus } from "./db.ts";
import type { CreatedWorktree, HerdrClient } from "./herdr-client.ts";
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

// ── starting a card ───────────────────────────────────────────────────────────
//
// One call does the whole thing: `worktree.create` gives us a checkout, a workspace, a tab and a
// shell pane in a single RPC; `agent.start` turns that shell into an agent and waits for its TUI to
// be ready; `agent.prompt` hands it the spec. 1 card = 1 branch = 1 workspace, which is what makes
// the card's diff naturally scoped later on (git.ts) with no path bookkeeping at all.

/**
 * A git branch name from a card title. Git refuses a lot of things in a ref name (spaces, `..`, `~`,
 * `^`, `:`, `?`, `*`, `[`, `\`, a trailing `.` or `.lock`, a leading/trailing `/`), and a dictated
 * title contains most of them sooner or later — so this is a strict allowlist, not a blocklist.
 *
 * Pure + exported: this string ends up on disk as a directory name and in `git worktree add`, so
 * its edge cases are worth pinning down in a test rather than discovering from a shell error.
 */
export function branchFromTitle(title: string, prefix = "board/", max = 48): string {
  const slug = title
    .normalize("NFKD")
    // Drop combining marks so "réécrire" becomes "reecrire" rather than "r-crire".
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
  // An all-punctuation title slugs to nothing; a timestamp-free fallback would collide, so use the
  // card's own uniqueness instead (callers pass a suffix when they have one).
  return `${prefix}${slug || "card"}`;
}

/**
 * A herdr agent NAME from a branch. Live-verified constraint (0.7.5): `agent.start` rejects
 * anything that isn't `^[a-z][a-z0-9_-]{0,31}$` with `invalid_agent_name` — which a branch name
 * fails immediately, since it carries the `board/` prefix. So the slug after the last `/` is
 * sanitised again, more strictly, for this one field.
 *
 * Pure + exported: this is a server-side validation we can only satisfy by construction.
 */
export function agentNameFor(branch: string): string {
  const base = branch.split("/").pop() ?? branch;
  const name = base
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    // Must START with a letter — a branch like `2fa-login` would be rejected outright.
    .replace(/^[^a-z]+/, "")
    .slice(0, 32)
    .replace(/[-_]+$/, "");
  return name || "card";
}

/**
 * The start sequence races herdr twice, and both races are timing, not failure. Live-verified on
 * 0.7.5 with the identical call succeeding a second later:
 *
 *  - `agent.start` right after `worktree.create` → `agent_pane_busy: … is not an available shell`.
 *    The pane exists, but its shell is still sourcing its rc.
 *  - `agent.prompt` right after `agent.start` → `agent_not_ready: … is not an active named agent`.
 *    `agent.start` returns `interactive_ready: true`, yet the agent is not registered as a prompt
 *    target for another beat.
 *
 * So both calls retry on THOSE error codes and nothing else. A retry loop that swallows real
 * failures is worse than no retry loop — a bad agent kind must fail on the first attempt.
 *
 * Sized for the slow case: a fat zsh/bash rc, and a TUI that takes a moment to register.
 */
const HERDR_RETRY_ATTEMPTS = 6;
const HERDR_RETRY_BACKOFF_MS = 1000;

/** Herdr error codes that mean "not yet", as opposed to "no". */
const TRANSIENT_CODES = ["agent_pane_busy", "agent_not_ready"];

/**
 * How long to wait for a freshly launched agent's TUI to accept prompts.
 *
 * `agent.start` returns in milliseconds and does NOT wait (see herdr-client.ts) — the agent stays
 * `launch_pending` for seconds afterwards, and a prompt sent in that window is refused with
 * `agent_not_ready`. Claude Code cold-starts in ~2-4 s here; the budget is sized for a cold cache
 * and a slow disk.
 */
const AGENT_READY_TIMEOUT_MS = 60_000;
const AGENT_READY_POLL_MS = 1000;

/** How long to give a prompt to visibly land before we check whether it was submitted at all. */
const PROMPT_SETTLE_MS = 1500;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** True only for the two documented "not yet" codes above. Pure + exported for the test. */
export function isTransientHerdrError(err: unknown): boolean {
  return err instanceof Error && TRANSIENT_CODES.some((code) => err.message.includes(code));
}

/** Run `fn`, retrying while herdr says "not yet". Every other error propagates immediately. */
async function retryWhileNotReady<T>(fn: () => Promise<T>, wait: (ms: number) => Promise<void>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= HERDR_RETRY_ATTEMPTS || !isTransientHerdrError(err)) throw err;
      await wait(HERDR_RETRY_BACKOFF_MS);
    }
  }
}

/**
 * Block until a freshly started agent will accept a prompt, or throw.
 *
 * Polls `agent.get` for `interactive_ready`, because that is the only signal herdr gives that
 * `agent.prompt` won't be refused — `agent.start` returns long before it (live-probed 2026-07-28,
 * ~2 ms, `agent_status: "unknown"`, `launch_pending: true`). A read that fails mid-launch is
 * treated as "not ready yet" rather than fatal: the pane is being rewritten under us.
 */
export async function waitForAgentReady(
  herdr: HerdrClient,
  paneId: string,
  wait: (ms: number) => Promise<void> = sleep,
  budgetMs = AGENT_READY_TIMEOUT_MS,
): Promise<void> {
  const attempts = Math.max(1, Math.ceil(budgetMs / AGENT_READY_POLL_MS));
  for (let i = 0; i < attempts; i++) {
    try {
      const agent = await herdr.getAgent(paneId);
      if (agent.interactive_ready === true) return;
    } catch {
      // Mid-launch the pane may not resolve as an agent yet — keep waiting, not failing.
    }
    await wait(AGENT_READY_POLL_MS);
  }
  throw new Error(`agent did not become ready within ${Math.round(budgetMs / 1000)}s`);
}

/** Why a start attempt was refused, in the words the phone will show. */
export type StartError =
  | { kind: "no-repo"; message: string }
  | { kind: "busy"; message: string }
  | { kind: "already-running"; message: string }
  | { kind: "herdr"; message: string };

export interface StartResult {
  card: Card;
  session: CardSession;
  worktree: CreatedWorktree;
}

/**
 * How many cards currently hold a running agent. The semaphore is counted from the DATABASE, not
 * from a counter in memory: a bridge restart must not forget that three agents are already running.
 */
export function runningCards(db: BoardDb): number {
  return db.listOpenSessions().length;
}

/**
 * Start (or relaunch) a card: worktree → agent → prompt.
 *
 * Idempotent-ish by design. `worktree.create` fails when the checkout directory already exists
 * (live-verified — herdr surfaces git's own "existe déjà"), which is precisely the relaunch case,
 * so we fall back to `worktree.open`, which returns the live workspace with `already_open: true`.
 * That single fallback covers both "this card ran before and its pane died" and "someone opened the
 * worktree by hand in the TUI".
 *
 * `promptText` defaults to the card's spec. A relaunch passes the handoff instead (see handoff.ts).
 */

/**
 * Send a prompt and make sure it was actually SUBMITTED.
 *
 * ⚠️ Live-verified on herdr 0.7.5 (2026-07-28): `agent.prompt` does not reliably submit. A
 * multi-line prompt lands in Claude Code's input box as `[Pasted text #N +M lines]` and just SITS
 * there — a single `Enter` afterwards submits it untouched. This is the same class of race
 * HERDR_API.md already documents for `send_text` + `send_keys`: an ack means herdr took the bytes,
 * never that the TUI acted on them.
 *
 * So we do what `web/src/lib/reply-action.ts` does for replies — read the state back and look. A
 * prompt that landed drives the agent to `working` (or straight to `blocked` if it asks something);
 * an agent still sitting at `idle`/`done` after the settle window has a draft in its box, and gets
 * one `Enter`. That nudge is safe when we're wrong: Enter on an empty Claude prompt is a no-op.
 */

/**
 * Launch an agent in a pane and don't return until it will accept a prompt.
 *
 * Wraps the two herdr races this project keeps tripping over (see the TRANSIENT_CODES comment): the
 * pane's shell may still be sourcing its rc, and `agent.start` returns long before the agent is a
 * valid prompt target. Every caller that starts an agent must go through here — a direct
 * `startAgent` is how you get a pane with a shell prompt and no agent in it.
 */
export async function launchAgent(
  herdr: HerdrClient,
  paneId: string,
  kind: string,
  name: string,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<void> {
  await retryWhileNotReady(() => herdr.startAgent({ paneId, kind, name }), wait);
  await waitForAgentReady(herdr, paneId, wait);
}

export async function promptAndConfirm(
  herdr: HerdrClient,
  paneId: string,
  text: string,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<void> {
  await retryWhileNotReady(() => herdr.promptAgent({ target: paneId, text }), wait);
  await wait(PROMPT_SETTLE_MS);
  try {
    const agent = await herdr.getAgent(paneId);
    if (agent.agent_status === "working" || agent.agent_status === "blocked") return;
  } catch {
    // Can't tell — nudging is the cheaper mistake than a prompt that never runs.
  }
  await herdr.sendPaneKeys(paneId, ["Enter"]);
}

export async function startCard(
  db: BoardDb,
  herdr: HerdrClient,
  cfg: Config,
  cardId: string,
  opts: { promptText?: string; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ ok: true; value: StartResult } | { ok: false; error: StartError }> {
  const card = db.getCard(cardId);
  if (!card) return { ok: false, error: { kind: "herdr", message: "card not found" } };
  if (!card.repoPath) {
    return {
      ok: false,
      error: { kind: "no-repo", message: "set the card's repo path before starting it" },
    };
  }
  if (db.openSessionFor(cardId)) {
    return {
      ok: false,
      error: { kind: "already-running", message: "this card already has a session running" },
    };
  }
  if (runningCards(db) >= cfg.boardMaxAgents) {
    return {
      ok: false,
      error: {
        kind: "busy",
        message: `${cfg.boardMaxAgents} agents already running — finish or hand one off first`,
      },
    };
  }

  const branch = card.branch ?? branchFromTitle(card.title, cfg.boardBranchPrefix);
  const kind = card.agentKind ?? cfg.boardAgentKind;

  let worktree: CreatedWorktree;
  try {
    worktree = await herdr.createWorktree({
      cwd: card.repoPath,
      branch,
      base: card.baseRef,
      label: card.title.slice(0, 40),
    });
  } catch (createErr) {
    // The checkout already exists — the relaunch path. Open it instead; only if THAT fails too do
    // we report, and we report the create error, which is the one that names the real problem.
    try {
      worktree = await herdr.openWorktree({ cwd: card.repoPath, branch });
    } catch {
      return { ok: false, error: { kind: "herdr", message: (createErr as Error).message } };
    }
  }

  // Record the workspace BEFORE launching the agent: if agent.start times out, the card must still
  // remember which worktree it owns, or the next attempt would try to create it all over again.
  db.patchCard(cardId, { branch, workspaceId: worktree.workspaceId, agentKind: kind });
  db.recordEvent(cardId, "card.worktree", {
    branch,
    path: worktree.checkoutPath,
    workspaceId: worktree.workspaceId,
    reused: worktree.alreadyOpen,
  });

  const session = db.openSession({ cardId, paneId: worktree.paneId, agentKind: kind });
  db.setStatus(cardId, "starting", "card started");

  try {
    const wait = opts.sleep ?? sleep;
    await launchAgent(herdr, worktree.paneId, kind, agentNameFor(branch), wait);
  } catch (err) {
    // The agent never came up, so this session never existed in any meaningful sense — close it and
    // put the card back where it can be retried. Leaving it open would wedge the card: its pane is a
    // live SHELL, so reconciliation would never orphan it, and every retry would answer
    // "already running" forever. The worktree stays recorded, so the retry re-opens it rather than
    // rebuilding it, and lands on this very same shell pane.
    db.closeSession(session.id, "abandoned");
    db.setStatus(cardId, "ready", "agent failed to start");
    db.recordEvent(cardId, "card.start_failed", { stage: "agent.start", error: (err as Error).message });
    return { ok: false, error: { kind: "herdr", message: `agent.start: ${(err as Error).message}` } };
  }

  const text = opts.promptText ?? initialPrompt(card);
  try {
    await promptAndConfirm(herdr, worktree.paneId, text, opts.sleep ?? sleep);
    db.recordEvent(cardId, "card.prompted", { chars: text.length });
  } catch (err) {
    // The agent IS up; only the prompt failed. That's recoverable by hand (or by POST …/prompt), so
    // don't tear anything down — say so and keep the session.
    db.recordEvent(cardId, "card.start_failed", { stage: "agent.prompt", error: (err as Error).message });
    return {
      ok: false,
      error: { kind: "herdr", message: `agent started but the prompt failed: ${(err as Error).message}` },
    };
  }

  return { ok: true, value: { card: db.getCard(cardId)!, session, worktree } };
}

/**
 * The prompt a fresh card opens with. Spec first, acceptance criteria as an explicit checklist —
 * an agent that can see the acceptance criteria writes toward them. Pure + exported so the exact
 * text is reviewable in a test rather than only in a terminal.
 */
export function initialPrompt(card: Card): string {
  const parts = [card.spec?.trim() || card.title.trim()];
  if (card.acceptance.length > 0) {
    parts.push(
      ["Acceptance criteria — this task is done when all of these hold:", ...card.acceptance.map((a) => `- ${a}`)].join(
        "\n",
      ),
    );
  }
  return parts.join("\n\n");
}
