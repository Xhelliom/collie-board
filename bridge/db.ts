// The board's durable memory — the one thing Collie deliberately does not have.
//
// WHY A DATABASE AT ALL. Collie's state is an ephemeral mirror of Herdr: every tick re-reads the
// snapshot, nothing is persisted, and that is exactly right for "which agent needs me now". It is
// useless for "where is this task, and what happened in the three sessions before this one" — a
// pane dies, Herdr restarts, the laptop closes, and the intent is gone. So: `card` is DURABLE and
// `session` is EPHEMERAL. No runtime state is stored here — only intent and history. Every runtime
// fact (a pane's status, its cwd) still comes from the live snapshot, never from this file.
//
// bun:sqlite, raw SQL, no ORM: the schema is eight columns wide and the bridge's whole dependency
// story is "Bun + node:* and nothing else". Keep it that way.
//
// CONCURRENCY. One bridge process owns this file. WAL keeps a reader (a `GET /api/cards` mid-write)
// from blocking, and `busy_timeout` covers the sqlite-internal contention that remains.

import { BUILTIN_FLOWS } from "./flows.ts";
import { BUILTIN_TEMPLATES } from "./templates.ts";
import { parseHlc, type Hlc, type JournalEvent } from "./journal.ts";
import { chmodSync } from "node:fs";

import { Database } from "bun:sqlite";

/**
 * A card's lifecycle. `backlog`/`ready` are pre-work intent; `starting` … `review` track a live
 * agent; `done` is settled. `orphaned` is the one state the board assigns on its own — the card's
 * pane vanished from the snapshot (Herdr restarted, the pane was closed) — and it is a RELAUNCHABLE
 * state, not an error: the worktree and the last handoff are still on disk.
 */
export type CardStatus =
  | "backlog"
  | "ready"
  | "starting"
  | "working"
  | "blocked"
  | "review"
  | "done"
  | "orphaned"
  | "archived";

export const CARD_STATUSES: readonly CardStatus[] = [
  "backlog",
  "ready",
  "starting",
  "working",
  "blocked",
  "review",
  "done",
  "orphaned",
  "archived",
];

export function isCardStatus(v: unknown): v is CardStatus {
  return typeof v === "string" && (CARD_STATUSES as readonly string[]).includes(v);
}

/** Statuses that mean "an agent is supposed to be running for this card right now". */
const LIVE_STATUSES: readonly CardStatus[] = ["starting", "working", "blocked", "review"];

/**
 * The complement of {@link LIVE_STATUSES}: a column that says no agent is meant to be working. Moving
 * a card into one of these BY HAND is the operator ending the card's session, so it is also the test
 * the API uses to decide whether to close it (see ADR 0002).
 */
export function isLiveStatus(status: CardStatus): boolean {
  return LIVE_STATUSES.includes(status);
}

/**
 * Where a card came from, when it came from something other than a person — and the whole point of a
 * field rather than a boolean: `null` is not "unknown", it is "someone wrote this".
 *
 * Two writers open cards with nobody watching, and they are not the same writer: `copilot` is the
 * review filing its follow-ups (see {@link CardCategory}), `agent` is a working session that decided
 * mid-turn there was something to record. Same question — "why is this card here?" — different
 * answer, so a shared "auto" value would flatten the only thing worth reading.
 */
export type CardOrigin = "copilot" | "agent";

/** The origins, as a set to validate against. See {@link CardOrigin}. */
export const CARD_ORIGINS: readonly CardOrigin[] = ["copilot", "agent"];

/**
 * WHAT KIND of follow-up an automatic card is — the second axis {@link Card.tag} can't carry.
 *
 * A closed vocabulary, because the only thing this exists for is triage: `test` is the one that
 * piles up ("nobody has clicked through X yet") and `feature` is the one worth keeping, and a free
 * string would give you neither reliably. Set ONLY on cards with {@link Card.origin} — a card a
 * person wrote has no category at all, and `null` says exactly that.
 *
 * Narrower than `origin`, and deliberately: it is the REVIEW's classification of its own output, so
 * only `copilot` cards carry one. An `agent`-origin card has no category — the session filing it is
 * not answering a triage question, and the switches that consult this vocabulary
 * ({@link BoardDb.followUpCategories}) exist to throttle the review, not that session.
 *
 * ONE EXCEPTION: `explore` (ADR 0017, *Phases before the code*). It is not a triage verdict but what
 * the card asks for — a question to answer and cards to propose, not a diff — and the lead's check
 * branches on it. An exploration is usually typed by the operator, so `explore` alone may be
 * DECLARED at creation (see {@link DECLARABLE_CATEGORY}), by anyone, whatever the origin. Declaring
 * it says what the card is, never where it came from: `origin`/`originCardId` stay derived (ADR 0010).
 */
export type CardCategory = "test" | "feature" | "bug" | "docs" | "chore" | "explore";

/** The categories, in the order the prompt lists them. The single source of the vocabulary. */
export const CARD_CATEGORIES: readonly CardCategory[] = ["test", "feature", "bug", "docs", "chore", "explore"];

/** The one category a create body may carry — see {@link CardCategory}. */
export const DECLARABLE_CATEGORY = "explore" satisfies CardCategory;

export interface Card {
  id: string;
  title: string;
  /** Markdown spec — hand-written, or the copilot's reformulation of {@link rawInput}. */
  spec: string | null;
  /** The original brain dump (often dictated). Kept so a bad reformulation can be redone. */
  rawInput: string | null;
  /** Acceptance criteria, one per entry. Stored as a JSON array; exposed as a real array. */
  acceptance: string[];
  status: CardStatus;
  /** Repo the card works in. The worktree is created FROM here. */
  repoPath: string | null;
  /** Ref the branch forked from — also the left side of every diff for this card. */
  baseRef: string | null;
  branch: string | null;
  /** Herdr workspace holding the card's worktree. May go stale (Herdr restart) — never trusted blind. */
  workspaceId: string | null;
  agentKind: string | null;
  /**
   * The card this one was split out of, or null. PROVENANCE, not ordering: it says "these came from
   * the same brain dump", which is what lets the board show them together instead of as four
   * unrelated tiles. A card with children is a CONTAINER — it holds the original dictation and is
   * not startable; the work is in the children.
   */
  parentId: string | null;
  /**
   * A card the copilot judged this one to be a repeat of, or null.
   *
   * A SUGGESTION, never a verdict: it links, it does not merge, and it does not stop the card being
   * started. Clearing it is one tap, and that is the whole design — a false positive costs a tap, a
   * missed duplicate costs a second agent doing work that already exists.
   */
  duplicateOf: string | null;
  /**
   * The card that must finish before this one may start, or null. ORDERING, not provenance — and
   * deliberately one edge per card rather than a list: independent (null everywhere), serial (a
   * chain) and the realistic mixed case all fall out of the same nullable column, where a
   * two-mode "parallel or sequential" flag can only express the first two.
   */
  dependsOn: string | null;
  /**
   * Who WROTE this card, when the answer isn't "a person" — `copilot` or `agent` for a card that
   * appeared without anyone asking for it, null for every card someone sat down and made.
   *
   * A field and not a tag, deliberately (ADR 0005 — a card has exactly one tag, and it answers what
   * KIND of work this is). Provenance is a second axis: it never changes, it must not cost the card
   * the one tag it can carry, and a reserved word inside a vocabulary that is otherwise free text
   * would have to be defended from the one writer that invents tags.
   *
   * ONLY the unprompted paths set it — the review's follow-ups, and a session that filed a card
   * mid-turn (ADR 0010). A split does NOT: the copilot wrote those sentences, but from a dump you
   * dictated, while you watched, and `parentId` already says so. A card created through the API by
   * hand does not either — the mark is derived from the caller declaring a herdr pane, never from
   * the body, which is why it is absent from the create allowlist. Written once at creation and
   * never patched: a card doesn't change where it came from.
   */
  origin: CardOrigin | null;
  /**
   * The card this one came OUT of, or null — the reviewed card whose follow-ups this is one of, or,
   * for an `agent`-origin card, the card whose working session filed it.
   *
   * Distinct from {@link parentId} on purpose, and it is not a nicer name for it: a card with
   * children is a CONTAINER — not startable, and its column is derived from theirs. Filing a
   * follow-up under `parentId` would therefore stop the reviewed card being startable and drag its
   * status around behind its own follow-ups. This says only "here is where this came from".
   *
   * Written once at creation, never patched, and absent from the API's create allowlist — same rule
   * as {@link origin}. May dangle if the source card is deleted (like `duplicateOf`, and unlike
   * `parentId`/`dependsOn`, which `deleteCard` clears): it resolves to no source, which is exactly
   * the right degradation for a caption.
   */
  originCardId: string | null;
  /**
   * What kind of follow-up this is, for a card the copilot filed on its own — see
   * {@link CardCategory}. Null when {@link origin} is null — a person's card is not classified, it
   * is simply a card — EXCEPT `explore`, which anyone may declare at creation because it says what
   * the card asks for (a conclusion, not a diff), not why it appeared. Any other value still comes
   * only from the copilot.
   *
   * Like `origin`, written once at creation and unreachable from any PATCH: it describes why the
   * card appeared, and that doesn't change.
   */
  category: CardCategory | null;
  /**
   * ONE tag, or none. Free text, normalised by {@link normalizeTag} — the name IS the identity, so
   * "Bug", "bug " and "bug" are the same tag with the same colour everywhere.
   *
   * Deliberately singular, and deliberately a plain column rather than a join table. A tag here
   * answers "what kind of work is this" — a card is one kind of thing, and the phone screen it
   * renders on has room for one chip beside the title, not five. Multi-tag is the strictly larger
   * model: it can be reached later from this one (a `card_tag` table, this column its seed) without
   * ever having to un-invent it, whereas starting there buys a picker, a wrap rule and a "which of
   * the five colours is the card's colour" question that nothing currently asks.
   *
   * The colour is NOT stored: it is derived from the name (`tagHue()`, web side). Storing it would
   * be a second source of truth for a fact the name already determines, and the first hand edit that
   * missed it would give one tag two colours.
   */
  tag: string | null;
  /** Manual ordering within a column. */
  position: number;
  createdAt: number;
  updatedAt: number;
  /**
   * Opt out of automatic cleanup. Off by default — once a card's wrapup settles (collected or given
   * up on), `WrapupCoordinator` cleans up the worktree on its own, the same way the "Clean up
   * worktree" tap would, and just as safely refused if the branch is neither merged nor pushed.
   * This is the one flag that skips the attempt outright, for the branch the operator wants to poke
   * at afterwards.
   */
  keepWorktree: boolean;
  /**
   * This card's answer to the automatic handoff (auto-handoff.ts): `on` forces it, `off` refuses it,
   * null follows the board pref. A card whose agent leaves work running in the background wants
   * `off` — its pane reads idle while that work goes on, and a fresh session would close it.
   */
  autoHandoff: AutoHandoffChoice | null;
  /**
   * The run this card was handed over in, or null — ADR 0017. Membership is INTENT, so it is a
   * column; whether the run is still going is read from the cards' states, never stored.
   */
  runId: string | null;
  /** The phase this card belongs to, or null — ADR 0021. Intent, so a column. */
  phaseId: string | null;
  /** The agent template this card starts with, or null — ADR 0026. Falls back to its phase's. */
  templateId: string | null;
  /** The flow this card goes through, or null — ADR 0032. Falls back to its phase's, then its repo's. */
  pipelineId: string | null;
  /** A peer's environment this card launches in, or null for this machine — ADR 0046 §4. Intent, so a column. */
  environment: CardEnvironment | null;
  /**
   * The git identity (`user.email`) of the pair that created this card, on a shared board — ADR 0048
   * §5. Derived like {@link origin}, never declared: out of every allowlist, written once by
   * `createCard`. Null on an unshared repo, and on every card that existed before (nobody knows who).
   */
  createdBy: string | null;
  /** Who this card is meant for, as a git identity — an intention, not a right (ADR 0048 §5). */
  assignee: string | null;
  /**
   * The last `card.claimed` of a shared card (ADR 0048 §7): the pair that pushed it, its git identity
   * and when. Only ever written by applying the journal — a claim exists once the remote took it.
   */
  claim: CardClaim | null;
  /** The card's manual test (« recette »), in order — written by its agent, the orchestrator or the operator. */
  manualChecks: ManualCheck[];
  /** What the user can now DO, in their words — the recette's title. Null: the card's title. */
  capability: string | null;
  /** The use this capability serves (« Travailler à deux ») — the recette groups by it. */
  usageGroup: string | null;
  /**
   * The operator's verdict per step id. A column of its own, apart from {@link manualChecks}, so an
   * agent rewriting its steps and the operator ticking them never overwrite each other in the
   * journal's last-write-wins (ADR 0048 §2). A verdict whose step is gone is simply not shown.
   */
  checkVerdicts: Record<string, CheckVerdict>;
}

/** A pair's reservation of a shared card — see {@link Card.claim}. */
export interface CardClaim {
  pair: string;
  by: string;
  at: number;
}

/** One step of a recette: one line, verb + where + what to expect. `shot` names a deliverable of the card. */
export interface ManualCheck {
  id: string;
  text: string;
  expected?: string;
  shot?: string;
}

export const CHECK_STATUSES = ["ok", "ko", "skip"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

/** `by` is derived by the bridge (the pair's git identity on a shared repo, else `operator`), never read from a body. */
export interface CheckVerdict {
  status: CheckStatus;
  by: string;
  at: number;
  note?: string;
}

/** A named environment on a paired peer (`peers.toml`): the peer resolves the path, never this machine. */
export interface CardEnvironment {
  peer: string;
  name: string;
}

export type AutoHandoffChoice = "on" | "off";

/** Every way a session can end — a value, so the web's labels are checked against it (sessions.test.ts). */
export const SESSION_OUTCOMES = ["handoff", "done", "abandoned", "lost", "pipeline"] as const;
export type SessionOutcome = (typeof SESSION_OUTCOMES)[number];

export interface CardSession {
  id: string;
  cardId: string;
  /** Herdr pane id — EPHEMERAL. Its absence from the snapshot is what orphans a card. */
  paneId: string | null;
  /** The agent's own session id (Claude's transcript uuid), when it reported one. */
  agentSessionId: string | null;
  agentKind: string | null;
  ctxTokens: number | null;
  ctxPct: number | null;
  handoffMd: string | null;
  outcome: SessionOutcome | null;
  /**
   * When a handoff was asked for, or null. The handoff can't complete synchronously — the agent has
   * to finish writing `.board/handoff.md` first — so this is the marker the poll loop looks for.
   */
  handoffRequestedAt: number | null;
  /**
   * The automatic handoff taken before the prompt cache expires (auto-handoff.ts), in two phases.
   * With `handoffMd` null: asked for at this instant, note not in yet. With `handoffMd` set: the
   * note is stored and on offer, and this is when it was stored — the last time the conversation
   * touched the cache. Null: nothing outstanding.
   */
  autoHandoffAt: number | null;
  startedAt: number;
  endedAt: number | null;
}

/**
 * A wrapup pending on this session?
 *
 * A CLOSED session still asking for a note means exactly one thing, and nothing else can produce it:
 * `requestHandoff` refuses a card with no OPEN session, and the handoff coordinator clears the marker
 * in the same breath as it closes one. Checked here rather than stored as a second column, so no
 * migration and no third state to keep consistent.
 */
export function isPendingWrapup(session: CardSession): boolean {
  return session.endedAt !== null && session.handoffRequestedAt !== null;
}

/** Claude Code's prompt cache lifetime: a turn later than this reloads the whole conversation. */
export const PROMPT_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * The board's own handoff prompt is running in this session's pane. While it is, the pane's status
 * changes are the board speaking, not the agent — reconcile() leaves the column alone and the herd's
 * notifications skip them.
 */
export function isAutoHandoffPending(session: CardSession): boolean {
  return session.autoHandoffAt !== null && session.handoffMd === null;
}

/** A stored automatic handoff is on offer, and the cache it was written to save has gone cold. */
export function isAutoHandoffOffered(session: CardSession, now: number): boolean {
  return (
    session.autoHandoffAt !== null &&
    session.handoffMd !== null &&
    now - session.autoHandoffAt >= PROMPT_CACHE_TTL_MS
  );
}

/** A review-suggested follow-up, and the card it became — `cardId` is null only for data written
 *  before this linked (bare titles, no card to point at). */
/**
 * TOO SMALL FOR A CARD — a follow-up the review suggested and deliberately did NOT file, kept here
 * instead, with what it takes to act on it.
 *
 * The criterion is written once, in `isTinyFollowUp()` (copilot.ts). The reason this lives on the
 * review rather than on a card of its own is the whole point: "note in NOTIFY_AUDIT.md that step 1
 * landed" is one line, and a card for it is a card you triage, filter, drag and eventually delete —
 * a chore invented by the tool. The review row IS the right place: it is on the screen of the card
 * whose agent would do it, at the moment you read the verdict, while that agent is still at its
 * prompt.
 */
export interface TinyTodo {
  /** Everything the agent is told to do — the same spec the card would have carried. */
  spec: string | null;
  acceptance: string[];
  /** When it was handed to the agent, or null while it is still on offer. Set once, never cleared. */
  doneAt: number | null;
}

export interface ReviewTodo {
  title: string;
  cardId: string | null;
  /**
   * Present exactly when this suggestion was judged too small to be filed — see {@link TinyTodo}.
   * Mutually exclusive with `cardId` by construction: one of the two is how the suggestion exists.
   */
  tiny?: TinyTodo;
}

export interface Review {
  id: string;
  cardId: string;
  sessionId: string | null;
  verdict: string | null;
  notes: string | null;
  todos: ReviewTodo[];
  createdAt: number;
}

/**
 * A run's durable half — ADR 0017: the set of cards of one repo the operator handed over in one
 * gesture. Only what the gesture decided lives here; which worker is alive, which card the lead is
 * on, whether the run is over — all read from the snapshot and the cards, so a restart resumes.
 */
/** A lot's parallelism ceiling: a whole number from 1 (sequential) to this. */
export const MAX_PARALLEL_CAP = 16;
export const isMaxParallel = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAX_PARALLEL_CAP;

export interface Run {
  id: string;
  repoPath: string;
  createdAt: number;
  /** How many follow-ups the lead may fold into the run. Past it, a follow-up is a card for later. */
  foldInCap: number;
  /**
   * The agent kind asked for the lead. Recorded, not acted on: the lead pane is one for every run and
   * runs cfg.boardCopilotKind (run.ts). Kept because `POST /api/runs` and the run sheet expose it.
   */
  leadAgent: string | null;
  /** The phase this lot belongs to, or null — ADR 0021. */
  phaseId: string | null;
  /**
   * How many of this lot's cards may run at once, or null for the board's own cap only. 1 is
   * sequential. The planner sets it — it knows which cards touch the same files.
   */
  maxParallel: number | null;
  /** The lot's name; null for a run made with the old gesture. */
  name: string | null;
  position: number;
  /**
   * When the operator launched it. Null is a PLANNED lot: it holds its cards and drives nothing
   * (the coordinator reads `listOpenRuns`, which skips it). Launching is the operator's gesture.
   */
  launchedAt: number | null;
  /**
   * `card` (default): every card opens its own PR. `lot`: the cards fold into one lot branch and the
   * lot opens ONE PR — ADR 0041. Set while the lot is planned.
   */
  integration: Integration;
  /** The lot branch and the base it was cut from, written when the first card starts (`lot` only). */
  lotBranch: string | null;
  lotBase: string | null;
  /**
   * Shared repo only (ADR 0048 §7): who created the lot — its git identity, and the pair (machine) it
   * was created on. Derived at creation, never declared. Only that pair launches, resumes and drives it.
   */
  createdBy: string | null;
  createdPair: string | null;
}

export type Integration = "card" | "lot";
/**
 * A PLANNED lot whose cards were all done without it (by hand, or in another run): it is over, never
 * offered for launch. Derived from the cards, not stored. Pure.
 */
export const doneOutsideLot = (run: Pick<Run, "launchedAt">, members: readonly Pick<Card, "status">[]): boolean =>
  run.launchedAt === null && members.length > 0 && members.every((c) => c.status === "done");
/** How a run lands a card of a repo (ADR 0043). The operator's setting; "pr" when unset. */
export type RepoIntegration = "pr" | "direct";
export const isIntegration = (v: unknown): v is Integration => v === "card" || v === "lot";

/** A phase — ADR 0021. Not a container: it groups cards, it doesn't split one. Progress is derived. */
export interface Phase {
  id: string;
  repoPath: string;
  name: string;
  goal: string;
  position: number;
  /** The roadmap item this phase materialised, or null. */
  roadmapItemId: string | null;
  /** When the operator validated it (ADR 0025), or null while it is the work in progress. A validated phase is a milestone. */
  closedAt: number | null;
  closedNote: string;
  /** The agent template the phase's cards start with unless they name their own (ADR 0026). */
  templateId: string | null;
  /** The flow the phase's cards go through unless they name their own (ADR 0032). */
  pipelineId: string | null;
  createdAt: number;
  updatedAt: number;
}

export const PHASE_NOTE_MAX = 1000;

/** A role for a worker — ADR 0026. `key` is set on the shipped ones, which can be edited and reset but not deleted. */
/** A named pipeline (ADR 0032): the ordered roles a card goes through. */
export interface AgentFlow {
  id: string;
  key: string | null;
  name: string;
  description: string;
  /** Template ids, in order. */
  steps: string[];
  builtin: boolean;
  createdAt: number;
  updatedAt: number;
}

interface FlowRow {
  id: string;
  key: string | null;
  name: string;
  description: string;
  steps: string;
  builtin: number;
  created_at: number;
  updated_at: number;
}

function toFlow(r: FlowRow): AgentFlow {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    steps: jsonArray(r.steps),
    builtin: r.builtin === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface AgentTemplate {
  id: string;
  key: string | null;
  name: string;
  description: string;
  /** The agent kind it runs on, or null for the board's default. */
  agentKind: string | null;
  /** One model word, or null; reaches the CLI only for a kind with a verified `modelFlag`. */
  model: string | null;
  brief: string;
  /** This role writes the code: corrections asked of a card go back to the nearest one (ADR 0031). */
  worker: boolean;
  builtin: boolean;
  createdAt: number;
  updatedAt: number;
}

interface TemplateRow {
  id: string;
  key: string | null;
  name: string;
  description: string;
  agent_kind: string | null;
  model: string | null;
  brief: string;
  worker: number;
  builtin: number;
  created_at: number;
  updated_at: number;
}

function toTemplate(r: TemplateRow): AgentTemplate {
  return {
    id: r.id,
    key: r.key ?? null,
    name: r.name,
    description: r.description,
    agentKind: r.agent_kind ?? null,
    model: r.model ?? null,
    brief: r.brief,
    worker: r.worker === 1,
    builtin: r.builtin === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const ROADMAP_STATUSES = ["planned", "active", "done", "dropped"] as const;
export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];

/** An intent, never a card — it becomes a phase when the operator gets to it. */
export interface RoadmapItem {
  id: string;
  name: string;
  goal: string;
  status: RoadmapStatus;
  /** The phase's long form, Markdown: objective, end-of-phase demo, risks, why in this order (ADR 0023). */
  detail: string;
}

/** ✅ decided · 🟡 a leaning to confirm · ❓ an open question — the three statuses of a design journal (ADR 0023). */
export const DECISION_STATUSES = ["decided", "leaning", "open"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

/** One line of the project's decision journal. Written at the moment it is taken, never reconstructed. */
export interface Decision {
  id: string;
  text: string;
  status: DecisionStatus;
  /** The roadmap item it concerns, or null for the project as a whole. */
  itemId: string | null;
  /** The card it is about (absent: none). Open, it is "the orchestrator waits on you" on that card. */
  cardId?: string;
}

/** The ceilings a roadmap document keeps to — an unbounded one would be an unbounded row. */
export const ROADMAP_MAX_DECISIONS = 300;

/** The orchestrator's own note to its next self (ADR 0023): short, one per repo, last writer wins. */
export const MEMORY_MAX_CHARS = 4_000;
export interface OrchestratorMemory {
  repoPath: string;
  note: string;
  updatedAt: number;
}

/** One repo's roadmap. `revision` is the optimistic lock: a write carries the one it read. */
export interface Roadmap {
  repoPath: string;
  vision: string;
  items: RoadmapItem[];
  decisions: Decision[];
  revision: number;
  updatedAt: number;
}

/** A write that carried a revision other than the current one. */
export class RevisionConflict extends Error {
  constructor(readonly current: number) {
    super(`roadmap is at revision ${current}`);
  }
}

/**
 * What the lead may decide about a card, written with its reason. `finished` / `prompt` answer the
 * check (and the conflict re-check); `keep` / `fold` / `drop` the triage — a kept or folded
 * follow-up carries the decision on its OWN journal, a dropped one on the reviewed card's, since it
 * is deleted. `wait` is the coordinator's own, once per run: a dependent held back until its
 * predecessor's armed auto-merge has landed (ADR 0036).
 */
export type LeadDecision = "finished" | "prompt" | "keep" | "fold" | "drop" | "wait";

/** The `run.*` journal kinds and their payloads — the single source of both. */
export interface RunEventPayloads {
  "run.decision": {
    runId: string;
    decision: LeadDecision;
    reason: string;
    /** `prompt` only. */
    prompt?: string;
    /** `drop` only: the deleted follow-up's title. */
    followUp?: string;
    /** A send-back for a red GitHub check: its name. */
    ci?: string;
  };
  /** The lead read the review's verdict with the code. Once per card: it is also the triage's marker. */
  "run.triaged": { runId: string; verdict: string | null; accept: boolean; reason: string };
  /** Every member is filed. Journaled with a null card: it is the run's, not one card's. */
  "run.finished": { runId: string };
  /** On the card that needs the operator. */
  /** `leadSilent`: the lead wrote no answer (LeadSilent); `paneId` is its pane, which the journal links to. */
  /** `infra`: a red check with nothing to fix in the code — the land step keeps asking GitHub (ADR 0041). */
  "run.halted": { runId: string; reason: string; leadSilent?: true; paneId?: string; infra?: true };
  /** The operator resumed the run: every halt before it is lifted, and the card picks up at the step it stopped on. */
  "run.resumed": { runId: string };
  /** The repo's gate ran on a landing (ADR 0020). Its absence after a landing is what makes the gate the next step. */
  "run.gate": { runId: string; command: string; ok: boolean; summary?: string };
  /** The board's own merge, when GitHub's auto-merge was not there (ADR 0027): done or not, and why. */
  "run.merge": { runId: string; merged: boolean; reason: string; wait?: boolean; conflict?: boolean; ci?: { name: string; log: string } };
}

export type RunEventKind = keyof RunEventPayloads;

export const RUN_EVENT_KINDS: readonly RunEventKind[] = [
  "run.decision",
  "run.triaged",
  "run.finished",
  "run.halted",
  "run.resumed",
  "run.gate",
  "run.merge",
];

/** The lead's send-backs before the operator, when the repo's operator has not set it (run.ts). */
export const DEFAULT_MAX_ROUNDS = 5;
export const MAX_ROUNDS_LIMIT = 15;

/** The orchestrator's per-repo autonomy (ADR 0030). `maxChain` null: unlimited. */
export interface RepoAutonomy {
  enabled: boolean;
  maxChain: number | null;
  stopOnRed: boolean;
  chained: number;
  armed: boolean;
  /** ADR 0047: it may also start a planned lot when none of the repo's lots is running. */
  startWhenIdle: boolean;
  /** How many times the lead may send a worker back before the card goes to the operator. */
  maxRounds: number;
}

export interface BoardEvent {
  id: number;
  cardId: string | null;
  type: string;
  payload: unknown;
  ts: number;
}

// ── row shapes (snake_case, exactly as stored) ────────────────────────────────

interface CardRow {
  id: string;
  title: string;
  spec: string | null;
  raw_input: string | null;
  acceptance: string | null;
  status: string;
  repo_path: string | null;
  base_ref: string | null;
  branch: string | null;
  workspace_id: string | null;
  agent_kind: string | null;
  parent_id: string | null;
  duplicate_of: string | null;
  depends_on: string | null;
  origin: string | null;
  origin_card_id: string | null;
  category: string | null;
  tag: string | null;
  position: number;
  created_at: number;
  updated_at: number;
  keep_worktree: number;
  auto_handoff: string | null;
  run_id: string | null;
  phase_id: string | null;
  template_id: string | null;
  pipeline_id: string | null;
  environment: string | null;
  created_by: string | null;
  assignee: string | null;
  claimed_pair: string | null;
  claimed_by: string | null;
  claimed_at: number | null;
  manual_checks: string | null;
  capability: string | null;
  usage_group: string | null;
  check_verdicts: string | null;
}

interface RunRow {
  id: string;
  repo_path: string;
  created_at: number;
  fold_in_cap: number;
  lead_agent: string | null;
  phase_id: string | null;
  name: string | null;
  position: number;
  launched_at: number | null;
  max_parallel: number | null;
  integration: string | null;
  lot_branch: string | null;
  lot_base: string | null;
  created_by: string | null;
  created_pair: string | null;
}

function toRun(r: RunRow): Run {
  return {
    id: r.id,
    repoPath: r.repo_path,
    createdAt: r.created_at,
    foldInCap: r.fold_in_cap,
    leadAgent: r.lead_agent,
    phaseId: r.phase_id ?? null,
    name: r.name ?? null,
    position: r.position ?? 0,
    launchedAt: r.launched_at ?? null,
    maxParallel: r.max_parallel ?? null,
    integration: r.integration === "lot" ? "lot" : "card",
    lotBranch: r.lot_branch ?? null,
    lotBase: r.lot_base ?? null,
    createdBy: r.created_by ?? null,
    createdPair: r.created_pair ?? null,
  };
}

interface PhaseRow {
  id: string;
  repo_path: string;
  name: string;
  goal: string;
  position: number;
  roadmap_item_id: string | null;
  closed_at: number | null;
  closed_note: string | null;
  template_id: string | null;
  pipeline_id: string | null;
  created_at: number;
  updated_at: number;
}

function toPhase(r: PhaseRow): Phase {
  return {
    id: r.id,
    repoPath: r.repo_path,
    name: r.name,
    goal: r.goal,
    position: r.position,
    roadmapItemId: r.roadmap_item_id ?? null,
    closedAt: r.closed_at ?? null,
    closedNote: r.closed_note ?? "",
    templateId: r.template_id ?? null,
    pipelineId: r.pipeline_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface RoadmapRow {
  repo_path: string;
  vision: string;
  items: string;
  decisions: string | null;
  revision: number;
  updated_at: number;
}

/** A JSON column we wrote is always valid; an unreadable one reads as an empty list, not a crash. */
function jsonList<T>(raw: string | null): T[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function toRoadmap(r: RoadmapRow): Roadmap {
  // A row from before ADR 0023 has no `detail` on its items: it reads as empty.
  const items = jsonList<RoadmapItem>(r.items).map((i) => ({ ...i, detail: i.detail ?? "" }));
  return {
    repoPath: r.repo_path,
    vision: r.vision,
    items,
    decisions: jsonList<Decision>(r.decisions).map((d) => ({ ...d, itemId: d.itemId ?? null })),
    revision: r.revision,
    updatedAt: r.updated_at,
  };
}

interface SessionRow {
  id: string;
  card_id: string;
  pane_id: string | null;
  agent_session_id: string | null;
  agent_kind: string | null;
  ctx_tokens: number | null;
  ctx_pct: number | null;
  handoff_md: string | null;
  outcome: string | null;
  handoff_requested_at: number | null;
  auto_handoff_at: number | null;
  started_at: number;
  ended_at: number | null;
}

interface ReviewRow {
  id: string;
  card_id: string;
  session_id: string | null;
  verdict: string | null;
  notes: string | null;
  todos: string | null;
  created_at: number;
}

interface EventRow {
  id: number;
  card_id: string | null;
  type: string;
  payload: string | null;
  ts: number;
}

/**
 * Decode a JSON-array column. Defensive on purpose: these columns are written by the copilot's
 * output and by API bodies, and a malformed value must degrade to "empty list", never throw inside
 * a `GET /api/cards` that would then take the whole board down.
 */
/** A column the journal may have filled from another pair: anything malformed reads as empty, never throws. */
function jsonValue(raw: string | null): unknown {
  try {
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function parseManualChecks(raw: string | null): ManualCheck[] {
  const v = jsonValue(raw);
  if (!Array.isArray(v)) return [];
  return v.filter((c): c is ManualCheck => typeof c?.id === "string" && typeof c?.text === "string");
}

function parseVerdicts(raw: string | null): Record<string, CheckVerdict> {
  const v = jsonValue(raw);
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  return Object.fromEntries(
    Object.entries(v).filter(([, x]) => CHECK_STATUSES.includes(x?.status) && typeof x?.by === "string" && typeof x?.at === "number"),
  );
}

function jsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Decode `review.todos`. Accepts a bare title (data written before cards were linked) alongside
 *  the `{title, cardId}` shape, same tolerance `toSplit` gives a degraded model answer. */
function jsonReviewTodos(raw: string | null): ReviewTodo[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: ReviewTodo[] = [];
  for (const v of parsed) {
    if (typeof v === "string" && v.trim()) {
      out.push({ title: v.trim(), cardId: null });
    } else if (v && typeof v === "object" && typeof (v as { title?: unknown }).title === "string") {
      const o = v as { title: string; cardId?: unknown; tiny?: unknown };
      const tiny = o.tiny && typeof o.tiny === "object" ? (o.tiny as Record<string, unknown>) : null;
      out.push({
        title: o.title,
        cardId: typeof o.cardId === "string" ? o.cardId : null,
        // A malformed `tiny` degrades to "an ordinary suggestion that was never filed", which is
        // what the row already renders — never to a live offer with nothing behind it.
        ...(tiny
          ? {
              tiny: {
                spec: typeof tiny.spec === "string" ? tiny.spec : null,
                acceptance: Array.isArray(tiny.acceptance)
                  ? tiny.acceptance.filter((a): a is string => typeof a === "string")
                  : [],
                doneAt: typeof tiny.doneAt === "number" ? tiny.doneAt : null,
              },
            }
          : {}),
      });
    }
  }
  return out;
}

/**
 * Stable topological order over `dependsOn`: each card after its predecessor when that predecessor is
 * in the same list, otherwise the given order. A dependency outside the list doesn't count; a cycle
 * leaves the given order untouched.
 */
export function byDependsOn<T extends { id: string; dependsOn: string | null }>(cards: T[]): T[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const out: T[] = [];
  const state = new Map<string, "open" | "done">();
  let cycle = false;
  const visit = (c: T): void => {
    const s = state.get(c.id);
    if (s === "done") return;
    if (s === "open") {
      cycle = true;
      return;
    }
    state.set(c.id, "open");
    const pred = c.dependsOn ? byId.get(c.dependsOn) : undefined;
    if (pred) visit(pred);
    state.set(c.id, "done");
    out.push(c);
  };
  for (const c of cards) visit(c);
  return cycle ? cards : out;
}

function toCard(r: CardRow): Card {
  return {
    id: r.id,
    title: r.title,
    spec: r.spec,
    rawInput: r.raw_input,
    acceptance: jsonArray(r.acceptance),
    // A status written by an older/newer schema degrades to backlog rather than poisoning the UI.
    status: isCardStatus(r.status) ? r.status : "backlog",
    repoPath: r.repo_path,
    baseRef: r.base_ref,
    branch: r.branch,
    workspaceId: r.workspace_id,
    agentKind: r.agent_kind,
    // Read straight through — a pointer at a deleted card would be a dangling link, so
    // `deleteCard` clears them rather than leaving the reader to guess.
    parentId: r.parent_id ?? null,
    duplicateOf: r.duplicate_of ?? null,
    dependsOn: r.depends_on ?? null,
    // Anything the current code doesn't recognise reads as "a person wrote it" — the same
    // degradation `status` gets, and the safe direction: claiming a card is automatic when it isn't
    // is the one error this field must never make.
    origin: CARD_ORIGINS.includes(r.origin as CardOrigin) ? (r.origin as CardOrigin) : null,
    originCardId: r.origin_card_id ?? null,
    // Anything unrecognised reads as "not classified", same degradation as `origin` above: a wrong
    // category would send a card to the wrong side of a filter, and no category shows it either way.
    category: CARD_CATEGORIES.includes(r.category as CardCategory) ? (r.category as CardCategory) : null,
    // No tag is the normal state, not a gap: every card written before tags existed reads as null,
    // and nothing downstream may treat that as missing data.
    tag: r.tag ?? null,
    position: r.position,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    keepWorktree: r.keep_worktree === 1,
    autoHandoff: r.auto_handoff === "on" || r.auto_handoff === "off" ? r.auto_handoff : null,
    runId: r.run_id ?? null,
    phaseId: r.phase_id ?? null,
    templateId: r.template_id ?? null,
    pipelineId: r.pipeline_id ?? null,
    environment: parseEnvironmentColumn(r.environment),
    createdBy: r.created_by ?? null,
    assignee: r.assignee ?? null,
    claim: r.claimed_pair && r.claimed_by ? { pair: r.claimed_pair, by: r.claimed_by, at: r.claimed_at ?? 0 } : null,
    manualChecks: parseManualChecks(r.manual_checks),
    capability: r.capability ?? null,
    usageGroup: r.usage_group ?? null,
    checkVerdicts: parseVerdicts(r.check_verdicts),
  };
}

function parseEnvironmentColumn(raw: string | null | undefined): CardEnvironment | null {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<CardEnvironment> | null;
    return typeof v?.peer === "string" && typeof v.name === "string" ? { peer: v.peer, name: v.name } : null;
  } catch {
    return null;
  }
}

function toSession(r: SessionRow): CardSession {
  return {
    id: r.id,
    cardId: r.card_id,
    paneId: r.pane_id,
    agentSessionId: r.agent_session_id,
    agentKind: r.agent_kind,
    ctxTokens: r.ctx_tokens,
    ctxPct: r.ctx_pct,
    handoffMd: r.handoff_md,
    outcome: (r.outcome as SessionOutcome | null) ?? null,
    handoffRequestedAt: r.handoff_requested_at ?? null,
    autoHandoffAt: r.auto_handoff_at ?? null,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  };
}

function toReview(r: ReviewRow): Review {
  return {
    id: r.id,
    cardId: r.card_id,
    sessionId: r.session_id,
    verdict: r.verdict,
    notes: r.notes,
    todos: jsonReviewTodos(r.todos),
    createdAt: r.created_at,
  };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS card (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  spec         TEXT,
  raw_input    TEXT,
  acceptance   TEXT,
  status       TEXT NOT NULL,
  repo_path    TEXT,
  base_ref     TEXT,
  branch       TEXT,
  workspace_id TEXT,
  agent_kind   TEXT,
  -- Soft self-references, deliberately WITHOUT a REFERENCES clause. A dangling pointer here has to
  -- degrade to "no parent" / "not blocked"; a real FK would instead make deleting a card fail
  -- because something else points at it, which is the wrong answer on a board you triage from a
  -- phone. deleteCard() clears both, so they never actually dangle.
  parent_id    TEXT,
  duplicate_of TEXT,
  depends_on   TEXT,
  -- Who wrote the card, when it wasn't a person. NULL is the normal case — see Card.origin.
  origin       TEXT,
  -- Which card it came out of — see Card.originCardId. Soft, like the three above.
  origin_card_id TEXT,
  -- What kind of follow-up an automatic card is — see Card.category. NULL for a person's card.
  category     TEXT,
  -- One tag or none. Nullable by design — see Card.tag.
  tag          TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  keep_worktree INTEGER NOT NULL DEFAULT 0,
  auto_handoff  TEXT,
  -- Soft, like parent_id: a card outlives nothing by being in a run. See Card.runId.
  run_id        TEXT,
  -- ADR 0021. Soft too: deleting a phase clears it rather than taking the cards with it.
  phase_id      TEXT,
  -- ADR 0026. Soft: deleting a template clears it; the card then starts as any card does.
  template_id   TEXT,
  -- ADR 0032. The flow it goes through; soft like template_id.
  pipeline_id   TEXT
);

-- ADR 0017. Intent only — never whether the run is going; that is read from its cards.
CREATE TABLE IF NOT EXISTS run (
  id          TEXT PRIMARY KEY,
  repo_path   TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  fold_in_cap INTEGER NOT NULL,
  lead_agent  TEXT,
  -- ADR 0021: a run is a LOT. launched_at NULL = planned, driving nothing.
  phase_id    TEXT,
  name        TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  launched_at INTEGER,
  max_parallel INTEGER
);

-- ADR 0021. A phase groups a repo's cards; its progress is read from them, never stored.
CREATE TABLE IF NOT EXISTS phase (
  id              TEXT PRIMARY KEY,
  repo_path       TEXT NOT NULL,
  name            TEXT NOT NULL,
  goal            TEXT NOT NULL DEFAULT '',
  position        INTEGER NOT NULL DEFAULT 0,
  roadmap_item_id TEXT,
  closed_at       INTEGER,
  closed_note     TEXT NOT NULL DEFAULT '',
  template_id     TEXT,
  pipeline_id     TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- ADR 0026. A role for a worker: a brief, an agent kind and a model. \`key\` names the shipped ones.
CREATE TABLE IF NOT EXISTS agent_template (
  id          TEXT PRIMARY KEY,
  key         TEXT UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  agent_kind  TEXT,
  model       TEXT,
  brief       TEXT NOT NULL,
  -- ADR 0031: this role writes the code, so a send-back goes to it.
  worker      INTEGER NOT NULL DEFAULT 0,
  builtin     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- ADR 0032. A flow is a named pipeline: an ordered list of template ids. \`key\` names the shipped ones.
CREATE TABLE IF NOT EXISTS agent_flow (
  id          TEXT PRIMARY KEY,
  key         TEXT UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  steps       TEXT NOT NULL DEFAULT '[]',
  builtin     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- ADR 0021. One document per repo: intents, not cards. \`revision\` is the optimistic lock.
CREATE TABLE IF NOT EXISTS roadmap (
  repo_path  TEXT PRIMARY KEY,
  vision     TEXT NOT NULL DEFAULT '',
  items      TEXT NOT NULL DEFAULT '[]',
  decisions  TEXT NOT NULL DEFAULT '[]',
  revision   INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- ADR 0023. The orchestrator's note to its next self: one short text per repo, last writer wins.
CREATE TABLE IF NOT EXISTS orchestrator_memory (
  repo_path  TEXT PRIMARY KEY,
  note       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  id               TEXT PRIMARY KEY,
  card_id          TEXT NOT NULL REFERENCES card(id),
  pane_id          TEXT,
  agent_session_id TEXT,
  agent_kind       TEXT,
  ctx_tokens       INTEGER,
  ctx_pct          REAL,
  handoff_md       TEXT,
  outcome          TEXT,
  handoff_requested_at INTEGER,
  auto_handoff_at  INTEGER,
  started_at       INTEGER NOT NULL,
  ended_at         INTEGER
);
CREATE INDEX IF NOT EXISTS session_card_idx ON session(card_id, started_at);
-- The reconciliation hot path: "which sessions are still open" runs on every poll tick.
CREATE INDEX IF NOT EXISTS session_open_idx ON session(ended_at) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS review (
  id         TEXT PRIMARY KEY,
  card_id    TEXT NOT NULL REFERENCES card(id),
  session_id TEXT REFERENCES session(id),
  verdict    TEXT,
  notes      TEXT,
  todos      TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS review_card_idx ON review(card_id, created_at);

CREATE TABLE IF NOT EXISTS event (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT,
  type    TEXT NOT NULL,
  payload TEXT,
  ts      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS event_card_idx ON event(card_id, ts);
-- listPrEvents reads each card's newest card.pr_opened every tick.
CREATE INDEX IF NOT EXISTS event_type_idx ON event(type, card_id);

-- The ONLY thing stored about a repository, and deliberately so.
--
-- The pickable-repo list is derived (cards + the live herd + a directory scan — see repos.ts),
-- because those are FACTS and a stored copy of a fact goes stale: move or delete a repo and it
-- would sit in the picker forever. What cannot be derived is the operator's DECISION that a repo
-- they own is not one they want offered. That is a preference, it has no other source, and it is
-- what this table holds. One row per hidden path, nothing else.
CREATE TABLE IF NOT EXISTS repo_pref (
  path       TEXT PRIMARY KEY,
  hidden     INTEGER NOT NULL DEFAULT 0,
  -- The repo's gate command (ADR 0020): the operator's decision too, and equally underivable.
  gate       TEXT,
  -- ADR 0032: the repo's default flow, the last fallback of a card's resolution.
  flow_id    TEXT,
  -- ADR 0043: 'direct' = a run merges a card into the base itself, no PR. Null: PR.
  integration TEXT,
  -- 1 = the operator added this repo to the project lists by hand (it has no card yet, or may never).
  listed     INTEGER NOT NULL DEFAULT 0,
  -- ADR 0048 §1: the remote this repo's board is shared on. NULL = not shared, nothing journaled.
  share      TEXT,
  updated_at INTEGER NOT NULL
);

-- Per-repo autonomy of the orchestrator (ADR 0030): the operator's setting and its bounds, plus the
-- two counters the bounds read. Default row = off, so no row is stored until the operator touches it.
CREATE TABLE IF NOT EXISTS repo_autonomy (
  path        TEXT PRIMARY KEY,
  enabled     INTEGER NOT NULL DEFAULT 0,
  max_chain   INTEGER DEFAULT 1,           -- NULL = unlimited
  stop_on_red INTEGER NOT NULL DEFAULT 1,
  chained     INTEGER NOT NULL DEFAULT 0,  -- lots launched by the orchestrator since the operator last did
  armed       INTEGER NOT NULL DEFAULT 0,  -- the end-of-lot wake granted one launch
  start_when_idle INTEGER NOT NULL DEFAULT 0, -- ADR 0047: may start a planned lot when nothing runs
  max_rounds  INTEGER NOT NULL DEFAULT 5   -- send-backs before the card goes to the operator (run.ts)
);

-- Board-wide operator preferences that aren't about one card or one repo. Key/value because a column
-- per switch would mean a migration per switch. An absent key reads as that preference's default, so
-- a fresh board needs no seeding.
CREATE TABLE IF NOT EXISTS board_pref (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ADR 0048 §2–3: a shared repo's writes as journal events, in write order, waiting to be pushed.
-- Filled by the journal triggers INSIDE the write's own transaction; \`hlc\` is stamped by
-- stampJournal before anything reads the row, so seq order is hlc order.
CREATE TABLE IF NOT EXISTS journal_outbox (
  seq       INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_path TEXT NOT NULL,
  entity    TEXT NOT NULL,
  type      TEXT NOT NULL,
  fields    TEXT NOT NULL,
  hlc       TEXT
);

-- ADR 0048 §2: the winning hlc of each field of each shared entity — and of each \`card.event\` (\`@<hlc>\`),
-- review (\`review:<id>\`) and tombstone (\`.deleted\`), so applying an event is O(fields) and idempotent.
CREATE TABLE IF NOT EXISTS journal_field (
  repo_path TEXT NOT NULL,
  entity    TEXT NOT NULL,
  field     TEXT NOT NULL,
  hlc       TEXT NOT NULL,
  PRIMARY KEY (repo_path, entity, field)
);
`;

/**
 * What of each entity goes to the shared journal (ADR 0048 §2) — the column and whether it holds JSON.
 * Anything absent never does: `repo_path` (a local path), `workspace_id` and the handoff/worktree
 * switches (live, this machine's), `updated_at` and the roadmap's `revision` (local bookkeeping).
 * Sessions, preferences, autonomy, the orchestrator's memory, templates and flows have no entry at all.
 */
const SHARED = {
  card: {
    table: "card",
    folder: "cards",
    columns: {
      title: false, spec: false, raw_input: false, acceptance: true, status: false, base_ref: false,
      branch: false, agent_kind: false, parent_id: false, duplicate_of: false, depends_on: false,
      origin: false, origin_card_id: false, category: false, tag: false, position: false, run_id: false,
      phase_id: false, template_id: false, pipeline_id: false, created_at: false, created_by: false, assignee: false,
      manual_checks: true, capability: false, usage_group: false, check_verdicts: true,
    },
    // Inserted when the first event of a card is not the one that names it; the next fields fill it.
    seed: "INSERT OR IGNORE INTO card (id, repo_path, title, status, created_at, updated_at) VALUES (?1, ?2, '', 'backlog', ?3, ?3)",
  },
  run: {
    table: "run",
    folder: "runs",
    columns: {
      fold_in_cap: false, lead_agent: false, phase_id: false, name: false, position: false, launched_at: false,
      max_parallel: false, integration: false, lot_branch: false, lot_base: false, created_at: false,
      created_by: false, created_pair: false, finished_at: false,
    },
    seed: "INSERT OR IGNORE INTO run (id, repo_path, created_at, fold_in_cap) VALUES (?1, ?2, ?3, 0)",
  },
  phase: {
    table: "phase",
    folder: "phases",
    columns: {
      name: false, goal: false, position: false, roadmap_item_id: false, closed_at: false, closed_note: false,
      template_id: false, pipeline_id: false, created_at: false,
    },
    seed: "INSERT OR IGNORE INTO phase (id, repo_path, name, created_at, updated_at) VALUES (?1, ?2, '', ?3, ?3)",
  },
  roadmap: {
    table: "roadmap",
    folder: "roadmap",
    columns: { vision: false, items: true, decisions: true },
    seed: "INSERT OR IGNORE INTO roadmap (repo_path, updated_at) VALUES (?2, ?3)",
  },
} as const;
type SharedKind = keyof typeof SHARED;

const REVIEW_COLUMNS = { id: false, verdict: false, notes: false, todos: true, created_at: false } as const;
const EVENT_COLUMNS = { type: false, payload: true, ts: false } as const;

/** A card's journal lines that stay on this machine: sessions, handoffs, wrapups, pane notes, worktree paths. */
const LOCAL_EVENT_SQL = "(type LIKE 'session.%' OR type LIKE 'handoff.%' OR type LIKE 'wrapup.%' OR type IN ('agent.notify', 'card.worktree'))";

/** A JSON object of `cols` read from `row` (NEW, or a table alias) — only the changed ones when `changed`, NULL when none. */
function fieldsSql(cols: Record<string, boolean>, changed: boolean, has: Set<string>, row = "NEW"): string {
  const parts = Object.entries(cols).filter(([c]) => has.has(c)).map(([c, json]) => {
    // A column that should hold JSON but doesn't travels as a string: a trigger must never fail the write.
    const v = json ? `CASE WHEN json_valid(${row}.${c}) THEN ${row}.${c} ELSE json_quote(${row}.${c}) END` : `json_quote(${row}.${c})`;
    return `SELECT '${c}' AS k, ${v} AS v${changed ? ` WHERE OLD.${c} IS NOT ${row}.${c}` : ""}`;
  });
  return `(SELECT json_group_object(k, json(v)) FROM (${parts.join(" UNION ALL ")}) HAVING count(*) > 0)`;
}

/**
 * The journal triggers: every write of a shared repo's entity adds its event to journal_outbox in the
 * SAME transaction, whichever method made it. TEMP, so they are rebuilt from this code at every open,
 * never migrated, and never in a backup; muted while the journal itself is being applied.
 */
function journalTriggers(columns: (table: string) => Set<string>): string {
  const when = (repo: string) =>
    `NOT EXISTS (SELECT 1 FROM temp.journal_mute) AND EXISTS (SELECT 1 FROM main.repo_pref WHERE path = ${repo} AND share IS NOT NULL)`;
  // Unqualified INSERT target: SQLite < 3.53 rejects a schema-qualified write in a trigger body; a TEMP trigger resolves it to main.
  const out = (name: string, on: string, repo: string, entity: string, type: string, fields: string, extra = "") => `
CREATE TEMP TRIGGER IF NOT EXISTS ${name} ${on} WHEN ${when(repo)}${extra}
BEGIN
  INSERT INTO journal_outbox (repo_path, entity, type, fields)
  SELECT ${repo}, ${entity}, '${type}', f FROM (SELECT ${fields} AS f) WHERE f IS NOT NULL;
END;`;
  let sql = "CREATE TEMP TABLE IF NOT EXISTS journal_mute (x);";
  for (const [kind, s] of Object.entries(SHARED)) {
    const entity = (row: string) => (kind === "roadmap" ? "'roadmap'" : `'${s.folder}/' || ${row}.id`);
    // shortcut: an entity moved INTO a shared repo journals only its changed fields, not itself whole; importJournal covers only what is there at activation.
    sql += out(`journal_${kind}_ins`, `AFTER INSERT ON main.${s.table}`, "NEW.repo_path", entity("NEW"), `${kind}.set`, fieldsSql(s.columns, false, columns(s.table)));
    sql += out(`journal_${kind}_upd`, `AFTER UPDATE ON main.${s.table}`, "NEW.repo_path", entity("NEW"), `${kind}.set`, fieldsSql(s.columns, true, columns(s.table)));
    if (kind !== "roadmap") sql += out(`journal_${kind}_del`, `AFTER DELETE ON main.${s.table}`, "OLD.repo_path", entity("OLD"), `${kind}.deleted`, "'{}'");
  }
  const cardRepo = "(SELECT repo_path FROM main.card WHERE id = NEW.card_id)";
  for (const on of ["INSERT", "UPDATE"])
    sql += out(`journal_review_${on.toLowerCase()}`, `AFTER ${on} ON main.review`, cardRepo, "'cards/' || NEW.card_id", "card.review", fieldsSql(REVIEW_COLUMNS, false, columns("review")));
  sql += out("journal_event_ins", "AFTER INSERT ON main.event", cardRepo, "'cards/' || NEW.card_id", "card.event", fieldsSql(EVENT_COLUMNS, false, columns("event")), ` AND NOT ${LOCAL_EVENT_SQL.replaceAll("type", "NEW.type")}`);
  return sql;
}

/** The journal_field keys an event claims: its fields, or the one key that makes it idempotent. */
function journalKeys(e: { type: string; hlc: string; fields: Record<string, unknown> }): string[] {
  if (e.type.endsWith(".deleted")) return [".deleted"];
  if (e.type.endsWith(".set")) return Object.keys(e.fields);
  if (e.type === "card.event") return [`@${e.hlc}`];
  if (e.type === "card.review" && typeof e.fields.id === "string") return [`review:${e.fields.id}`];
  if (e.type === "card.claimed") return ["claim"];
  return [];
}

/** One event of a repo's journal and the entity folder its file is in (`cards/<id>`, `roadmap`…). */
export interface JournalEntry {
  entity: string;
  event: JournalEvent;
}

/** `board_pref` key for {@link BoardDb.pins}. */
const PINS_KEY = "pinned_sessions";

/** An agent session the operator pinned to the quick access. `session` is herdr's `agent_session`
 *  (stable across a reboot, unlike the pane id); `name` is what it was called when pinned, so a pin
 *  whose session is gone still says what it was. */
export interface Pin {
  session: string;
  name: string;
}

/** `board_pref` key for {@link BoardDb.autoFollowUps}. */
const AUTO_FOLLOW_UPS_KEY = "auto_follow_ups";

/** `board_pref` key for {@link BoardDb.followUpCategories}. */
const FOLLOW_UP_CATEGORIES_KEY = "follow_up_categories";

/** `board_pref` key for {@link BoardDb.autoHandoff}. */
const AUTO_HANDOFF_KEY = "auto_handoff";

/** `board_pref` key for {@link BoardDb.maxAgents}. */
const MAX_AGENTS_KEY = "max_agents";

/** The most agents the board will ever run at once, whatever the operator types — except `0`, which
 *  means no limit at all. Matches the ceiling `COLLIE_BOARD_MAX_AGENTS` is clamped to in config.ts. */
export const MAX_AGENTS_CAP = 32;

/** A tag longer than this is a sentence, not a label, and would not fit the chip it renders as. */
const TAG_MAX_CHARS = 24;

/**
 * Fold a tag to its canonical form, or null when there isn't one.
 *
 * Applied at the DATABASE, not at the HTTP edge: the copilot writes tags straight through
 * `patchCard`, so a check in `parseCardBody` alone would leave the one writer that invents tags able
 * to invent `Bug` next to `bug`. The name is the tag's identity everywhere — the inventory dedupes on
 * it and the colour is derived from it — so two spellings of one tag is two tags in two colours.
 */
export function normalizeTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, TAG_MAX_CHARS).trim() || null;
}

/** Fields a caller may set when creating a card. Everything else is derived or defaulted. */
export interface NewCard {
  title: string;
  spec?: string | null;
  rawInput?: string | null;
  acceptance?: string[];
  status?: CardStatus;
  repoPath?: string | null;
  baseRef?: string | null;
  branch?: string | null;
  agentKind?: string | null;
  parentId?: string | null;
  duplicateOf?: string | null;
  dependsOn?: string | null;
  /**
   * Omit for a card a person made — see {@link Card.origin}. Set at creation and absent from
   * {@link CardPatch} on purpose: a card does not change where it came from.
   */
  origin?: CardOrigin;
  /** Omit for a card that came from nowhere but a person — see {@link Card.originCardId}. */
  originCardId?: string | null;
  /** Alongside {@link NewCard.origin}, or `explore` on any card — see {@link Card.category}. */
  category?: CardCategory;
  tag?: string | null;
  /**
   * Explicit board position. Omit for the default — new cards land at the TOP of their column,
   * which is one less tap on a phone. A split passes it, because "top of the column" applied to
   * three cards created in a row reverses them, and a chain read backwards is worse than useless.
   */
  position?: number;
  phaseId?: string | null;
  templateId?: string | null;
  pipelineId?: string | null;
  environment?: CardEnvironment | null;
  assignee?: string | null;
  manualChecks?: ManualCheck[];
  capability?: string | null;
  usageGroup?: string | null;
}

/** A partial update. Absent keys are left alone; an explicit `null` clears a nullable column. */
export interface CardPatch {
  title?: string;
  spec?: string | null;
  rawInput?: string | null;
  acceptance?: string[];
  status?: CardStatus;
  repoPath?: string | null;
  baseRef?: string | null;
  branch?: string | null;
  workspaceId?: string | null;
  agentKind?: string | null;
  parentId?: string | null;
  duplicateOf?: string | null;
  dependsOn?: string | null;
  tag?: string | null;
  position?: number;
  keepWorktree?: boolean;
  autoHandoff?: AutoHandoffChoice | null;
  phaseId?: string | null;
  templateId?: string | null;
  pipelineId?: string | null;
  environment?: CardEnvironment | null;
  assignee?: string | null;
  manualChecks?: ManualCheck[];
  capability?: string | null;
  usageGroup?: string | null;
}

/** Column name per patch key — also the allowlist that keeps `patch()` from building arbitrary SQL. */
const PATCH_COLUMNS: Record<keyof CardPatch, string> = {
  title: "title",
  spec: "spec",
  rawInput: "raw_input",
  acceptance: "acceptance",
  status: "status",
  repoPath: "repo_path",
  baseRef: "base_ref",
  branch: "branch",
  workspaceId: "workspace_id",
  agentKind: "agent_kind",
  parentId: "parent_id",
  duplicateOf: "duplicate_of",
  dependsOn: "depends_on",
  tag: "tag",
  position: "position",
  keepWorktree: "keep_worktree",
  autoHandoff: "auto_handoff",
  phaseId: "phase_id",
  templateId: "template_id",
  pipelineId: "pipeline_id",
  environment: "environment",
  assignee: "assignee",
  manualChecks: "manual_checks",
  capability: "capability",
  usageGroup: "usage_group",
};

/**
 * How far back the bridge reads a card's journal to decide a fact about it (landed, gated, decided…).
 * One number, so a fact is never true for one reader and silently out of reach for another.
 */
export const EVENT_WINDOW = 200;

export class BoardDb {
  private readonly db: Database;

  /** `path` is a file path, or `":memory:"` in tests. */
  constructor(path: string, private readonly now: () => number = Date.now) {
    this.db = new Database(path, { create: true });
    // WAL so a read never blocks behind a write; busy_timeout covers the rest. Both are no-ops on
    // an in-memory database, which is why the tests can share this constructor.
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 3000");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(SCHEMA);
    this.migrate();
    // From the columns the tables really have: a trigger naming a missing one would fail every write.
    this.db.exec(
      journalTriggers((t) => new Set(this.db.query<{ name: string }, []>(`PRAGMA table_info(${t})`).all().map((c) => c.name))),
    );
    // Owner-only, like audit.log: a card's spec is as sensitive as the reply text that log echoes.
    // The 0700 state dir already bounds it — this is the belt to that brace, and it costs one call.
    // WAL/SHM siblings inherit the directory's protection; only the main file is ours to set.
    if (path !== ":memory:") {
      try {
        chmodSync(path, 0o600);
      } catch {
        /* a filesystem without POSIX modes (or a read-only mount) must not stop the board booting */
      }
    }
  }

  close(): void {
    this.db.close();
  }

  /**
   * Every row of every table, keyed by table name — the backup's payload (see backup.ts).
   *
   * Read from `sqlite_master` rather than from a hardcoded list on purpose: the next table added to
   * SCHEMA is in the backup the day it exists, with nobody having to remember this method.
   */
  dump(): Record<string, unknown[]> {
    const out: Record<string, unknown[]> = {};
    // Table names come from sqlite_master, so the interpolation below is our own schema, not input.
    for (const name of this.tableNames()) out[name] = this.db.query(`SELECT * FROM "${name}"`).all();
    return out;
  }

  /**
   * Write a backup's row dump back over the tables, and return how many rows landed in each.
   *
   * One transaction, so a restore that trips a constraint leaves the board exactly as it was. What
   * it deliberately tolerates: a table this schema doesn't have (a newer Collie's), a table missing
   * from the backup (an older one's — left untouched rather than emptied), and a column on either
   * side the other doesn't know. A restore of an overlapping schema beats a refusal.
   */
  restore(tables: Record<string, unknown[]>): Record<string, number> {
    const counts: Record<string, number> = {};
    // Muted: a restore puts back what the board was, it is not a write to journal (nor a tombstone per row).
    this.muted(() => {
      // Rows arrive table by table, so `session` can land before the `card` it references. Deferring
      // the checks to COMMIT keeps the constraint (a dangling card_id still rolls the whole thing
      // back) without imposing an insertion order the dump doesn't carry.
      this.db.exec("PRAGMA defer_foreign_keys = ON");
      for (const name of this.tableNames()) {
        const rows = tables[name];
        if (!Array.isArray(rows)) continue;
        const columns = new Set(
          this.db.query<{ name: string }, []>(`PRAGMA table_info("${name}")`).all().map((c) => c.name),
        );
        this.db.exec(`DELETE FROM "${name}"`);
        for (const row of rows as Record<string, unknown>[]) {
          const keys = Object.keys(row).filter((k) => columns.has(k));
          if (keys.length === 0) continue;
          const values = keys.map((k) => (typeof row[k] === "boolean" ? (row[k] ? 1 : 0) : row[k]));
          this.db
            .query(
              `INSERT INTO "${name}" (${keys.map((k) => `"${k}"`).join(", ")})
               VALUES (${keys.map(() => "?").join(", ")})`,
            )
            .run(...(values as (string | number | null)[]));
        }
        counts[name] = rows.length;
      }
    });
    return counts;
  }

  /** Our own tables, alphabetical — sqlite's internal ones excluded. */
  private tableNames(): string[] {
    return this.db
      .query<{ name: string }, []>(
        `SELECT name FROM sqlite_master
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name`,
      )
      .all()
      .map((t) => t.name);
  }

  /**
   * Additive migrations. `CREATE TABLE IF NOT EXISTS` gets a NEW database right and does nothing at
   * all for an existing one, so a column added after someone's board has cards in it needs this.
   *
   * Deliberately the dumbest thing that works: a list of `ADD COLUMN`s, applied when the column
   * isn't already there. Additive only — no renames, no drops, no version table — because every
   * change so far is a nullable column, and a migration framework for that would be exactly the
   * kind of machinery this project doesn't buy.
   */
  private migrate(): void {
    // ADR 0021: a lot is a run with `launched_at`. Every run that existed before the column was
    // launched by definition — it started on creation — so back-fill ONLY on the migration that adds
    // the column; any later NULL is a planned lot and must stay one.
    const hadLaunchedAt = this.db
      .query<{ name: string }, []>("PRAGMA table_info(run)")
      .all()
      .some((c) => c.name === "launched_at");
    // ADR 0031: the shipped worker roles are marked ONLY on the migration that adds the column — after
    // it, `worker` is the operator's to change and a shipped template they unticked stays unticked.
    const hadWorker = this.db
      .query<{ name: string }, []>("PRAGMA table_info(agent_template)")
      .all()
      .some((c) => c.name === "worker");
    const additions: { table: string; column: string; ddl: string }[] = [
      // 0.22: the handoff is asynchronous (the agent has to finish writing the file first), so the
      // request has to survive a bridge restart — a board whose whole point is durable memory can't
      // hold a pending handoff in RAM.
      { table: "session", column: "handoff_requested_at", ddl: "INTEGER" },
      // 0.32: a split used to produce bare titles with nothing tying them together. These two are
      // what make a split legible afterwards — where a card came from, and what it waits on.
      { table: "card", column: "parent_id", ddl: "TEXT" },
      // 0.44: the copilot's "you may already have this card" suggestion.
      { table: "card", column: "duplicate_of", ddl: "TEXT" },
      { table: "card", column: "depends_on", ddl: "TEXT" },
      // 0.50: opt a card out of automatic post-wrapup cleanup.
      { table: "card", column: "keep_worktree", ddl: "INTEGER NOT NULL DEFAULT 0" },
      // 0.67: one tag per card. Nullable with no backfill — the cards already on the board have no
      // tag, and "no tag" is a normal card, not a row waiting to be migrated.
      { table: "card", column: "tag", ddl: "TEXT" },
      // 0.81: where a card came from. No backfill, and none possible — every card written before
      // this reads as hand-written, which is very nearly true and is the harmless direction.
      { table: "card", column: "origin", ddl: "TEXT" },
      // 0.82: which card it came out of. No backfill: the follow-ups already on the board keep
      // their `origin` badge and simply say nothing about where they came from, which is what
      // they said yesterday.
      { table: "card", column: "origin_card_id", ddl: "TEXT" },
      // 0.115: what kind of follow-up an automatic card is. No backfill: the follow-ups already on
      // the board were written before the copilot was asked to say, and guessing from a title is
      // exactly the unreliable classification this field exists to replace.
      { table: "card", column: "category", ddl: "TEXT" },
      // 0.147: the handoff taken automatically before the prompt cache expires. No backfill —
      // nothing was outstanding before it existed.
      { table: "session", column: "auto_handoff_at", ddl: "INTEGER" },
      // …and a card's own answer to it, over the board pref. Null follows the pref.
      { table: "card", column: "auto_handoff", ddl: "TEXT" },
      // Runs (ADR 0017). No backfill: no card was ever in a run before the table existed.
      { table: "card", column: "run_id", ddl: "TEXT" },
      // The repo's gate command (ADR 0020). Null: no gate.
      { table: "repo_pref", column: "gate", ddl: "TEXT" },
      // ADR 0043: how a run lands a card. Null: a PR.
      { table: "repo_pref", column: "integration", ddl: "TEXT" },
      // The repos the operator added to the project lists by hand. No backfill: none was, before.
      { table: "repo_pref", column: "listed", ddl: "INTEGER NOT NULL DEFAULT 0" },
      // ADR 0048 §1: no repo was shared before.
      { table: "repo_pref", column: "share", ddl: "TEXT" },
      // Phases, lots, roadmap (ADR 0021).
      { table: "card", column: "phase_id", ddl: "TEXT" },
      { table: "run", column: "phase_id", ddl: "TEXT" },
      { table: "run", column: "name", ddl: "TEXT" },
      { table: "run", column: "position", ddl: "INTEGER NOT NULL DEFAULT 0" },
      { table: "run", column: "launched_at", ddl: "INTEGER" },
      { table: "run", column: "max_parallel", ddl: "INTEGER" },
      // ADR 0041: one PR for a whole lot.
      { table: "run", column: "integration", ddl: "TEXT NOT NULL DEFAULT 'card'" },
      { table: "run", column: "lot_branch", ddl: "TEXT" },
      { table: "run", column: "lot_base", ddl: "TEXT" },
      // ADR 0048 §7: a lot's creator, and its end as the creator's coordinator saw it — shared, so the
      // other pairs see a lot finish. No backfill: the local `run.finished` event still says it here.
      { table: "run", column: "created_by", ddl: "TEXT" },
      { table: "run", column: "created_pair", ddl: "TEXT" },
      { table: "run", column: "finished_at", ddl: "INTEGER" },
      // ADR 0025: a validated phase is a milestone. Null closed_at = still the work in progress.
      { table: "phase", column: "closed_at", ddl: "INTEGER" },
      { table: "phase", column: "closed_note", ddl: "TEXT NOT NULL DEFAULT ''" },
      // ADR 0023: the roadmap's decision journal.
      { table: "roadmap", column: "decisions", ddl: "TEXT NOT NULL DEFAULT '[]'" },
      // ADR 0026: the agent template a card — or its phase — starts with.
      { table: "card", column: "template_id", ddl: "TEXT" },
      { table: "phase", column: "template_id", ddl: "TEXT" },
      // ADR 0032: the flow (named pipeline) a card, a phase or a repo goes through.
      { table: "card", column: "pipeline_id", ddl: "TEXT" },
      { table: "phase", column: "pipeline_id", ddl: "TEXT" },
      { table: "repo_pref", column: "flow_id", ddl: "TEXT" },
      // ADR 0046 §4: the peer environment a card launches in, as JSON {peer, name}.
      { table: "card", column: "environment", ddl: "TEXT" },
      // ADR 0048 §5: no backfill — who created a card before is not known, and guessing the local pair would lie.
      { table: "card", column: "created_by", ddl: "TEXT" },
      { table: "card", column: "assignee", ddl: "TEXT" },
      // ADR 0048 §7: a shared card's reservation, written only by applying a pushed `card.claimed`.
      { table: "card", column: "claimed_pair", ddl: "TEXT" },
      { table: "card", column: "claimed_by", ddl: "TEXT" },
      { table: "card", column: "claimed_at", ddl: "INTEGER" },
      { table: "card", column: "manual_checks", ddl: "TEXT" },
      { table: "card", column: "capability", ddl: "TEXT" },
      { table: "card", column: "usage_group", ddl: "TEXT" },
      { table: "card", column: "check_verdicts", ddl: "TEXT" },
      { table: "agent_template", column: "worker", ddl: "INTEGER NOT NULL DEFAULT 0" },
      // ADR 0047: off for every repo that had autonomy before it.
      { table: "repo_autonomy", column: "start_when_idle", ddl: "INTEGER NOT NULL DEFAULT 0" },
      { table: "repo_autonomy", column: "max_rounds", ddl: "INTEGER NOT NULL DEFAULT 5" },
    ];
    for (const { table, column, ddl } of additions) {
      const cols = this.db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
      if (cols.some((c) => c.name === column)) continue;
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
    if (!hadLaunchedAt) this.db.exec("UPDATE run SET launched_at = created_at WHERE launched_at IS NULL");
    if (!hadWorker) {
      const keys = BUILTIN_TEMPLATES.filter((t) => t.worker).map((t) => t.key);
      this.db.query(`UPDATE agent_template SET worker = 1 WHERE key IN (${keys.map(() => "?").join(",")})`).run(...keys);
    }
    this.seedTemplates();
    this.seedFlows();
  }

  /** Insert the shipped templates that are missing, by `key` — never touches one the operator has edited. */
  private seedTemplates(): void {
    const has = this.db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM agent_template WHERE key = ?");
    const ts = this.now();
    for (const t of BUILTIN_TEMPLATES) {
      if (has.get(t.key!)!.n > 0) continue;
      this.db
        .query(
          `INSERT INTO agent_template (id, key, name, description, agent_kind, model, brief, worker, builtin, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(crypto.randomUUID(), t.key, t.name, t.description, t.agentKind, t.model, t.brief, t.worker ? 1 : 0, ts, ts);
    }
  }

  /** Insert the shipped flows that are missing, by `key`, over the shipped templates (by their key). */
  private seedFlows(): void {
    const has = this.db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM agent_flow WHERE key = ?");
    const ts = this.now();
    for (const f of BUILTIN_FLOWS) {
      if (has.get(f.key)!.n > 0) continue;
      const steps = this.shippedSteps(f.roles);
      this.db
        .query(`INSERT INTO agent_flow (id, key, name, description, steps, builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
        .run(crypto.randomUUID(), f.key, f.name, f.description, JSON.stringify(steps), ts, ts);
    }
  }

  /** The ids of the shipped templates a shipped flow is made of; a role whose template is gone is skipped. */
  private shippedSteps(roles: readonly string[]): string[] {
    return roles.flatMap((key) => this.db.query<{ id: string }, [string]>("SELECT id FROM agent_template WHERE key = ?").get(key)?.id ?? []);
  }

  // ── cards ───────────────────────────────────────────────────────────────────

  createCard(input: NewCard): Card {
    const ts = this.now();
    const id = crypto.randomUUID();
    const status = input.status ?? "backlog";
    // New cards land at the top of their column: one less tap than dragging them up there.
    const minPos = (
      this.db.query<{ p: number | null }, [string]>("SELECT MIN(position) AS p FROM card WHERE status = ?")
        .get(status)
    )?.p;
    this.db
      .query(
        `INSERT INTO card (id, title, spec, raw_input, acceptance, status, repo_path, base_ref,
                           branch, workspace_id, agent_kind, parent_id, depends_on, origin,
                           origin_card_id, category, tag, position, created_at, updated_at, created_by, assignee)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.title,
        input.spec ?? null,
        input.rawInput ?? null,
        JSON.stringify(input.acceptance ?? []),
        status,
        input.repoPath ?? null,
        input.baseRef ?? null,
        input.branch ?? null,
        input.agentKind ?? null,
        input.parentId ?? null,
        input.dependsOn ?? null,
        input.origin ?? null,
        input.originCardId ?? null,
        input.category ?? null,
        normalizeTag(input.tag),
        input.position ?? (minPos ?? 0) - 1,
        ts,
        ts,
        // Derived, whoever calls: the pair creating it, when its repo is shared and its identity read.
        input.repoPath && this.repoShare(input.repoPath) ? (this.peerIdentities.get(input.repoPath) ?? null) : null,
        input.assignee ?? null,
      );
    if (input.phaseId) this.db.query("UPDATE card SET phase_id = ? WHERE id = ?").run(input.phaseId, id);
    if (input.templateId) this.db.query("UPDATE card SET template_id = ? WHERE id = ?").run(input.templateId, id);
    if (input.pipelineId) this.db.query("UPDATE card SET pipeline_id = ? WHERE id = ?").run(input.pipelineId, id);
    if (input.environment) this.db.query("UPDATE card SET environment = ? WHERE id = ?").run(JSON.stringify(input.environment), id);
    const recette = Object.fromEntries(
      Object.entries({ manualChecks: input.manualChecks, capability: input.capability, usageGroup: input.usageGroup }).filter(([, v]) => v != null),
    );
    if (Object.keys(recette).length > 0) this.patchCard(id, recette);
    this.recordEvent(id, "card.created", { title: input.title, status });
    return this.getCard(id)!;
  }

  getCard(id: string): Card | null {
    const row = this.db.query<CardRow, [string]>("SELECT * FROM card WHERE id = ?").get(id);
    return row ? toCard(row) : null;
  }

  /**
   * Give a card created before every card had a base its repo's default (git.ts `backfillBaseRefs`).
   * Only a NULL is filled, and `updated_at` is left alone: this is a migration, not an edit.
   */
  fillBaseRef(id: string, baseRef: string): void {
    this.db.query("UPDATE card SET base_ref = ? WHERE id = ? AND base_ref IS NULL").run(baseRef, id);
  }

  /** Every card except `archived`, ordered for the board (column order, then manual position). */
  /**
   * Changes on every committed write: this connection's row-change count plus SQLite's
   * `data_version`, which moves when another connection commits. A cache key, never persisted.
   */
  revision(): string {
    const r = this.db.query("SELECT total_changes() AS t, (SELECT data_version FROM pragma_data_version) AS v").get() as {
      t: number;
      v: number;
    };
    return `${r.v}:${r.t}`;
  }

  listCards(opts: { includeArchived?: boolean } = {}): Card[] {
    const sql = opts.includeArchived
      ? "SELECT * FROM card ORDER BY position, created_at"
      : "SELECT * FROM card WHERE status != 'archived' ORDER BY position, created_at";
    return this.db.query<CardRow, []>(sql).all().map(toCard);
  }

  /**
   * Every tag in use, most recently touched first. THE tag inventory — there is no tag table and
   * there is not going to be one: the tags that exist are the tags on the cards, so a card deleted
   * or retagged takes its vocabulary with it and a separate list would have to be kept in step for
   * no gain. Archived cards count: a tag is a vocabulary, and filing a card away doesn't unlearn the
   * word.
   */
  listTags(): string[] {
    return this.db
      .query<{ tag: string }, []>(
        `SELECT tag FROM card WHERE tag IS NOT NULL
         GROUP BY tag ORDER BY MAX(updated_at) DESC, tag`,
      )
      .all()
      .map((r) => r.tag);
  }

  /** Cards in one column, without reading the others — for the per-poll readers. */
  listCardsWithStatus(status: CardStatus): Card[] {
    return this.db.query<CardRow, [string]>("SELECT * FROM card WHERE status = ?").all(status).map(toCard);
  }

  /**
   * The cards the copilot still owes a review, with the session to review: a `review`/`done` card,
   * its open session or else its latest, no review row for that session yet, and — for a `done`
   * card — no wrapup note still pending (`isPendingWrapup`: reviewing before it lands would judge
   * the work on the diff alone). `done` is deliberately included — it is the only path that carries
   * a wrapup note. One query, because the copilot asks on every poll and the done column only grows:
   * per card, it was three queries over hundreds of cards.
   */
  listCardsOwedReview(): { cardId: string; sessionId: string }[] {
    return this.db
      .query<{ cardId: string; sessionId: string }, []>(
        `SELECT c.id AS cardId, s.id AS sessionId
         FROM card c
         JOIN session s ON s.id = (
           SELECT id FROM session WHERE card_id = c.id
           ORDER BY ended_at IS NULL DESC, started_at DESC, rowid DESC LIMIT 1)
         WHERE c.status IN ('review', 'done')
           AND NOT EXISTS (SELECT 1 FROM review r WHERE r.card_id = c.id AND r.session_id = s.id)
           AND NOT (c.status = 'done' AND s.ended_at IS NOT NULL AND s.handoff_requested_at IS NOT NULL)`,
      )
      .all();
  }

  /** Cards whose status says an agent should be running — the reconciliation working set. */
  listLiveCards(): Card[] {
    const marks = LIVE_STATUSES.map(() => "?").join(",");
    return this.db
      .query<CardRow, string[]>(`SELECT * FROM card WHERE status IN (${marks})`)
      .all(...LIVE_STATUSES)
      .map(toCard);
  }

  /**
   * Apply a partial update. Returns the fresh card, or null if the id is unknown.
   *
   * Every overwrite of the card's THREE WRITTEN FIELDS (title, spec, acceptance) is journalled with
   * what it replaced, and this is the only place that happens — deliberately, because it is the one
   * choke point every writer routes through. Put it in the copilot instead and a hand edit through
   * `PATCH /api/cards/<id>` is silently unrecoverable; put it in the route as well and there are two
   * mechanisms to keep in step. `reason` is what the journal shows as the cause.
   *
   * The prior values are stored WHOLE, not truncated: a half-restored spec is worse than none. The
   * journal is append-only and never pruned, which on a board with a few hundred cards is a few
   * hundred kilobytes — cheap enough that bounding it would be the more expensive decision.
   */
  patchCard(id: string, patch: CardPatch, reason = "edit"): Card | null {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [key, column] of Object.entries(PATCH_COLUMNS) as [keyof CardPatch, string][]) {
      if (!(key in patch)) continue;
      const value = patch[key];
      sets.push(`${column} = ?`);
      values.push(
        key === "acceptance" || key === "manualChecks"
          ? JSON.stringify(value ?? [])
          : key === "environment"
            ? (value ? JSON.stringify(value) : null)
            : key === "keepWorktree"
              ? (value ? 1 : 0)
              : key === "tag"
                ? normalizeTag(value)
                : (value as string | number | null),
      );
    }
    if (sets.length === 0) return this.getCard(id);

    const before = this.getCard(id);
    sets.push("updated_at = ?");
    values.push(this.now(), id);
    this.db.query(`UPDATE card SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    if (before) this.recordEdit(before, patch, reason);
    return this.getCard(id);
  }

  /** Record the operator's verdict on one step of the card's recette. Out of {@link CardPatch}: no body reaches it. */
  setCheckVerdict(id: string, stepId: string, verdict: CheckVerdict): Card | null {
    const card = this.getCard(id);
    if (!card) return null;
    // shortcut: two pairs ticking different steps of one card at once — the whole map is last-write-wins; one entity per verdict if that bites.
    const verdicts = { ...card.checkVerdicts, [stepId]: verdict };
    this.db.query("UPDATE card SET check_verdicts = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(verdicts), this.now(), id);
    return this.getCard(id);
  }

  /**
   * Journal an overwrite of written text, if that is what just happened. Only fields the patch
   * actually CHANGED are recorded: `startCard` patches a branch and a workspace on every launch, and
   * an edit history full of "nothing was edited" is one nobody reads.
   */
  private recordEdit(before: Card, patch: CardPatch, reason: string): void {
    const replaced: { title?: string; spec?: string | null; acceptance?: string[] } = {};
    if (patch.title !== undefined && patch.title !== before.title) replaced.title = before.title;
    if (patch.spec !== undefined && patch.spec !== before.spec) replaced.spec = before.spec;
    if (
      patch.acceptance !== undefined &&
      JSON.stringify(patch.acceptance) !== JSON.stringify(before.acceptance)
    ) {
      replaced.acceptance = before.acceptance;
    }
    if (Object.keys(replaced).length === 0) return;
    this.recordEvent(before.id, "card.edited", { reason, replaced });
  }

  /**
   * Move a card to a status, recording the transition in the journal. Separate from
   * {@link patchCard} because a status change is the thing the card's history is *about* — every
   * one of them is an event, whether it came from a tap or from reconciliation.
   */
  setStatus(id: string, status: CardStatus, reason: string): Card | null {
    const before = this.getCard(id);
    if (!before) return null;
    if (before.status === status) return before;
    const card = this.patchCard(id, { status });
    this.recordEvent(id, "card.status", { from: before.status, to: status, reason });
    return card;
  }

  /**
   * Every container's children's statuses, keyed by parent. One narrow query because this runs on
   * the reconciliation hot path — every poll tick, forever. Listing *all* cards instead (which is
   * what this replaced) re-read and JSON-parsed the acceptance list of every archived card on the
   * board, several times a second, to answer a question about two columns.
   */
  childStatusesByParent(): Map<string, CardStatus[]> {
    const rows = this.db
      .query<{ parent_id: string; status: string }, []>(
        "SELECT parent_id, status FROM card WHERE parent_id IS NOT NULL",
      )
      .all();
    const out = new Map<string, CardStatus[]>();
    for (const r of rows) {
      const status = isCardStatus(r.status) ? r.status : "backlog";
      const list = out.get(r.parent_id);
      if (list) list.push(status);
      else out.set(r.parent_id, [status]);
    }
    return out;
  }

  /**
   * The cards waiting on this one — the successor half of `dependsOn`, which the column is only
   * ever read from the other way round (`getCard(card.dependsOn)`, the gate in cards.ts).
   *
   * NOT INDEXED, on purpose: this is a table scan, and it runs only when a card reaches
   * `done`/`archived` (bridge/board-notify.ts, NOTIFY_AUDIT.md §6.3 B4) — a rare fact on a board
   * whose size is counted in hundreds. Add the index when a scan per finished card stops being
   * free, not before.
   */
  dependentsOf(cardId: string): Card[] {
    return this.db
      .query<CardRow, [string]>("SELECT * FROM card WHERE depends_on = ? ORDER BY position, created_at")
      .all(cardId)
      .map(toCard);
  }

  /** A card's split children, in board order. Empty for the overwhelming majority of cards. */
  listChildren(parentId: string): Card[] {
    return this.db
      .query<CardRow, [string]>("SELECT * FROM card WHERE parent_id = ? ORDER BY position, created_at")
      .all(parentId)
      .map(toCard);
  }

  deleteCard(id: string): void {
    // Detach anything pointing AT this card before it goes. Deleting a container must not take its
    // children with it (they are the actual work), and deleting a predecessor must UNBLOCK its
    // successor rather than leave it waiting on a card that no longer exists — a card wedged
    // forever behind a ghost is the worst failure this feature could have.
    this.db.query("UPDATE card SET parent_id = NULL WHERE parent_id = ?").run(id);
    this.db.query("UPDATE card SET depends_on = NULL WHERE depends_on = ?").run(id);
    // Then the card's own rows — the FK is ON, so an ordered delete is the whole "cascade".
    this.db.query("DELETE FROM review WHERE card_id = ?").run(id);
    this.db.query("DELETE FROM session WHERE card_id = ?").run(id);
    this.db.query("DELETE FROM event WHERE card_id = ?").run(id);
    this.db.query("DELETE FROM card WHERE id = ?").run(id);
  }

  // ── runs ────────────────────────────────────────────────────────────────────

  /**
   * Record the operator's gesture: one run row, and `run_id` on every member, in one transaction.
   * Refuses — nothing written — a card that is missing or of another repo: a run is one repo's.
   * `planned` writes a LOT (ADR 0021): the same row, `launched_at` NULL, driving nothing until
   * {@link launchRun}.
   */
  createRun(input: {
    repoPath: string;
    cardIds: string[];
    foldInCap: number;
    leadAgent?: string | null;
    planned?: boolean;
    phaseId?: string | null;
    name?: string | null;
    position?: number;
    maxParallel?: number | null;
    integration?: Integration;
  }): Run {
    const id = crypto.randomUUID();
    const shared = !!this.repoShare(input.repoPath);
    this.db.transaction(() => {
      const ts = this.now();
      this.db
        .query(
          `INSERT INTO run (id, repo_path, created_at, fold_in_cap, lead_agent, phase_id, name, position, launched_at, max_parallel, integration, created_by, created_pair)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.repoPath,
          ts,
          input.foldInCap,
          input.leadAgent ?? null,
          input.phaseId ?? null,
          input.name ?? null,
          input.position ?? 0,
          input.planned ? null : ts,
          input.maxParallel ?? null,
          input.integration ?? "card",
          // Derived, like a card's (ADR 0048 §5/§7): the pair creating it, when its repo is shared.
          shared ? (this.peerIdentities.get(input.repoPath) ?? null) : null,
          shared ? this.localPair : null,
        );
      const join = this.db.query("UPDATE card SET run_id = ? WHERE id = ? AND repo_path = ?");
      for (const cardId of input.cardIds) {
        // `changes` counts the journal trigger's rows too (bun:sqlite): 0 is the only "no such card".
        if (join.run(id, cardId, input.repoPath).changes === 0) {
          throw new Error(`card ${cardId} is not a card of ${input.repoPath}`);
        }
      }
    })();
    return this.getRun(id)!;
  }

  /** The lot branch and its base, written once when the first card of a `lot` run starts. */
  setLotBranch(id: string, branch: string, base: string): void {
    this.db.query("UPDATE run SET lot_branch = ?, lot_base = ? WHERE id = ?").run(branch, base, id);
  }

  /** Launch a planned lot. False when it is missing or already launched — launching is once. */
  launchRun(id: string): boolean {
    return this.db.query("UPDATE run SET launched_at = ? WHERE id = ? AND launched_at IS NULL").run(this.now(), id).changes > 0;
  }

  /**
   * Edit a PLANNED lot: its name, order, phase and members. A launched run is the coordinator's and
   * is not edited. `cardIds` replaces the membership: leavers are released, joiners must be cards of
   * the lot's repo that are in no run — nothing is written otherwise.
   */
  updateLot(
    id: string,
    patch: { name?: string | null; position?: number; phaseId?: string | null; cardIds?: string[]; maxParallel?: number | null; integration?: Integration },
  ): Run | null {
    const run = this.getRun(id);
    if (!run || run.launchedAt !== null) return null;
    this.db.transaction(() => {
      if (patch.name !== undefined) this.db.query("UPDATE run SET name = ? WHERE id = ?").run(patch.name, id);
      if (patch.position !== undefined) this.db.query("UPDATE run SET position = ? WHERE id = ?").run(patch.position, id);
      if (patch.phaseId !== undefined) this.db.query("UPDATE run SET phase_id = ? WHERE id = ?").run(patch.phaseId, id);
      if (patch.maxParallel !== undefined) this.db.query("UPDATE run SET max_parallel = ? WHERE id = ?").run(patch.maxParallel, id);
      if (patch.integration !== undefined) this.db.query("UPDATE run SET integration = ? WHERE id = ?").run(patch.integration, id);
      if (patch.cardIds) {
        const want = new Set(patch.cardIds);
        for (const m of this.runMembers(id)) {
          if (!want.has(m.id)) this.db.query("UPDATE card SET run_id = NULL WHERE id = ?").run(m.id);
        }
        const join = this.db.query("UPDATE card SET run_id = ? WHERE id = ? AND repo_path = ? AND (run_id IS NULL OR run_id = ?)");
        for (const cardId of want) {
          if (join.run(id, cardId, run.repoPath, id).changes === 0) {
            throw new Error(`card ${cardId} is not a free card of ${run.repoPath}`);
          }
        }
      }
    })();
    return this.getRun(id);
  }

  /** Drop a planned lot, releasing its cards. False for a missing or launched one. */
  deleteLot(id: string): boolean {
    const run = this.getRun(id);
    if (!run || run.launchedAt !== null) return false;
    this.db.transaction(() => {
      this.db.query("UPDATE card SET run_id = NULL WHERE run_id = ?").run(id);
      this.db.query("DELETE FROM run WHERE id = ?").run(id);
    })();
    return true;
  }

  /** Every run, planned or launched, in plan order — optionally one repo's. */
  listRuns(repoPath?: string): Run[] {
    const rows = repoPath
      ? this.db.query<RunRow, [string]>("SELECT * FROM run WHERE repo_path = ? ORDER BY position, created_at").all(repoPath)
      : this.db.query<RunRow, []>("SELECT * FROM run ORDER BY position, created_at").all();
    return rows.map(toRun);
  }

  getRun(id: string): Run | null {
    const r = this.db.query<RunRow, [string]>("SELECT * FROM run WHERE id = ?").get(id);
    return r ? toRun(r) : null;
  }

  /**
   * The launched runs not yet finished — by the local `run.finished`, or the shared `finished_at` a
   * creator's coordinator wrote. Every pair's: the coordinator keeps to {@link ownsRun}. A planned lot is not in it.
   */
  listOpenRuns(): Run[] {
    return this.db
      .query<RunRow, []>(
        `SELECT * FROM run WHERE launched_at IS NOT NULL AND finished_at IS NULL AND id NOT IN (
           SELECT json_extract(payload, '$.runId') FROM event WHERE type = 'run.finished')
         ORDER BY created_at`,
      )
      .all()
      .map(toRun);
  }

  /** Whether the coordinator journaled `run.finished` for this run — the end of {@link listOpenRuns}. */
  runFinished(id: string): boolean {
    return this.runFinishedAt(id) !== null;
  }

  /** When this run finished: the local `run.finished` event's ts, else the shared `finished_at` another pair pushed. */
  runFinishedAt(id: string): number | null {
    return (
      this.db
        .query<{ ts: number | null }, [string]>(
          `SELECT COALESCE((SELECT MIN(ts) FROM event WHERE type = 'run.finished' AND json_extract(payload, '$.runId') = ?1),
                           (SELECT finished_at FROM run WHERE id = ?1)) AS ts`,
        )
        .get(id)?.ts ?? null
    );
  }

  /** This pair's pair id (ADR 0048 §7), or null when no sync runs. */
  pairId(): string | null {
    return this.localPair;
  }

  /** A lot this pair may launch, resume and drive: one created here, or on no shared repo. Pure. */
  ownsRun(run: Pick<Run, "createdPair">): boolean {
    return run.createdPair === null || run.createdPair === this.localPair;
  }

  /** A follow-up the lead folded into the run: it becomes a member. */
  joinRun(cardId: string, runId: string): void {
    this.db.query("UPDATE card SET run_id = ? WHERE id = ?").run(runId, cardId);
  }

  /** The lot's cards in launch order: an in-lot `dependsOn` predecessor first, then board position. */
  runMembers(runId: string): Card[] {
    return byDependsOn(
      this.db
        .query<CardRow, [string]>("SELECT * FROM card WHERE run_id = ? ORDER BY position, created_at")
        .all(runId)
        .map(toCard),
    );
  }

  /** {@link recordEvent}, typed to the `run.*` kinds so a payload can't drift from its shape. */
  recordRunEvent<K extends RunEventKind>(cardId: string | null, kind: K, payload: RunEventPayloads[K]): void {
    this.recordEvent(cardId, kind, payload);
    // The event stays local; its fact is shared (ADR 0048 §7) — the other pairs see the lot finish.
    if (kind === "run.finished") this.db.query("UPDATE run SET finished_at = ? WHERE id = ? AND finished_at IS NULL").run(this.now(), payload.runId);
  }

  // ── sessions ────────────────────────────────────────────────────────────────

  openSession(input: {
    cardId: string;
    paneId: string | null;
    agentSessionId?: string | null;
    agentKind?: string | null;
  }): CardSession {
    const id = crypto.randomUUID();
    const ts = this.now();
    this.db
      .query(
        `INSERT INTO session (id, card_id, pane_id, agent_session_id, agent_kind, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.cardId, input.paneId, input.agentSessionId ?? null, input.agentKind ?? null, ts);
    this.recordEvent(input.cardId, "session.opened", { sessionId: id, paneId: input.paneId });
    return this.getSession(id)!;
  }

  getSession(id: string): CardSession | null {
    const row = this.db.query<SessionRow, [string]>("SELECT * FROM session WHERE id = ?").get(id);
    return row ? toSession(row) : null;
  }

  /** The card's still-running session, if any. At most one is open per card by construction. */
  openSessionFor(cardId: string): CardSession | null {
    const row = this.db
      .query<SessionRow, [string]>(
        "SELECT * FROM session WHERE card_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1",
      )
      .get(cardId);
    return row ? toSession(row) : null;
  }

  /**
   * The open session running in a herdr pane, or null — the other direction of {@link openSessionFor},
   * for the one caller that knows its pane and not its card: an agent filing a card mid-turn
   * (ADR 0010), which reads `HERDR_PANE_ID` out of its own environment.
   *
   * Open sessions only, and that is the point rather than an optimisation: herdr reuses pane ids
   * after a restart, so a closed session's pane is not evidence of anything. No match is the normal
   * answer for a pane the board never started, and the caller must degrade rather than guess.
   */
  openSessionByPane(paneId: string): CardSession | null {
    const row = this.db
      .query<SessionRow, [string]>(
        "SELECT * FROM session WHERE pane_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1",
      )
      .get(paneId);
    return row ? toSession(row) : null;
  }

  /**
   * The newest session ever opened on this pane, ended or not — what « Ménage » (tidy.ts) reads to
   * tell a filed card's pane, which outlives its session. Pane ids are reused after a herdr restart,
   * so this is a hint shown to the operator, never a reason to act on its own.
   */
  lastSessionByPane(paneId: string): CardSession | null {
    const row = this.db
      .query<SessionRow, [string]>("SELECT * FROM session WHERE pane_id = ? ORDER BY started_at DESC LIMIT 1")
      .get(paneId);
    return row ? toSession(row) : null;
  }

  /** Every session for a card, oldest first — the handoff chain, in the order it happened. */
  listSessions(cardId: string): CardSession[] {
    return this.db
      .query<SessionRow, [string]>("SELECT * FROM session WHERE card_id = ? ORDER BY started_at")
      .all(cardId)
      .map(toSession);
  }

  /** All open sessions across every card — reconciliation reads this once per tick. */
  listOpenSessions(): CardSession[] {
    return this.db
      .query<SessionRow, []>("SELECT * FROM session WHERE ended_at IS NULL")
      .all()
      .map(toSession);
  }

  /**
   * Closed sessions still waiting on a wrapup note. A closed session with the marker still set means
   * exactly that and nothing else — see `isPendingWrapup`. Normally empty, and the table holds one
   * row per card session, so this stays a small scan; it gets an index the day that stops being true.
   */
  listPendingWrapups(): CardSession[] {
    return this.db
      .query<SessionRow, []>(
        "SELECT * FROM session WHERE ended_at IS NOT NULL AND handoff_requested_at IS NOT NULL",
      )
      .all()
      .map(toSession);
  }

  patchSession(
    id: string,
    patch: {
      paneId?: string | null;
      agentSessionId?: string | null;
      ctxTokens?: number | null;
      ctxPct?: number | null;
      handoffMd?: string | null;
      handoffRequestedAt?: number | null;
      autoHandoffAt?: number | null;
    },
  ): CardSession | null {
    const columns: Record<string, string> = {
      paneId: "pane_id",
      agentSessionId: "agent_session_id",
      ctxTokens: "ctx_tokens",
      ctxPct: "ctx_pct",
      handoffMd: "handoff_md",
      handoffRequestedAt: "handoff_requested_at",
      autoHandoffAt: "auto_handoff_at",
    };
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [key, column] of Object.entries(columns)) {
      if (!(key in patch)) continue;
      sets.push(`${column} = ?`);
      values.push((patch as Record<string, string | number | null | undefined>)[key] ?? null);
    }
    if (sets.length === 0) return this.getSession(id);
    values.push(id);
    this.db.query(`UPDATE session SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return this.getSession(id);
  }

  closeSession(id: string, outcome: SessionOutcome): CardSession | null {
    const session = this.getSession(id);
    if (!session || session.endedAt !== null) return session;
    this.db
      .query("UPDATE session SET outcome = ?, ended_at = ? WHERE id = ?")
      .run(outcome, this.now(), id);
    this.recordEvent(session.cardId, "session.closed", { sessionId: id, outcome });
    return this.getSession(id);
  }

  // ── reviews ─────────────────────────────────────────────────────────────────

  createReview(input: {
    cardId: string;
    sessionId?: string | null;
    verdict?: string | null;
    notes?: string | null;
    todos?: ReviewTodo[];
    /**
     * Set when a PERSON attached this by hand — the id of the card that became the action on it
     * (`convertToAction`, cards.ts). Journals `card.action_added` rather than `review.created`,
     * because both readers of that event would otherwise say something false: the journal would
     * credit the copilot with a review it never ran, and the bell would announce it (board-notify.ts
     * `tell`, B2). An alert for a tap you just made is exactly what the fork's §6 refuses.
     */
    convertedFrom?: string;
  }): Review {
    const id = crypto.randomUUID();
    this.db
      .query(
        `INSERT INTO review (id, card_id, session_id, verdict, notes, todos, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.cardId,
        input.sessionId ?? null,
        input.verdict ?? null,
        input.notes ?? null,
        JSON.stringify(input.todos ?? []),
        this.now(),
      );
    if (input.convertedFrom) {
      this.recordEvent(input.cardId, "card.action_added", {
        reviewId: id,
        from: input.convertedFrom,
        title: input.todos?.[0]?.title ?? null,
      });
    } else {
      this.recordEvent(input.cardId, "review.created", { reviewId: id, verdict: input.verdict ?? null });
    }
    return this.getReview(id)!;
  }

  getReview(id: string): Review | null {
    const row = this.db.query<ReviewRow, [string]>("SELECT * FROM review WHERE id = ?").get(id);
    return row ? toReview(row) : null;
  }

  /**
   * Mark one {@link TinyTodo} as handed to the agent. The only write a review ever gets after it is
   * created — and it has to be durable: without it the offer stays live, and a second tap makes the
   * agent do the same edit twice (the hazard `promptAndConfirm` warns about).
   *
   * Keyed by TITLE inside the review, because that is what the client has and what the row shows.
   * Idempotent: a todo already marked keeps its first timestamp.
   */
  markTinyTodoDone(reviewId: string, title: string): Review | null {
    const review = this.getReview(reviewId);
    if (!review) return null;
    const todos = review.todos.map((t) =>
      t.title === title && t.tiny && t.tiny.doneAt === null ? { ...t, tiny: { ...t.tiny, doneAt: this.now() } } : t,
    );
    this.db.query("UPDATE review SET todos = ? WHERE id = ?").run(JSON.stringify(todos), reviewId);
    return this.getReview(reviewId);
  }

  listReviews(cardId: string): Review[] {
    return this.db
      // `rowid` breaks the tie: the card screen shows these newest-first, and two rows written in
      // the same millisecond (a conversion filed right after a verdict) would otherwise come back in
      // whatever order SQLite felt like — which is the stale verdict back on top.
      .query<ReviewRow, [string]>("SELECT * FROM review WHERE card_id = ? ORDER BY created_at, rowid")
      .all(cardId)
      .map(toReview);
  }

  // ── phases (ADR 0021) ───────────────────────────────────────────────────────

  createPhase(input: { repoPath: string; name: string; goal?: string; position?: number; roadmapItemId?: string | null; templateId?: string | null }): Phase {
    const id = crypto.randomUUID();
    const ts = this.now();
    const next =
      this.db.query<{ p: number | null }, [string]>("SELECT MAX(position) AS p FROM phase WHERE repo_path = ?").get(input.repoPath)?.p ?? -1;
    this.db
      .query(
        `INSERT INTO phase (id, repo_path, name, goal, position, roadmap_item_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.repoPath, input.name, input.goal ?? "", input.position ?? next + 1, input.roadmapItemId ?? null, ts, ts);
    if (input.templateId) this.db.query("UPDATE phase SET template_id = ? WHERE id = ?").run(input.templateId, id);
    return this.getPhase(id)!;
  }

  getPhase(id: string): Phase | null {
    const r = this.db.query<PhaseRow, [string]>("SELECT * FROM phase WHERE id = ?").get(id);
    return r ? toPhase(r) : null;
  }

  listPhases(repoPath?: string): Phase[] {
    const rows = repoPath
      ? this.db.query<PhaseRow, [string]>("SELECT * FROM phase WHERE repo_path = ? ORDER BY position, created_at").all(repoPath)
      : this.db.query<PhaseRow, []>("SELECT * FROM phase ORDER BY position, created_at").all();
    return rows.map(toPhase);
  }

  updatePhase(
    id: string,
    patch: { name?: string; goal?: string; position?: number; roadmapItemId?: string | null; templateId?: string | null; pipelineId?: string | null },
  ): Phase | null {
    if (!this.getPhase(id)) return null;
    const cols: [string, string | number | null][] = [];
    if (patch.name !== undefined) cols.push(["name", patch.name]);
    if (patch.goal !== undefined) cols.push(["goal", patch.goal]);
    if (patch.position !== undefined) cols.push(["position", patch.position]);
    if (patch.roadmapItemId !== undefined) cols.push(["roadmap_item_id", patch.roadmapItemId]);
    if (patch.templateId !== undefined) cols.push(["template_id", patch.templateId]);
    if (patch.pipelineId !== undefined) cols.push(["pipeline_id", patch.pipelineId]);
    cols.push(["updated_at", this.now()]);
    // Column names come from the literals above, never from the caller.
    this.db.query(`UPDATE phase SET ${cols.map(([c]) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...cols.map(([, v]) => v), id);
    return this.getPhase(id);
  }

  // ── agent templates (ADR 0026) ──────────────────────────────────────────────

  listTemplates(): AgentTemplate[] {
    return this.db
      .query<TemplateRow, []>("SELECT * FROM agent_template ORDER BY builtin DESC, created_at, name")
      .all()
      .map(toTemplate);
  }

  getTemplate(id: string): AgentTemplate | null {
    const r = this.db.query<TemplateRow, [string]>("SELECT * FROM agent_template WHERE id = ?").get(id);
    return r ? toTemplate(r) : null;
  }

  createTemplate(input: { name: string; description?: string; agentKind?: string | null; model?: string | null; brief: string; worker?: boolean }): AgentTemplate {
    const id = crypto.randomUUID();
    const ts = this.now();
    this.db
      .query(
        `INSERT INTO agent_template (id, key, name, description, agent_kind, model, brief, worker, builtin, created_at, updated_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(id, input.name, input.description ?? "", input.agentKind ?? null, input.model ?? null, input.brief, input.worker ? 1 : 0, ts, ts);
    return this.getTemplate(id)!;
  }

  updateTemplate(
    id: string,
    patch: { name?: string; description?: string; agentKind?: string | null; model?: string | null; brief?: string; worker?: boolean },
  ): AgentTemplate | null {
    if (!this.getTemplate(id)) return null;
    const cols: [string, string | null | number][] = [];
    if (patch.name !== undefined) cols.push(["name", patch.name]);
    if (patch.description !== undefined) cols.push(["description", patch.description]);
    if (patch.agentKind !== undefined) cols.push(["agent_kind", patch.agentKind]);
    if (patch.model !== undefined) cols.push(["model", patch.model]);
    if (patch.brief !== undefined) cols.push(["brief", patch.brief]);
    if (patch.worker !== undefined) cols.push(["worker", patch.worker ? 1 : 0]);
    cols.push(["updated_at", this.now()]);
    // Column names come from the literals above, never from the caller.
    this.db.query(`UPDATE agent_template SET ${cols.map(([c]) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...cols.map(([, v]) => v), id);
    return this.getTemplate(id);
  }

  // ── agent flows (ADR 0032) ──────────────────────────────────────────────────

  listFlows(): AgentFlow[] {
    return this.db.query<FlowRow, []>("SELECT * FROM agent_flow ORDER BY builtin DESC, created_at, name").all().map(toFlow);
  }

  getFlow(id: string): AgentFlow | null {
    const r = this.db.query<FlowRow, [string]>("SELECT * FROM agent_flow WHERE id = ?").get(id);
    return r ? toFlow(r) : null;
  }

  createFlow(input: { name: string; description?: string; steps: string[] }): AgentFlow {
    const id = crypto.randomUUID();
    const ts = this.now();
    this.db
      .query(`INSERT INTO agent_flow (id, key, name, description, steps, builtin, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, 0, ?, ?)`)
      .run(id, input.name, input.description ?? "", JSON.stringify(input.steps), ts, ts);
    return this.getFlow(id)!;
  }

  updateFlow(id: string, patch: { name?: string; description?: string; steps?: string[] }): AgentFlow | null {
    if (!this.getFlow(id)) return null;
    const cols: [string, string | number][] = [];
    if (patch.name !== undefined) cols.push(["name", patch.name]);
    if (patch.description !== undefined) cols.push(["description", patch.description]);
    if (patch.steps !== undefined) cols.push(["steps", JSON.stringify(patch.steps)]);
    cols.push(["updated_at", this.now()]);
    // Column names come from the literals above, never from the caller.
    this.db.query(`UPDATE agent_flow SET ${cols.map(([c]) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...cols.map(([, v]) => v), id);
    return this.getFlow(id);
  }

  /** A shipped flow is reset, never deleted. A deleted one is released from every card, phase and repo. */
  deleteFlow(id: string): "deleted" | "builtin" | "missing" {
    const f = this.getFlow(id);
    if (!f) return "missing";
    if (f.builtin) return "builtin";
    this.db.transaction(() => {
      this.db.query("UPDATE card SET pipeline_id = NULL WHERE pipeline_id = ?").run(id);
      this.db.query("UPDATE phase SET pipeline_id = NULL WHERE pipeline_id = ?").run(id);
      this.db.query("UPDATE repo_pref SET flow_id = NULL WHERE flow_id = ?").run(id);
      this.db.query("DELETE FROM agent_flow WHERE id = ?").run(id);
    })();
    return "deleted";
  }

  /** Put a shipped flow back as it was shipped. Null for a custom one. */
  resetFlow(id: string): AgentFlow | null {
    const f = this.getFlow(id);
    const shipped = f?.key ? BUILTIN_FLOWS.find((b) => b.key === f.key) : undefined;
    if (!f || !shipped) return null;
    return this.updateFlow(id, { name: shipped.name, description: shipped.description, steps: this.shippedSteps(shipped.roles) });
  }

  /** `builtin`: a shipped template is reset, never deleted. A deleted one is released from every card and phase. */
  deleteTemplate(id: string): "deleted" | "builtin" | "missing" {
    const t = this.getTemplate(id);
    if (!t) return "missing";
    if (t.builtin) return "builtin";
    this.db.transaction(() => {
      this.db.query("UPDATE card SET template_id = NULL WHERE template_id = ?").run(id);
      this.db.query("UPDATE phase SET template_id = NULL WHERE template_id = ?").run(id);
      // A flow made of it loses that step on the spot, rather than silently shrinking at read time.
      for (const f of this.listFlows()) {
        if (f.steps.includes(id)) this.db.query("UPDATE agent_flow SET steps = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(f.steps.filter((s) => s !== id)), this.now(), f.id);
      }
      this.db.query("DELETE FROM agent_template WHERE id = ?").run(id);
    })();
    return "deleted";
  }

  /** Put a shipped template back as it was shipped. Null for a custom one (nothing to go back to). */
  resetTemplate(id: string): AgentTemplate | null {
    const t = this.getTemplate(id);
    const shipped = t?.key ? BUILTIN_TEMPLATES.find((b) => b.key === t.key) : undefined;
    if (!t || !shipped) return null;
    return this.updateTemplate(id, {
      name: shipped.name,
      description: shipped.description,
      agentKind: shipped.agentKind,
      model: shipped.model,
      brief: shipped.brief,
      worker: shipped.worker,
    });
  }

  /** No card (archived included) and no lot in the phase. */
  phaseIsEmpty(id: string): boolean {
    return !this.db.query("SELECT 1 FROM card WHERE phase_id = ?1 UNION ALL SELECT 1 FROM run WHERE phase_id = ?1 LIMIT 1").get(id);
  }

  /** Delete a phase. Its cards and lots are released, not deleted — a phase is a grouping. */
  deletePhase(id: string): boolean {
    if (!this.getPhase(id)) return false;
    this.db.transaction(() => {
      this.db.query("UPDATE card SET phase_id = NULL WHERE phase_id = ?").run(id);
      this.db.query("UPDATE run SET phase_id = NULL WHERE phase_id = ?").run(id);
      this.db.query("DELETE FROM phase WHERE id = ?").run(id);
    })();
    return true;
  }

  // ── milestones (ADR 0025) ───────────────────────────────────────────────────

  /** A lot of the phase that is not over: planned (it holds cards and drives nothing, unless they are all done) or launched and not finished. */
  phaseHasUnfinishedLot(phaseId: string): boolean {
    const open = new Set(this.listOpenRuns().map((r) => r.id));
    return this.listRuns().some((r) => r.phaseId === phaseId && ((r.launchedAt === null && !doneOutsideLot(r, this.runMembers(r.id))) || open.has(r.id)));
  }

  /**
   * Validate a phase. Its finished cards stay in it, frozen; its OPEN ones go to `moveOpenTo` (another
   * open phase of the repo, or null = no phase). The linked roadmap item, if any, becomes `done`. The
   * route has already checked the target and the lots — this writes, atomically.
   */
  closePhase(id: string, input: { moveOpenTo: string | null; note?: string }): Phase | null {
    const phase = this.getPhase(id);
    if (!phase || phase.closedAt !== null) return null;
    this.db.transaction(() => {
      const ts = this.now();
      this.db
        .query("UPDATE card SET phase_id = ? WHERE phase_id = ? AND status NOT IN ('done', 'archived')")
        .run(input.moveOpenTo, id);
      this.db
        .query("UPDATE phase SET closed_at = ?, closed_note = ?, updated_at = ? WHERE id = ?")
        .run(ts, (input.note ?? "").slice(0, PHASE_NOTE_MAX), ts, id);
      if (phase.roadmapItemId) this.markRoadmapItemDone(phase.repoPath, phase.roadmapItemId);
    })();
    return this.getPhase(id);
  }

  /** Take a phase back to the work in progress. Its cards are where they were left. */
  reopenPhase(id: string): Phase | null {
    const phase = this.getPhase(id);
    if (!phase || phase.closedAt === null) return null;
    this.db.query("UPDATE phase SET closed_at = NULL, updated_at = ? WHERE id = ?").run(this.now(), id);
    return this.getPhase(id);
  }

  /**
   * An old project with no phases: make a phase that is ALREADY validated and file under it every
   * finished card of the repo that has none. Only those — the open ones stay where they are, unless
   * `moveOpenTo` sends the phase-less open ones to an existing open phase. `moved` is 0 when there was
   * nothing to file, and then nothing is created.
   */
  sealPhase(input: {
    repoPath: string;
    name: string;
    goal?: string;
    note?: string;
    moveOpenTo?: string | null;
    /** Only these (finished, phase-less) cards; omitted, every one the repo has. */
    cardIds?: string[];
  }): { phase: Phase | null; moved: number } {
    return this.db.transaction(() => {
      // A container holds no work of its own and is never a step, so it is not filed as one.
      const all = this.db
        .query<{ id: string }, [string]>(
          `SELECT id FROM card WHERE repo_path = ? AND phase_id IS NULL AND status = 'done'
             AND id NOT IN (SELECT parent_id FROM card WHERE parent_id IS NOT NULL)`,
        )
        .all(input.repoPath)
        .map((r) => r.id);
      const want = input.cardIds ? new Set(input.cardIds) : null;
      const ids = want ? all.filter((id) => want.has(id)) : all;
      if (ids.length === 0) return { phase: null, moved: 0 };
      const phase = this.createPhase({ repoPath: input.repoPath, name: input.name, goal: input.goal });
      const ts = this.now();
      const mark = this.db.query("UPDATE card SET phase_id = ? WHERE id = ?");
      for (const id of ids) mark.run(phase.id, id);
      if (input.moveOpenTo)
        this.db
          .query("UPDATE card SET phase_id = ? WHERE repo_path = ? AND phase_id IS NULL AND status NOT IN ('done', 'archived')")
          .run(input.moveOpenTo, input.repoPath);
      this.db
        .query("UPDATE phase SET closed_at = ?, closed_note = ?, updated_at = ? WHERE id = ?")
        .run(ts, (input.note ?? "").slice(0, PHASE_NOTE_MAX), ts, phase.id);
      return { phase: this.getPhase(phase.id), moved: ids.length };
    })();
  }

  /** Mark one roadmap item done, bumping the revision like any write. No roadmap or no such item: nothing. */
  private markRoadmapItemDone(repoPath: string, itemId: string): void {
    const rm = this.getRoadmap(repoPath);
    if (!rm || !rm.items.some((i) => i.id === itemId && i.status !== "done")) return;
    this.writeRoadmap(
      repoPath,
      rm.vision,
      rm.items.map((i) => (i.id === itemId ? { ...i, status: "done" as const } : i)),
      rm.decisions,
      rm.revision + 1,
    );
  }

  // ── roadmap (ADR 0021) ──────────────────────────────────────────────────────

  getRoadmap(repoPath: string): Roadmap | null {
    const r = this.db.query<RoadmapRow, [string]>("SELECT * FROM roadmap WHERE repo_path = ?").get(repoPath);
    return r ? toRoadmap(r) : null;
  }

  /**
   * Replace a repo's roadmap. `revision` is the one the caller READ (0 when there was none): any
   * other value means someone wrote in between, and nothing is written — {@link RevisionConflict}.
   */
  putRoadmap(
    repoPath: string,
    doc: { vision: string; items: RoadmapItem[]; decisions?: Decision[] },
    revision: number,
  ): Roadmap {
    return this.db.transaction(() => {
      const before = this.getRoadmap(repoPath);
      const current = before?.revision ?? 0;
      if (revision !== current) throw new RevisionConflict(current);
      // A PUT that says nothing of the decisions leaves the journal as it is: the operator's
      // editor and the orchestrator's decision writes must not erase each other.
      this.writeRoadmap(repoPath, doc.vision, doc.items, doc.decisions ?? before?.decisions ?? [], current + 1);
      return this.getRoadmap(repoPath)!;
    })();
  }

  /**
   * Upsert ONE decision (ADR 0023) — the orchestrator writes them as they are taken, so this asks for
   * no revision: it reads the current document inside its own transaction and bumps it. An unknown
   * `id` adds; a known one replaces. Past the ceiling it refuses rather than dropping an old one.
   */
  upsertDecision(
    repoPath: string,
    input: { id?: string; text: string; status: DecisionStatus; itemId?: string | null; cardId?: string | null },
  ): { roadmap: Roadmap; decision: Decision } {
    return this.db.transaction(() => {
      const before = this.getRoadmap(repoPath);
      const decisions = [...(before?.decisions ?? [])];
      const id = input.id ?? crypto.randomUUID().slice(0, 8);
      const at = decisions.findIndex((d) => d.id === id);
      // A question settled without restating its card keeps it: the journal still says what it was about.
      const cardId = input.cardId ?? (at >= 0 ? decisions[at]!.cardId : undefined);
      const decision: Decision = { id, text: input.text, status: input.status, itemId: input.itemId ?? null, ...(cardId ? { cardId } : {}) };
      if (at >= 0) decisions[at] = decision;
      else if (decisions.length >= ROADMAP_MAX_DECISIONS) throw new Error(`a roadmap keeps at most ${ROADMAP_MAX_DECISIONS} decisions`);
      else decisions.push(decision);
      this.writeRoadmap(repoPath, before?.vision ?? "", before?.items ?? [], decisions, (before?.revision ?? 0) + 1);
      return { roadmap: this.getRoadmap(repoPath)!, decision };
    })();
  }

  private writeRoadmap(repoPath: string, vision: string, items: RoadmapItem[], decisions: Decision[], revision: number): void {
    this.db
      .query(
        `INSERT INTO roadmap (repo_path, vision, items, decisions, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(repo_path) DO UPDATE SET vision = excluded.vision, items = excluded.items,
           decisions = excluded.decisions, revision = excluded.revision, updated_at = excluded.updated_at`,
      )
      .run(repoPath, vision, JSON.stringify(items), JSON.stringify(decisions), revision, this.now());
  }

  // ── the orchestrator's memory (ADR 0023) ─────────────────────────────────────

  getMemory(repoPath: string): OrchestratorMemory | null {
    const r = this.db
      .query<{ repo_path: string; note: string; updated_at: number }, [string]>("SELECT * FROM orchestrator_memory WHERE repo_path = ?")
      .get(repoPath);
    return r ? { repoPath: r.repo_path, note: r.note, updatedAt: r.updated_at } : null;
  }

  /** Last writer wins — one note, the newest. The caller bounds its length. */
  putMemory(repoPath: string, note: string): OrchestratorMemory {
    this.db
      .query(
        `INSERT INTO orchestrator_memory (repo_path, note, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(repo_path) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at`,
      )
      .run(repoPath, note, this.now());
    return this.getMemory(repoPath)!;
  }

  // ── the orchestrator's autonomy (ADR 0030) ───────────────────────────────────

  autonomyOf(path: string): RepoAutonomy {
    const r = this.db
      .query<{ enabled: number; max_chain: number | null; stop_on_red: number; chained: number; armed: number; start_when_idle: number; max_rounds: number }, [string]>(
        "SELECT * FROM repo_autonomy WHERE path = ?",
      )
      .get(path);
    return r
      ? { enabled: r.enabled === 1, maxChain: r.max_chain, stopOnRed: r.stop_on_red === 1, chained: r.chained, armed: r.armed === 1, startWhenIdle: r.start_when_idle === 1, maxRounds: r.max_rounds }
      : { enabled: false, maxChain: 1, stopOnRed: true, chained: 0, armed: false, startWhenIdle: false, maxRounds: DEFAULT_MAX_ROUNDS };
  }

  /** The operator's settings. Turning it off disarms; turning it (or `startWhenIdle`) on starts a fresh chain. */
  setAutonomy(path: string, s: Pick<RepoAutonomy, "enabled" | "maxChain" | "stopOnRed" | "startWhenIdle" | "maxRounds">): RepoAutonomy {
    const was = this.autonomyOf(path);
    const fresh = (s.enabled && !was.enabled) || (s.enabled && s.startWhenIdle && !was.startWhenIdle);
    this.db
      .query(
        `INSERT INTO repo_autonomy (path, enabled, max_chain, stop_on_red, start_when_idle, max_rounds, chained, armed) VALUES (?, ?, ?, ?, ?, ?, 0, 0)
         ON CONFLICT(path) DO UPDATE SET enabled = excluded.enabled, max_chain = excluded.max_chain, stop_on_red = excluded.stop_on_red,
           start_when_idle = excluded.start_when_idle, max_rounds = excluded.max_rounds,
           chained = CASE WHEN ? THEN 0 ELSE chained END, armed = CASE WHEN excluded.enabled = 1 THEN armed ELSE 0 END`,
      )
      .run(path, s.enabled ? 1 : 0, s.maxChain, s.stopOnRed ? 1 : 0, s.startWhenIdle ? 1 : 0, s.maxRounds, fresh ? 1 : 0);
    return this.autonomyOf(path);
  }

  /** The end-of-lot wake grants (or withdraws) the one launch the orchestrator may make. */
  armAutonomy(path: string, armed: boolean): void {
    this.db.query("UPDATE repo_autonomy SET armed = ? WHERE path = ?").run(armed ? 1 : 0, path);
  }

  /**
   * The orchestrator launches: spends the grant, counts one more lot chained. False when not armed —
   * or, for an `idle` start (ADR 0047), when the operator has not allowed one.
   */
  spendAutonomy(path: string, idle = false): boolean {
    return (
      this.db
        .query("UPDATE repo_autonomy SET armed = 0, chained = chained + 1 WHERE path = ? AND enabled = 1 AND (armed = 1 OR (? AND start_when_idle = 1))")
        .run(path, idle ? 1 : 0).changes === 1
    );
  }

  /** The operator launched: the chain starts again. */
  resetChain(path: string): void {
    this.db.query("UPDATE repo_autonomy SET chained = 0, armed = 0 WHERE path = ?").run(path);
  }

  // ── repo preferences ────────────────────────────────────────────────────────

  /** Paths the operator has hidden from the picker. */
  hiddenRepos(): Set<string> {
    const rows = this.db
      .query<{ path: string }, []>("SELECT path FROM repo_pref WHERE hidden = 1")
      .all();
    return new Set(rows.map((r) => r.path));
  }

  /**
   * Hide or unhide a repo. A row that says "visible, no gate" means nothing and would accumulate
   * forever, so it is deleted rather than stored — see {@link pruneRepoPref}.
   */
  setRepoHidden(path: string, hidden: boolean): void {
    this.db
      .query(
        `INSERT INTO repo_pref (path, hidden, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET hidden = excluded.hidden, updated_at = excluded.updated_at`,
      )
      .run(path, hidden ? 1 : 0, this.now());
    this.pruneRepoPref(path);
  }

  /** Repos the operator added to the project lists by hand. */
  listedRepos(): string[] {
    return this.db.query<{ path: string }, []>("SELECT path FROM repo_pref WHERE listed = 1 ORDER BY path").all().map((r) => r.path);
  }

  /** Add a repo to the project lists, or take it off. Touches no card. */
  setRepoListed(path: string, listed: boolean): void {
    this.db
      .query(
        `INSERT INTO repo_pref (path, listed, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET listed = excluded.listed, updated_at = excluded.updated_at`,
      )
      .run(path, listed ? 1 : 0, this.now());
    this.pruneRepoPref(path);
  }

  /** The repo's gate command (ADR 0020), or null. */
  repoGate(path: string): string | null {
    return (
      this.db.query<{ gate: string | null }, [string]>("SELECT gate FROM repo_pref WHERE path = ?").get(path)?.gate ?? null
    );
  }

  /** Every repo that has a gate — for the picker, which lists repos and should say which are gated. */
  repoGates(): Map<string, string> {
    const rows = this.db
      .query<{ path: string; gate: string }, []>("SELECT path, gate FROM repo_pref WHERE gate IS NOT NULL")
      .all();
    return new Map(rows.map((r) => [r.path, r.gate]));
  }

  /** Set the gate, or clear it with null. */
  setRepoGate(path: string, gate: string | null): void {
    this.db
      .query(
        `INSERT INTO repo_pref (path, gate, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET gate = excluded.gate, updated_at = excluded.updated_at`,
      )
      .run(path, gate, this.now());
    this.pruneRepoPref(path);
  }

  /** The repo's default flow (ADR 0032), or null. */
  repoFlow(path: string): string | null {
    return this.db.query<{ flow_id: string | null }, [string]>("SELECT flow_id FROM repo_pref WHERE path = ?").get(path)?.flow_id ?? null;
  }

  repoFlows(): Map<string, string> {
    const rows = this.db.query<{ path: string; flow_id: string }, []>("SELECT path, flow_id FROM repo_pref WHERE flow_id IS NOT NULL").all();
    return new Map(rows.map((r) => [r.path, r.flow_id]));
  }

  setRepoFlow(path: string, flowId: string | null): void {
    this.db
      .query(
        `INSERT INTO repo_pref (path, flow_id, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET flow_id = excluded.flow_id, updated_at = excluded.updated_at`,
      )
      .run(path, flowId, this.now());
    this.pruneRepoPref(path);
  }

  /** How a run lands a card of this repo (ADR 0043): a PR, or a merge straight into the base. */
  repoIntegration(path: string): RepoIntegration {
    const v = this.db.query<{ integration: string | null }, [string]>("SELECT integration FROM repo_pref WHERE path = ?").get(path)?.integration;
    return v === "direct" ? "direct" : "pr";
  }

  setRepoIntegration(path: string, mode: RepoIntegration): void {
    this.db
      .query(
        `INSERT INTO repo_pref (path, integration, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET integration = excluded.integration, updated_at = excluded.updated_at`,
      )
      .run(path, mode === "direct" ? "direct" : null, this.now());
    this.pruneRepoPref(path);
  }

  private pruneRepoPref(path: string): void {
    this.db.query("DELETE FROM repo_pref WHERE path = ? AND hidden = 0 AND gate IS NULL AND flow_id IS NULL AND integration IS NULL AND listed = 0 AND share IS NULL").run(path);
  }

  // ── shared journal (ADR 0048 §2) ────────────────────────────────────────────

  /** repo → this clone's git `user.email` (ADR 0048 §5), set by journal-sync and the create route. Runtime, never persisted. */
  private readonly peerIdentities = new Map<string, string>();
  /** repo → the git identities seen as the `by` of an applied journal line. Runtime: the cards' columns outlive it. */
  private readonly journalAuthors = new Map<string, Set<string>>();

  peerIdentity(repo: string): string | undefined {
    return this.peerIdentities.get(repo);
  }

  setPeerIdentity(repo: string, email: string): void {
    if (email) this.peerIdentities.set(repo, email);
  }

  /** This installation's pair id, set by the journal sync. Runtime: it lives in its own state file. */
  private localPair: string | null = null;

  setPairId(pair: string): void {
    this.localPair = pair;
  }

  /**
   * A `card.claimed` of this pair, stamped after every claim the card has seen (ADR 0048 §7) — not yet
   * applied: it is applied once the remote took it, so a refused push leaves no claim behind.
   */
  claimEntry(repoPath: string, cardId: string, clock: Hlc, by: string): JournalEntry {
    const entity = `cards/${cardId}`;
    const cur = this.db
      .query<{ hlc: string }, [string, string]>("SELECT hlc FROM journal_field WHERE repo_path = ? AND entity = ? AND field = 'claim'")
      .get(repoPath, entity)?.hlc;
    if (cur) clock.observe(cur);
    return { entity, event: { v: 1, hlc: clock.next(), type: "card.claimed", by, fields: { pair: clock.pairId, by } } };
  }

  /**
   * Who is who on each shared repo, for the screens (ADR 0048 §5): this pair's identity, and every
   * identity the repo knows — journal authors, creators, assignees. Unshared repos are absent.
   */
  identities(): Record<string, { me: string | null; pair: string | null; people: string[] }> {
    const out: Record<string, { me: string | null; pair: string | null; people: string[] }> = {};
    for (const { path } of this.sharedRepos()) {
      const me = this.peerIdentities.get(path) ?? null;
      const cols = this.db
        .query<{ v: string }, [string]>(
          "SELECT created_by AS v FROM card WHERE repo_path = ?1 AND created_by IS NOT NULL UNION SELECT assignee FROM card WHERE repo_path = ?1 AND assignee IS NOT NULL",
        )
        .all(path)
        .map((r) => r.v);
      const people = new Set([...(me ? [me] : []), ...(this.journalAuthors.get(path) ?? []), ...cols]);
      // `pair`: what a card's claim is compared with — the same person on two machines is two pairs.
      out[path] = { me, pair: this.localPair, people: [...people].sort() };
    }
    return out;
  }

  /** The remote this repo's board is shared on, or null. */
  repoShare(path: string): string | null {
    return this.db.query<{ share: string | null }, [string]>("SELECT share FROM repo_pref WHERE path = ?").get(path)?.share ?? null;
  }

  /** Every shared repo and its remote — what the sync consumer walks each tick. */
  sharedRepos(): { path: string; remote: string }[] {
    return this.db.query<{ path: string; remote: string }, []>("SELECT path, share AS remote FROM repo_pref WHERE share IS NOT NULL").all();
  }

  /** How many of a repo's writes are still waiting to be pushed — « N changements non envoyés ». */
  journalUnsent(repoPath: string): number {
    return this.db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM journal_outbox WHERE repo_path = ?").get(repoPath)!.n;
  }

  /** Drop the outbox rows a push carried; a write made during the push has a later seq and stays. */
  dropJournalOutbox(repoPath: string, upToSeq: number): void {
    this.db.query("DELETE FROM journal_outbox WHERE repo_path = ? AND seq <= ?").run(repoPath, upToSeq);
  }

  /** Share a repo's board on a remote, or stop with null — which drops what was waiting to go (§ 6). */
  setRepoShare(path: string, remote: string | null): void {
    this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO repo_pref (path, share, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(path) DO UPDATE SET share = excluded.share, updated_at = excluded.updated_at`,
        )
        .run(path, remote, this.now());
      if (remote === null) {
        this.db.query("DELETE FROM journal_outbox WHERE repo_path = ?").run(path);
        this.db.query("DELETE FROM journal_field WHERE repo_path = ?").run(path);
      }
      this.pruneRepoPref(path);
    })();
  }

  /** Run `fn` in one transaction with the journal triggers silenced: applying the journal is not a local write. */
  private muted<T>(fn: () => T): T {
    return this.db.transaction(() => {
      this.db.exec("INSERT INTO temp.journal_mute VALUES (1)");
      try {
        return fn();
      } finally {
        this.db.exec("DELETE FROM temp.journal_mute");
      }
    })();
  }

  /**
   * Give every outbox row still without one its hlc, in write order, and record what it won. Lazy on
   * purpose — a trigger has no clock — and safe because every reader of the outbox and every apply
   * stamps first: nothing is observed between a local write and its stamp.
   */
  stampJournal(clock: Hlc): void {
    const rows = this.db
      .query<{ seq: number; repo_path: string; entity: string; type: string; fields: string }, []>(
        "SELECT seq, repo_path, entity, type, fields FROM journal_outbox WHERE hlc IS NULL ORDER BY seq",
      )
      .all();
    if (rows.length === 0) return;
    const max = this.db.query<{ h: string | null }, []>("SELECT MAX(hlc) AS h FROM journal_field").get()?.h;
    if (max) clock.observe(max);
    this.db.transaction(() => {
      for (const r of rows) {
        const hlc = clock.next();
        this.db.query("UPDATE journal_outbox SET hlc = ? WHERE seq = ?").run(hlc, r.seq);
        for (const key of journalKeys({ type: r.type, hlc, fields: JSON.parse(r.fields) })) this.recordField(r.repo_path, r.entity, key, hlc);
      }
    })();
  }

  /** A repo's outbox as journal events, oldest first — what the next push appends to this pair's files. */
  journalOutbox(repoPath: string, clock: Hlc, by: string): (JournalEntry & { seq: number })[] {
    this.stampJournal(clock);
    return this.db
      .query<{ seq: number; entity: string; type: string; fields: string; hlc: string }, [string]>(
        "SELECT seq, entity, type, fields, hlc FROM journal_outbox WHERE repo_path = ? ORDER BY seq",
      )
      .all(repoPath)
      .map((r) => ({ seq: r.seq, entity: r.entity, event: { v: 1, hlc: r.hlc, type: r.type, by, fields: JSON.parse(r.fields) } }));
  }

  /**
   * Apply journal events to a repo's board: last writer per field, a tombstone is final, `card.event`
   * and `card.review` are idempotent. Any order of the same events gives the same board. What arrives
   * is untrusted: only the shareable columns of an entity OF THIS REPO are written, a value that does
   * not fit is skipped, and nothing is journaled back.
   */
  applyJournal(repoPath: string, entries: JournalEntry[], clock: Hlc): void {
    this.stampJournal(clock);
    for (const { event } of entries) clock.observe(event.hlc);
    // A pair with no `user.email` signs with its pair id: not a person to assign to.
    const authors = this.journalAuthors.get(repoPath) ?? new Set<string>();
    for (const { event } of entries) if (event.by.includes("@")) authors.add(event.by);
    this.journalAuthors.set(repoPath, authors);
    const sorted = [...entries].sort((a, b) => (a.event.hlc < b.event.hlc ? -1 : a.event.hlc > b.event.hlc ? 1 : 0));
    this.muted(() => {
      for (const { entity, event } of sorted) this.applyOne(repoPath, entity, event);
    });
  }

  /**
   * Rebuild a repo's projection from its whole journal (§ 6: activation, or doubt). The outbox not yet
   * pushed is part of it — those are events too, and would otherwise be overwritten here and win there.
   * Entities the journal does not know are left as they are.
   */
  rebuildJournal(repoPath: string, entries: JournalEntry[], clock: Hlc): void {
    const all = [...entries, ...this.journalOutbox(repoPath, clock, "self")];
    this.muted(() => {
      this.db.query("DELETE FROM journal_field WHERE repo_path = ?").run(repoPath);
      // shortcut: a card's shared lines are dropped and re-inserted with new ids, so a bell tailing the journal would see them again; lot 2 rebuilds before the tailer starts.
      const cards = new Set(all.filter((e) => e.entity.startsWith("cards/")).map((e) => e.entity.slice("cards/".length)));
      for (const id of cards) {
        if (!this.db.query("SELECT 1 FROM card WHERE id = ? AND repo_path = ?").get(id, repoPath)) continue;
        this.db.query(`DELETE FROM event WHERE card_id = ? AND NOT ${LOCAL_EVENT_SQL}`).run(id);
        this.db.query("DELETE FROM review WHERE card_id = ?").run(id);
      }
      this.applyJournal(repoPath, all, clock);
    });
  }

  /**
   * § 6: queue a `*.set` of every shareable field of each of the repo's entities the journal does not
   * know yet (no journal_field row) — the import of an activation. Returns how many were queued.
   */
  importJournal(repoPath: string): number {
    const has = (t: string) => new Set(this.db.query<{ name: string }, []>(`PRAGMA table_info(${t})`).all().map((c) => c.name));
    let n = 0;
    this.db.transaction(() => {
      for (const [kind, s] of Object.entries(SHARED)) {
        const entity = kind === "roadmap" ? "'roadmap'" : `'${s.folder}/' || t.id`;
        n += this.db
          .query(
            `INSERT INTO journal_outbox (repo_path, entity, type, fields)
             SELECT ?1, e, '${kind}.set', f FROM (SELECT ${entity} AS e, ${fieldsSql(s.columns, false, has(s.table), "t")} AS f FROM ${s.table} t WHERE t.repo_path = ?1)
             WHERE f IS NOT NULL AND NOT EXISTS (SELECT 1 FROM journal_field j WHERE j.repo_path = ?1 AND j.entity = e)`,
          )
          .run(repoPath).changes;
      }
    })();
    return n;
  }

  private recordField(repoPath: string, entity: string, field: string, hlc: string): void {
    this.db
      .query(
        `INSERT INTO journal_field (repo_path, entity, field, hlc) VALUES (?, ?, ?, ?)
         ON CONFLICT(repo_path, entity, field) DO UPDATE SET hlc = excluded.hlc`,
      )
      .run(repoPath, entity, field, hlc);
  }

  private applyOne(repoPath: string, entity: string, e: JournalEvent): void {
    const [folder, id = repoPath, extra] = entity.split("/");
    const kind = (Object.keys(SHARED) as SharedKind[]).find((k) => SHARED[k].folder === folder);
    if (!kind || extra !== undefined || (kind === "roadmap") !== (entity === "roadmap")) return;
    const s = SHARED[kind];
    const key = kind === "roadmap" ? "repo_path" : "id";
    const won = (field: string) =>
      this.db
        .query<{ hlc: string }, [string, string, string]>("SELECT hlc FROM journal_field WHERE repo_path = ? AND entity = ? AND field = ?")
        .get(repoPath, entity, field)?.hlc;
    if (won(".deleted")) return;
    // An id that is another repo's entity is not this journal's to touch.
    const ours = () => !!this.db.query(`SELECT 1 FROM ${s.table} WHERE ${key} = ? AND repo_path = ?`).get(id, repoPath);
    const exists = () => !!this.db.query(`SELECT 1 FROM ${s.table} WHERE ${key} = ?`).get(id);
    const ensure = () => {
      if (!exists()) this.db.query(s.seed).run(id, repoPath, this.now());
      return ours();
    };
    const scalar = (v: unknown) => v === null || typeof v === "string" || typeof v === "number";

    if (e.type === `${kind}.deleted`) {
      this.recordField(repoPath, entity, ".deleted", e.hlc);
      if (!ours()) return;
      if (kind === "card") return this.deleteCard(id);
      this.db.query(`UPDATE card SET ${kind}_id = NULL WHERE ${kind}_id = ?`).run(id);
      if (kind === "phase") this.db.query("UPDATE run SET phase_id = NULL WHERE phase_id = ?").run(id);
      this.db.query(`DELETE FROM ${s.table} WHERE id = ?`).run(id);
    } else if (e.type === `${kind}.set`) {
      if (!ensure()) return;
      let changed = false;
      for (const [field, value] of Object.entries(e.fields)) {
        const json = (s.columns as Record<string, boolean>)[field];
        if (json === undefined) continue;
        const v = json ? JSON.stringify(value) : value;
        if (!scalar(v) || (kind === "card" && field === "status" && !isCardStatus(v))) continue;
        const cur = won(field);
        if (cur && cur >= e.hlc) continue;
        try {
          this.db.query(`UPDATE ${s.table} SET ${field} = ? WHERE ${key} = ?`).run(v as string | number | null, id);
        } catch {
          continue; // a NOT NULL column given null: the line is wrong, the board is not
        }
        this.recordField(repoPath, entity, field, e.hlc);
        changed = true;
      }
      if (!changed) return;
      if (kind === "roadmap") this.db.query("UPDATE roadmap SET revision = revision + 1, updated_at = ? WHERE repo_path = ?").run(this.now(), id);
      else if (kind !== "run") this.db.query(`UPDATE ${s.table} SET updated_at = ? WHERE id = ?`).run(this.now(), id);
    } else if (kind === "card" && e.type === "card.event") {
      const { type, payload, ts } = e.fields;
      if (won(`@${e.hlc}`) || typeof type !== "string" || typeof ts !== "number" || !ensure()) return;
      this.db
        .query("INSERT INTO event (card_id, type, payload, ts) VALUES (?, ?, ?, ?)")
        .run(id, type, payload === null || payload === undefined ? null : JSON.stringify(payload), ts);
      this.recordField(repoPath, entity, `@${e.hlc}`, e.hlc);
    } else if (kind === "card" && e.type === "card.review") {
      const f = e.fields;
      if (typeof f.id !== "string" || typeof f.created_at !== "number" || !scalar(f.verdict) || !scalar(f.notes)) return;
      const cur = won(`review:${f.id}`);
      if ((cur && cur >= e.hlc) || !ensure()) return;
      const other = this.db.query<{ card_id: string }, [string]>("SELECT card_id FROM review WHERE id = ?").get(f.id);
      if (other && other.card_id !== id) return;
      this.db
        .query(
          `INSERT INTO review (id, card_id, verdict, notes, todos, created_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET verdict = excluded.verdict, notes = excluded.notes, todos = excluded.todos`,
        )
        .run(f.id, id, f.verdict as string | null, f.notes as string | null, JSON.stringify(f.todos ?? []), f.created_at);
      this.recordField(repoPath, entity, `review:${f.id}`, e.hlc);
    } else if (kind === "card" && e.type === "card.claimed") {
      const { pair, by } = e.fields;
      const cur = won("claim");
      if (typeof pair !== "string" || typeof by !== "string" || (cur && cur >= e.hlc) || !ensure()) return;
      this.db.query("UPDATE card SET claimed_pair = ?, claimed_by = ?, claimed_at = ? WHERE id = ?").run(pair, by, parseHlc(e.hlc)?.ms ?? this.now(), id);
      this.recordField(repoPath, entity, "claim", e.hlc);
    }
    // Other types (card.claimed, deliverable.published) belong to later lots.
  }

  // ── board preferences ───────────────────────────────────────────────────────

  /**
   * Whether a review's follow-up suggestions become cards on their own.
   *
   * Defaults OFF, deliberately: a board that refills itself is a thing you opt into, not a thing you
   * discover. The review still runs and still says what it found undone — turning this on is what
   * turns that into cards.
   */
  autoFollowUps(): boolean {
    const row = this.db
      .query<{ value: string }, [string]>("SELECT value FROM board_pref WHERE key = ?")
      .get(AUTO_FOLLOW_UPS_KEY);
    return row ? row.value === "1" : false;
  }

  setAutoFollowUps(on: boolean): void {
    this.setPref(AUTO_FOLLOW_UPS_KEY, on ? "1" : "0");
  }

  /**
   * Whether an idle Claude card session is asked for its handoff note just before its prompt cache
   * expires (auto-handoff.ts). Defaults OFF: it is an agent turn per idle spell, on the user's quota,
   * with nobody watching — the same reason the copilot is opt-in.
   */
  autoHandoff(): boolean {
    const row = this.db
      .query<{ value: string }, [string]>("SELECT value FROM board_pref WHERE key = ?")
      .get(AUTO_HANDOFF_KEY);
    return row ? row.value === "1" : false;
  }

  setAutoHandoff(on: boolean): void {
    this.setPref(AUTO_HANDOFF_KEY, on ? "1" : "0");
  }

  /**
   * Which {@link CardCategory} kinds a review is allowed to file — one notch finer than
   * {@link autoFollowUps}, which stays the coarse cut: with it off, none of these matter.
   *
   * Defaults to ALL of them, so opting into follow-ups still means opting into follow-ups; this is
   * the knob for "the missing-feature ones, not the go-click-through-it ones". Stored as the ENABLED
   * list rather than a flag per key, because the vocabulary is closed by design (see
   * `pickCategory`) — and an empty row is a real answer ("none"), distinct from the absent row that
   * means "all".
   */
  followUpCategories(): CardCategory[] {
    const row = this.db
      .query<{ value: string }, [string]>("SELECT value FROM board_pref WHERE key = ?")
      .get(FOLLOW_UP_CATEGORIES_KEY);
    if (!row) return [...CARD_CATEGORIES];
    const stored = new Set(row.value.split(","));
    // Filtered through the vocabulary, in ITS order: junk in the row can't conjure a sixth category,
    // and can't make the settings rows shuffle.
    return CARD_CATEGORIES.filter((c) => stored.has(c));
  }

  setFollowUpCategories(categories: CardCategory[]): void {
    const wanted = new Set(categories);
    this.setPref(FOLLOW_UP_CATEGORIES_KEY, CARD_CATEGORIES.filter((c) => wanted.has(c)).join(","));
  }

  /**
   * How many cards may have an agent running at once (0 = no limit) — or null when nobody has set one from the
   * phone, in which case the caller keeps its env default (`COLLIE_BOARD_MAX_AGENTS`).
   *
   * The limit is about the MACHINE, not the deployment: how many agents this laptop can compile and
   * think for at once changes with what else is running on it, which is a thing you want to change
   * from the couch — not by editing a systemd unit and restarting the bridge. Out-of-range junk in
   * the row reads as "unset" rather than throwing: a preference must never be able to make starting
   * a card impossible.
   */
  maxAgents(): number | null {
    const row = this.db
      .query<{ value: string }, [string]>("SELECT value FROM board_pref WHERE key = ?")
      .get(MAX_AGENTS_KEY);
    const n = row ? Number(row.value) : NaN;
    return Number.isInteger(n) && n >= 0 && n <= MAX_AGENTS_CAP ? n : null;
  }

  setMaxAgents(n: number): void {
    this.setPref(MAX_AGENTS_KEY, String(n));
  }

  /** The pinned agent sessions, in pin order. Junk in the row reads as no pins, never a throw. */
  pins(): Pin[] {
    const row = this.db
      .query<{ value: string }, [string]>("SELECT value FROM board_pref WHERE key = ?")
      .get(PINS_KEY);
    try {
      const v: unknown = row ? JSON.parse(row.value) : [];
      return Array.isArray(v) ? v.filter((p): p is Pin => typeof p?.session === "string" && typeof p?.name === "string") : [];
    } catch {
      return [];
    }
  }

  /** Pin (or re-pin, refreshing its name) / unpin one session. A toggle, not a list replaced
   *  wholesale: the phone and the PC each pin from a copy that may be stale. */
  setPin(session: string, name: string, pinned: boolean): Pin[] {
    const rest = this.pins().filter((p) => p.session !== session);
    const next = pinned ? [...rest, { session, name }] : rest;
    this.setPref(PINS_KEY, JSON.stringify(next));
    return next;
  }

  private setPref(key: string, value: string): void {
    this.db
      .query(
        `INSERT INTO board_pref (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  // ── journal ─────────────────────────────────────────────────────────────────

  /**
   * Append to the card's journal. This is the "what happened while I wasn't looking" record, and it
   * is the only place a status change, a handoff or a lost pane is written down — so it must never
   * be able to fail the operation it describes.
   */
  recordEvent(cardId: string | null, type: string, payload?: unknown): void {
    try {
      this.db
        .query("INSERT INTO event (card_id, type, payload, ts) VALUES (?, ?, ?, ?)")
        .run(cardId, type, payload === undefined ? null : JSON.stringify(payload), this.now());
    } catch {
      // A journal write must never break the action it records (same rule as the audit log).
    }
  }

  /**
   * One journal entry by id. Separate from {@link listEvents} because that one is CAPPED at 100 for
   * the card view — scanning its result to find an entry to restore silently makes the 101st-oldest
   * unreachable, and answers "nothing to restore" for an entry the user can see.
   */
  getEvent(id: number): BoardEvent | null {
    const r = this.db.query<EventRow, [number]>("SELECT * FROM event WHERE id = ?").get(id);
    return r ? toEvent(r) : null;
  }

  /**
   * The PR events of each card's CURRENT PR — from its newest `card.pr_opened` on — oldest first: what
   * the open-PR list (prs.ts) and pr-follow fold, every tick. Both folds restart a card at its
   * `pr_opened` and ignore anything before one, so the earlier episodes are left in the table.
   * A card with no `pr_opened` (a PR the agent opened itself) starts at its first `pr_updated`: a
   * later `pr_updated` is a re-push, and starting there would drop the follow taken before it.
   */
  listPrEvents(): BoardEvent[] {
    return this.db
      .query<EventRow, []>(
        `SELECT e.* FROM event e
           JOIN (SELECT card_id,
                        COALESCE(MAX(CASE WHEN type = 'card.pr_opened' THEN id END), MIN(id)) AS since
                   FROM event WHERE type IN ('card.pr_opened', 'card.pr_updated') GROUP BY card_id) o
             ON e.card_id = o.card_id AND e.id >= o.since
         WHERE e.type IN ('card.pr_opened', 'card.pr_updated', 'card.pr_merged', 'card.pr_closed', 'card.automerge_armed', 'card.automerge_refused', 'card.pr_follow')
         ORDER BY e.id`,
      )
      .all()
      .map(toEvent);
  }

  /**
   * The events a card's milestones are derived from, oldest first, NOT capped (listEvents is: past
   * 100 the start and the send-back count would vanish silently). Plus the card's newest status move,
   * which says whether it is done. The one list both the card page and the project's dots read.
   */
  listMilestoneEvents(cardId: string): BoardEvent[] {
    const marks = MILESTONE_TYPES.map(() => "?").join(",");
    return this.db
      .query<EventRow, string[]>(
        `SELECT * FROM event WHERE card_id = ? AND (type IN (${marks}) OR id = (SELECT MAX(id) FROM event WHERE card_id = ? AND type = 'card.status')) ORDER BY id`,
      )
      .all(cardId, ...MILESTONE_TYPES, cardId)
      .map(toEvent);
  }

  /** A card's newest entry among `types`, or null — a fact read from the journal without the 100 cap of {@link listEvents}. */
  lastEventOf(cardId: string, types: string[]): BoardEvent | null {
    const marks = types.map(() => "?").join(",");
    const r = this.db
      .query<EventRow, string[]>(`SELECT * FROM event WHERE card_id = ? AND type IN (${marks}) ORDER BY ts DESC, id DESC LIMIT 1`)
      .get(cardId, ...types);
    return r ? toEvent(r) : null;
  }

  /** A card's journal, newest first, capped — a fact about the card is read through {@link EVENT_WINDOW}. */
  listEvents(cardId: string, limit = 100): BoardEvent[] {
    return this.db
      .query<EventRow, [string, number]>(
        "SELECT * FROM event WHERE card_id = ? ORDER BY ts DESC, id DESC LIMIT ?",
      )
      .all(cardId, limit)
      .map(toEvent);
  }

  /**
   * The newest journal id, or 0 on an empty journal — where the board tailer's cursor starts
   * (board-notify.ts). In memory and never persisted, which is the whole point: a bridge restart
   * resumes from what is in the journal NOW and so never replays the past into the bell.
   */
  lastEventId(): number {
    return this.db.query<{ id: number | null }, []>("SELECT MAX(id) AS id FROM event").get()?.id ?? 0;
  }

  /** One repo's journal entries of `types` newer than `ts`, oldest first — « quoi de neuf depuis » (since.ts). */
  repoEventsSince(repoPath: string, ts: number, types: string[], limit = 200): BoardEvent[] {
    const marks = types.map(() => "?").join(",");
    return this.db
      .query<EventRow, (string | number)[]>(
        `SELECT e.* FROM event e JOIN card c ON c.id = e.card_id
          WHERE c.repo_path = ? AND e.ts > ? AND e.type IN (${marks}) ORDER BY e.id LIMIT ?`,
      )
      .all(repoPath, ts, ...types, limit)
      .map(toEvent);
  }

  /** The types of the newest `limit` journal entries among `types`, NEWEST first — the copilot's
   *  recent review outcomes, from which board-notify.ts's `copilotDown` derives the failure streak. */
  latestEventTypes(types: string[], limit: number): string[] {
    const marks = types.map(() => "?").join(",");
    return this.db
      .query<{ type: string }, (string | number)[]>(`SELECT type FROM event WHERE type IN (${marks}) ORDER BY id DESC LIMIT ?`)
      .all(...types, limit)
      .map((r) => r.type);
  }

  /**
   * Journal entries newer than `after`, OLDEST first — the board tailer's range scan, and the reason
   * it is cheap: `id > ?` on an AUTOINCREMENT primary key walks the rowid from the cursor and
   * returns nothing at all in the normal case. `limit` bounds one tick, never the stream: the caller
   * advances its cursor per row, so a burst is drained over the next few ticks instead of in one.
   */
  eventsAfter(after: number, limit = 200): BoardEvent[] {
    return this.db
      .query<EventRow, [number, number]>("SELECT * FROM event WHERE id > ? ORDER BY id LIMIT ?")
      .all(after, limit)
      .map(toEvent);
  }
}

const toEvent = (r: EventRow): BoardEvent => ({
  id: r.id,
  cardId: r.card_id,
  type: r.type,
  payload: r.payload === null ? null : safeJson(r.payload),
  ts: r.ts,
});

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** The event types a card's milestones are derived from (web/src/lib/card-milestones.ts). */
export const MILESTONE_TYPES = ["session.opened", "run.gate", "run.decision", "review.created", "card.pr_opened", "card.pr_merged", "card.pr_closed"];
