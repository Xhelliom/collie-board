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
import { isLiveStatus, isPendingWrapup, type BoardDb, type Card, type CardSession, type CardStatus } from "./db.ts";
import { branchExists, ensureBoardExcluded, type GitRunner } from "./git.ts";
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

/**
 * A container card's status, derived from its children's. Urgency first, exactly like the board's
 * own column order: the point of a container is to answer "does anything under here need me?" in
 * one glance, so a single blocked child outranks three that are quietly working.
 *
 * `archived` children are excluded (archiving one is how you take it out of the reckoning), and a
 * container whose children are ALL archived derives nothing — `null` means "leave it alone".
 *
 * Pure + exported: this is the whole grammar of a container, and it is worth pinning in a test
 * rather than re-deriving it from a board that looks wrong.
 */
export function deriveParentStatus(children: readonly CardStatus[]): CardStatus | null {
  const live = children.filter((s) => s !== "archived");
  if (live.length === 0) return null;
  // An orphaned child sits with the blocked ones: both mean a human has to do something.
  if (live.some((s) => s === "blocked" || s === "orphaned")) return "blocked";
  if (live.some((s) => s === "review")) return "review";
  if (live.some((s) => s === "working" || s === "starting")) return "working";
  if (live.every((s) => s === "done")) return "done";
  return "backlog";
}

/**
 * Would pointing `cardId`'s `field` at `target` close a loop?
 *
 * The copilot cannot produce one (its indices only ever point backward), but a hand edit from the
 * API can, and a cycle here is not cosmetic: two cards each waiting on the other are two cards that
 * can never be started again, with no error to explain why. Walks the chain from the proposed
 * target; `seen` also catches a loop that somehow predates this edit, so the walk always terminates.
 */
export function wouldCycle(
  db: BoardDb,
  cardId: string,
  target: string | null,
  field: "dependsOn" | "parentId",
): boolean {
  const seen = new Set<string>();
  let cursor = target;
  while (cursor) {
    if (cursor === cardId || seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = db.getCard(cursor)?.[field] ?? null;
  }
  return false;
}

/** The runtime half of a card — read fresh from the snapshot, never stored. */
export interface CardRuntime {
  paneId: string;
  agent: string;
  agentStatus: AgentStatus;
  cwd: string;
  workspaceId: string;
  workspaceLabel: string;
  /** Mirrors AgentView's own naming fields, so `paneDisplayName()` can name the PANE, not just the card. */
  paneLabel?: string;
  sessionName?: string;
}

/** A card as the API serves it: durable fields, its open session, and live herd state. */
export interface CardView extends Card {
  /** The session currently running for this card, or null (backlog, done, orphaned…). */
  session: CardSession | null;
  /** Live pane state, or null when no pane backs this card right now. */
  runtime: CardRuntime | null;
  /** How many sessions this card has been through — the handoff chain's length. */
  sessionCount: number;
  /**
   * The copilot is rewriting or reviewing this card right now.
   *
   * Purely a display fact, and the whole point is what it rules out: a card sitting there as a bare
   * title looks exactly the same whether the copilot has it, is switched off, or died. Runtime only —
   * a restart cancels the work, and this forgets it in the same instant.
   */
  copilotBusy: boolean;
  /**
   * The card was filed done and its agent is still writing the closing report `WrapupCoordinator`
   * (wrapup.ts) is waiting to collect, into a checkout `cleanup` would delete out from under it.
   *
   * Exists so the UI can hold off "Clean up worktree" BEFORE the tap, not just refuse it after —
   * `session` is already null by this point (the session closed the instant the card was filed), so
   * without this the screen has nothing to show that a note is still in flight.
   */
  wrapupPending: boolean;
}

/** The card's most recent session, closed or not — for facts that outlive the session itself. */
export function lastSessionOf(db: BoardDb, cardId: string): CardSession | null {
  return db.listSessions(cardId).at(-1) ?? null;
}

function runtimeOf(pane: AgentView): CardRuntime {
  return {
    paneId: pane.paneId,
    agent: pane.agent,
    agentStatus: pane.status,
    cwd: pane.cwd,
    workspaceId: pane.workspaceId,
    workspaceLabel: pane.workspaceLabel,
    paneLabel: pane.paneLabel,
    sessionName: pane.sessionName,
  };
}

/**
 * Overlay the board-card fields onto the panes that back an open session — the same `branch`
 * `CardView`/`CardTile` carry, made available to the pane screen and the home list, which read
 * `AgentView` rather than `CardView` (UI_AUDIT.md G1/G2). A pane with no open session is returned
 * untouched; nothing here reads a transcript or shells out — it's a join against data reconciliation
 * already computed this tick.
 *
 * Context occupancy is NOT here: `ContextTracker.enrich()` puts it on every agent pane, card-backed
 * or not (G3), so reading it off the card session as well would be a second, staler source.
 *
 * Takes the open-session list rather than re-querying it, so a caller enriching both `agents` and
 * `shellPanes` off one snapshot (server.ts) pays for `listOpenSessions()` once, not twice.
 */
export function withCardFields(panes: AgentView[], sessions: CardSession[], db: BoardDb): AgentView[] {
  const open = sessions.filter((s) => s.paneId);
  if (open.length === 0) return panes;
  const byPane = new Map(open.map((s) => [s.paneId!, s]));
  return panes.map((p) => {
    const session = byPane.get(p.paneId);
    if (!session) return p;
    const card = db.getCard(session.cardId);
    return { ...p, branch: card?.branch ?? undefined, cardId: card?.id, cardTitle: card?.title, cardStatus: card?.status };
  });
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
  // REVIEW IS A LANDING, NOT A READING OF THE PANE. An agent that finished its turn reports `done`
  // for a moment and then `idle` for as long as it sits at its prompt, so mirroring `idle` bounces
  // the card straight back out of review — and then in again on the next turn, and out again. That
  // is not cosmetic: the copilot only ever reviews a card that IS in `review` on the tick it looks
  // (copilot.ts), so a card can finish its work and never be reviewed, with nothing to say so.
  // Real work takes it back out (the operator asked for more), and so does a question; sitting
  // quietly does not.
  if (card.status === "review" && pane.status === "idle") return null;
  const status = STATUS_COLUMN[pane.status];
  if (!status || status === card.status) return null;
  return { kind: "column", status };
}

/**
 * Close the card's open session when the operator moves it out of the live columns by hand.
 *
 * Without this a manual status never sticks: `setStatus` records no provenance, so the very next
 * poll reconciles the card back to whatever its pane is doing, and "Done" on a card whose agent is
 * still sitting there silently undoes itself a second later.
 *
 * The PANE IS LEFT ALONE, deliberately — closing a terminal is irreversible and can throw away
 * uncommitted work, and it must never be the side effect of moving a card between columns
 * (ADR 0002). The session row is a board fact; the pane belongs to the herd.
 */
export function releaseSession(db: BoardDb, cardId: string, status: CardStatus): void {
  if (isLiveStatus(status)) return;
  const session = db.openSessionFor(cardId);
  if (!session) return;
  // `done` for the one column that means the work is finished; `abandoned` for every other, which is
  // the same outcome a failed start already uses. ARCHIVED IS ABANDONED, not done: archiving a card
  // whose agent is still running is interrupting it, and recording that as a clean finish would make
  // the journal claim a completion that never happened.
  db.closeSession(session.id, status === "done" ? "done" : "abandoned");
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

  reconcileParents(db);
}

/**
 * Move every container card to whatever its children say. Runs in the same tick as the session
 * reconciliation and AFTER it, so a child that just changed column is already accounted for.
 *
 * A container has no pane of its own, so nothing else would ever move it — without this it would
 * sit in `backlog` while all its children finished.
 */
function reconcileParents(db: BoardDb): void {
  for (const [parentId, statuses] of db.childStatusesByParent()) {
    const parent = db.getCard(parentId);
    // An archived container is one you have put away on purpose — its children don't get to
    // resurrect it.
    if (!parent || parent.status === "archived") continue;
    const want = deriveParentStatus(statuses);
    if (want && want !== parent.status) db.setStatus(parentId, want, "derived from sub-tasks");
  }
}

/**
 * Assemble the API view of every card, merging in live snapshot state.
 *
 * `copilotBusy` is the coordinator's in-flight set, passed in rather than looked up so this stays a
 * pure function of (database, snapshot, runtime facts).
 */
export function cardViews(
  db: BoardDb,
  snap: EngineSnapshot,
  opts: { includeArchived?: boolean; copilotBusy?: ReadonlySet<string> } = {},
): CardView[] {
  const panes = panesById(snap);
  return db.listCards(opts).map((card) => {
    const session = db.openSessionFor(card.id);
    const pane = session?.paneId ? panes.get(session.paneId) : undefined;
    const sessions = db.listSessions(card.id);
    const last = sessions.at(-1);
    return {
      ...card,
      session,
      runtime: pane ? runtimeOf(pane) : null,
      sessionCount: sessions.length,
      copilotBusy: opts.copilotBusy?.has(card.id) ?? false,
      wrapupPending: last ? isPendingWrapup(last) : false,
    };
  });
}

/** One card's view, or null when the id is unknown. */
export function cardView(
  db: BoardDb,
  snap: EngineSnapshot,
  id: string,
  copilotBusy?: ReadonlySet<string>,
): CardView | null {
  const card = db.getCard(id);
  if (!card) return null;
  const session = db.openSessionFor(card.id);
  const pane = session?.paneId ? panesById(snap).get(session.paneId) : undefined;
  const sessions = db.listSessions(card.id);
  const last = sessions.at(-1);
  return {
    ...card,
    session,
    copilotBusy: copilotBusy?.has(card.id) ?? false,
    runtime: pane ? runtimeOf(pane) : null,
    sessionCount: sessions.length,
    wrapupPending: last ? isPendingWrapup(last) : false,
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
  /** The card holds sub-tasks; the work is in those, not in it. */
  | { kind: "container"; message: string }
  /** The card declares a predecessor that hasn't finished. A gate, NOT a queue — see below. */
  | { kind: "blocked-by"; message: string }
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
 * Is an agent already running in this pane?
 *
 * One `pane.get`, on an action path — never the poll loop. Any failure answers "no", which degrades
 * to the old behaviour (try to launch, and let herdr refuse); guessing "yes" on a broken read would
 * hand the card a session with nothing behind it.
 */
async function agentInPane(herdr: HerdrClient, paneId: string): Promise<string | null> {
  try {
    const pane = await herdr.getPane(paneId);
    return pane.agent?.trim() ? pane.agent : null;
  } catch {
    return null;
  }
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
 * Send a prompt and make sure it was actually RECEIVED. Two failures, both live-verified on herdr
 * 0.7.5 (2026-07-28), and neither of which the ack tells you about:
 *
 * 1. **The prompt is typed but not submitted.** A multi-line prompt lands in Claude Code's box as
 *    `[Pasted text #N +M lines]` and sits there; one `Enter` afterwards submits it untouched. Same
 *    class as the `send_text` + `send_keys` race HERDR_API.md documents — an ack means herdr took
 *    the bytes, never that the TUI acted on them.
 *
 * 2. **The prompt is swallowed whole by a first-run modal.** Claude Code asks "Is this a project you
 *    trust?" the first time it runs in a directory — and herdr reports `interactive_ready: true`
 *    while that dialog is up, so there is no state to wait for. The prompt text is eaten by the
 *    select and its Enter answers "Yes, I trust this folder". Nothing is typed, nothing runs, and
 *    the pane looks perfectly normal afterwards. This hits EVERY card, because every card gets a
 *    brand-new worktree directory, and it is silent.
 *
 * So: read the state back and look, the same rule `web/src/lib/reply-action.ts` applies to replies.
 * An agent that received a prompt is `working` (or `blocked`); one still `idle` did not.
 *
 * `firstAfterLaunch` enables the second re-send, and is set ONLY right after a launch — where the
 * modal can appear. Re-sending a follow-up whose turn merely finished inside the settle window
 * would make the agent do the work twice.
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
  opts: { firstAfterLaunch?: boolean } = {},
): Promise<void> {
  const status = async (): Promise<AgentStatus | undefined> => {
    try {
      return (await herdr.getAgent(paneId)).agent_status;
    } catch {
      return undefined;
    }
  };
  // "It landed" = the agent is doing something. `idle` after a prompt means it never saw it.
  const landed = (s: AgentStatus | undefined) => s === "working" || s === "blocked";

  await retryWhileNotReady(() => herdr.promptAgent({ target: paneId, text }), wait);
  await wait(PROMPT_SETTLE_MS);
  if (landed(await status())) return;

  // Either the text is sitting unsubmitted in the box, or a modal is in front of it. One Enter
  // covers both: it submits the draft, or it answers the modal.
  await herdr.sendPaneKeys(paneId, ["Enter"]);
  await wait(PROMPT_SETTLE_MS);
  if (landed(await status()) || !opts.firstAfterLaunch) return;

  // Still nothing, on the FIRST prompt after a launch — the text was swallowed whole. Re-send it
  // now that whatever ate it is gone. Only ever on a first prompt (see the header): re-sending a
  // follow-up whose turn merely finished fast would make the agent do the work twice.
  await retryWhileNotReady(() => herdr.promptAgent({ target: paneId, text }), wait);
  await wait(PROMPT_SETTLE_MS);
  if (!landed(await status())) {
    console.warn(`[board] pane ${paneId}: prompt did not take after two attempts`);
  }
}

export async function startCard(
  db: BoardDb,
  herdr: HerdrClient,
  cfg: Config,
  cardId: string,
  opts: { promptText?: string; sleep?: (ms: number) => Promise<void>; git?: GitRunner } = {},
): Promise<{ ok: true; value: StartResult } | { ok: false; error: StartError }> {
  const card = db.getCard(cardId);
  if (!card) return { ok: false, error: { kind: "herdr", message: "card not found" } };

  // A container's children hold the work. Starting it would cut a branch and a worktree for a card
  // nobody is going to write in, and then its derived status would fight the agent's.
  const children = db.listChildren(cardId);
  if (children.length > 0) {
    return {
      ok: false,
      error: {
        kind: "container",
        message: `this card holds ${children.length} sub-task${children.length === 1 ? "" : "s"} — start one of those`,
      },
    };
  }

  // THE DEPENDENCY IS A GATE, NOT A TRIGGER. Nothing here ever starts a card on its own: when a
  // predecessor finishes, its successor becomes startABLE, and you are the one who starts it. An
  // agent that launches itself writes code and spends quota with nobody watching, which is the one
  // thing this whole board is arranged against.
  const predecessor = card.dependsOn ? db.getCard(card.dependsOn) : null;
  if (predecessor && predecessor.status !== "done" && predecessor.status !== "archived") {
    return {
      ok: false,
      error: { kind: "blocked-by", message: `waiting on “${predecessor.title}” to finish first` },
    };
  }

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
  // The settings screen's number wins over the env default when it has been set — see
  // `BoardDb.maxAgents`. Read here rather than at boot, so raising it takes effect on the next tap
  // instead of on a bridge restart.
  const maxAgents = db.maxAgents() ?? cfg.boardMaxAgents;
  if (runningCards(db) >= maxAgents) {
    return {
      ok: false,
      error: {
        kind: "busy",
        message: `${maxAgents} agents already running — finish or hand one off first`,
      },
    };
  }

  const branch = card.branch ?? branchFromTitle(card.title, cfg.boardBranchPrefix);
  const kind = card.agentKind ?? cfg.boardAgentKind;

  // THE REAL HANDOFF BETWEEN TWO CARDS IS THE BRANCH. A task that follows another needs the code
  // the first one wrote, not a summary of it — so a dependent card forks from its predecessor's
  // branch rather than from the repo's base ref. Falls back to its own base when the predecessor
  // never actually ran (it has no branch), OR when it ran and its branch was since cleaned up
  // after merge — `card.branch` outlives the ref (see `branchExists`), and handing a deleted ref
  // to `worktree.create` as `base` fails immediately, before this even reaches herdr's retry path.
  const predecessorBranch =
    predecessor?.branch && (await branchExists(card.repoPath, predecessor.branch, opts.git))
      ? predecessor.branch
      : null;
  const base = predecessorBranch ?? card.baseRef;

  // Before the checkout exists, so the notes this bridge is about to write into it are invisible to
  // git from the first `status`. In `.git/info/exclude`, never the project's `.gitignore` — see
  // `ensureBoardExcluded`. Idempotent and best-effort: an unwritable .git is not a reason to refuse
  // to start a card.
  void ensureBoardExcluded(card.repoPath).catch(() => {});

  let worktree: CreatedWorktree;
  try {
    worktree = await herdr.createWorktree({
      cwd: card.repoPath,
      branch,
      base,
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
  // `baseRef` is persisted as RESOLVED, not as configured: it is also the left side of every diff
  // this card shows (git.ts), so leaving it at "main" after forking from a predecessor would make
  // the card's diff include the predecessor's work as if this agent had written it.
  db.patchCard(cardId, { branch, baseRef: base, workspaceId: worktree.workspaceId, agentKind: kind });
  db.recordEvent(cardId, "card.worktree", {
    branch,
    base,
    ...(predecessor ? { after: predecessor.title } : {}),
    path: worktree.checkoutPath,
    workspaceId: worktree.workspaceId,
    reused: worktree.alreadyOpen,
  });

  const session = db.openSession({ cardId, paneId: worktree.paneId, agentKind: kind });
  db.setStatus(cardId, "starting", "card started");

  // ADOPT AN AGENT THAT IS ALREADY THERE, rather than trying to launch a second one.
  //
  // Filing a card ends its SESSION, never its pane (ADR 0002) — so a card that was marked done and
  // is now being restarted still has its agent sitting in the worktree, holding the name. Launching
  // over it answers `agent_name_taken`, which is how this was found: a card that could not be
  // restarted to settle the merge conflict that was blocking it.
  //
  // Adopted WITHOUT a prompt: this agent already lived the task, and re-sending the spec would make
  // it start over. The card gets its session back and the operator says what happens next.
  const existing = await agentInPane(herdr, worktree.paneId);
  if (existing) {
    db.recordEvent(cardId, "card.agent_adopted", { paneId: worktree.paneId, agent: existing });
    db.setStatus(cardId, "working", "adopted the agent already in this worktree");
    return { ok: true, value: { card: db.getCard(cardId)!, session, worktree } };
  }

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

  // The other half of the warm start: the code is already in the branch, and this says so — plus
  // whatever the copilot made of the predecessor's work, which is the closest thing to a handoff
  // note that exists across two cards.
  const after = predecessor
    ? { title: predecessor.title, notes: db.listReviews(predecessor.id).at(-1)?.notes ?? null }
    : undefined;
  const text = opts.promptText ?? initialPrompt(card, after);
  try {
    // First prompt after a launch: a fresh worktree means Claude Code's trust dialog is up.
    await promptAndConfirm(herdr, worktree.paneId, text, opts.sleep ?? sleep, { firstAfterLaunch: true });
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
 *
 * `after` is the finished card this one follows. It matters more than it looks: the agent opens in
 * a worktree that ALREADY contains someone else's work, and an agent that believes it is on a
 * clean base will happily re-implement what is sitting next to it.
 */
export function initialPrompt(card: Card, after?: { title: string; notes: string | null }): string {
  const parts = [card.spec?.trim() || card.title.trim()];
  if (after) {
    parts.push(
      [
        `This task follows on from “${after.title}”, which is already finished. Its work is ALREADY`,
        "IN YOUR BRANCH — read the recent commits and the working tree before you start; you are not",
        "on a clean base.",
        ...(after.notes?.trim() ? ["", "How that work was reviewed:", after.notes.trim()] : []),
      ].join("\n"),
    );
  }
  if (card.acceptance.length > 0) {
    parts.push(
      ["Acceptance criteria — this task is done when all of these hold:", ...card.acceptance.map((a) => `- ${a}`)].join(
        "\n",
      ),
    );
  }
  return parts.join("\n\n");
}
