// The board's client surface: the card shapes the bridge serves, the REST calls, and the two path
// helpers. Everything the FORK adds to the frontend data layer lives here, so the diff against
// upstream Collie stays a handful of files rather than a scatter.
//
// The board is bound to the PRIMARY herdr session (see bridge/server.ts), so — unlike every path
// in lib/nav.ts — none of these carry `?s=`.

import { apiRequest, ApiError, GET_TIMEOUT_MS, withTimeout } from "./api";
import type { AgentStatus } from "./types";

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

export interface CardSession {
  id: string;
  cardId: string;
  paneId: string | null;
  agentSessionId: string | null;
  agentKind: string | null;
  ctxTokens: number | null;
  ctxPct: number | null;
  handoffMd: string | null;
  outcome: "handoff" | "done" | "abandoned" | "lost" | null;
  /** Set while a handoff has been asked for but the agent hasn't written its note yet. */
  handoffRequestedAt: number | null;
  startedAt: number;
  endedAt: number | null;
}

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

/** A follow-up the review suggested, resolved to the card it became — the bridge nulls `card` once
 *  that card is deleted, so the title survives even after the link doesn't. */
export interface ReviewTodo {
  title: string;
  card: CardLink | null;
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

export interface BoardEvent {
  id: number;
  cardId: string | null;
  type: string;
  payload: unknown;
  ts: number;
}

export interface CardView {
  id: string;
  title: string;
  spec: string | null;
  rawInput: string | null;
  acceptance: string[];
  status: CardStatus;
  repoPath: string | null;
  baseRef: string | null;
  branch: string | null;
  workspaceId: string | null;
  agentKind: string | null;
  /** The card this was split out of. A card WITH children is a container — not startable. */
  parentId: string | null;
  /** A card the copilot judged this one to be a repeat of. A note, never a refusal. */
  duplicateOf: string | null;
  /** The card that must finish first, or null. A gate on starting, never an auto-trigger. */
  dependsOn: string | null;
  position: number;
  createdAt: number;
  updatedAt: number;
  session: CardSession | null;
  runtime: CardRuntime | null;
  sessionCount: number;
  /**
   * The copilot is rewriting or reviewing this card right now. Runtime state, so it is false after a
   * bridge restart — which is correct: the restart cancelled the work.
   */
  copilotBusy: boolean;
  /** The agent is still writing its closing report — cleaning up the worktree now would lose it. */
  wrapupPending: boolean;
  /** Off by default. When on, the worktree is never cleaned up automatically once wrapup settles. */
  keepWorktree: boolean;
}

/** Just enough of a linked card to name it on screen — the bridge resolves these on the detail. */
export interface CardLink {
  id: string;
  title: string;
  status: CardStatus;
}

export interface CardDetail {
  card: CardView;
  /**
   * The card this one declares it follows, resolved — present even once it is finished, because
   * "after X" is context worth keeping, not only a reason to refuse. Whether it still HOLDS is
   * `dependencyMet()`, which mirrors the bridge.
   */
  predecessor: CardLink | null;
  /** The container this was split out of — the card holding the dictation it came from. */
  parent: CardLink | null;
  /**
   * A card the copilot thinks this one repeats, resolved. A SUGGESTION: it links, it does not merge,
   * and dismissing it is one tap.
   */
  duplicate: CardLink | null;
  /** The sub-tasks this card was split into. Non-empty makes it a container: not startable. */
  children: CardLink[];
  sessions: CardSession[];
  reviews: Review[];
  events: BoardEvent[];
}

/** Human column names, in board order. `archived` never renders as a column. */
export const CARD_STATUS_LABEL: Record<CardStatus, string> = {
  blocked: "Needs you",
  review: "To review",
  working: "In progress",
  starting: "Starting",
  orphaned: "Orphaned",
  ready: "Ready",
  backlog: "Backlog",
  done: "Done",
  archived: "Archived",
};

/**
 * Column order, urgency first — the same triage principle as Collie's home screen: what needs a
 * human tops the list, settled work sinks. `archived` is absent by design.
 */
export const BOARD_COLUMNS: CardStatus[] = [
  "blocked",
  "review",
  "working",
  "starting",
  "orphaned",
  "ready",
  "backlog",
  "done",
];

/**
 * The eight columns folded into the four stages of a card's real life, for the wide-screen board.
 *
 * Transposing the eight as-is would need 8 × 280px ≈ 2240px and bring back the horizontal pan the
 * phone layout exists to avoid — with a mouse instead of a thumb, which is not an improvement.
 * Four lanes fit any laptop at ~320px each, and nothing is lost: each lane keeps its columns as
 * labelled sub-sections inside it, so `starting` is still distinguishable from `working`.
 *
 * Every BOARD_COLUMNS status must appear exactly once — pinned by board.test.ts, because a status
 * that falls out of every lane would silently vanish from the wide-screen board only.
 */
export const BOARD_LANES: { label: string; statuses: CardStatus[] }[] = [
  { label: "Needs you", statuses: ["blocked", "review", "orphaned"] },
  { label: "In progress", statuses: ["working", "starting"] },
  { label: "Ready", statuses: ["ready", "backlog"] },
  { label: "Done", statuses: ["done"] },
];

/**
 * Columns a human moves a card into by hand. The rest are driven by the herd — the bridge
 * reconciles them against the pane every poll — so a manual write to one of them is undone a second
 * later. Shared by the card page's "Move to" and by the board's drag-and-drop.
 */
export const MANUAL_STATUSES: CardStatus[] = ["backlog", "ready", "done", "archived"];

/**
 * Whether a card sitting in `from` may be dropped on `to`.
 *
 * BOTH ends have to be manual, and that is the whole safety argument, so it is worth stating:
 *
 * - A manual SOURCE means the card has no open session (`releaseSession` closes one the moment a
 *   card leaves the live columns). So a drop can never send a working agent away — which is the one
 *   real hazard of filing a card, and the reason the card page hides "Done" while a branch still
 *   holds commits. No agent, no hazard, no need for that guard here.
 * - A manual TARGET means the poll won't undo it. Dropping onto "In progress" would write a status
 *   the next reconcile overwrites, i.e. a card that snaps back — worse than a refused drop.
 *
 * Everything else stays where it already is: the card page, one tap, with its own guards.
 * `archived` is manual but has no column on the board, so it can never be a target.
 */
export function canDropCard(from: CardStatus, to: CardStatus): boolean {
  return (
    from !== to &&
    to !== "archived" &&
    MANUAL_STATUSES.includes(from) &&
    MANUAL_STATUSES.includes(to)
  );
}

/** Tailwind chip classes per column, reusing the status palette the agent badges already use. */
export const CARD_STATUS_CHIP: Record<CardStatus, string> = {
  blocked: "border-status-blocked/30 bg-status-blocked/15 text-status-blocked",
  review: "border-status-done/30 bg-status-done/15 text-status-done",
  working: "border-status-working/30 bg-status-working/15 text-status-working",
  starting: "border-status-working/30 bg-status-working/10 text-status-working",
  orphaned: "border-status-unknown/30 bg-status-unknown/15 text-status-unknown",
  ready: "border-status-idle/30 bg-status-idle/10 text-status-idle",
  backlog: "border-border bg-muted text-muted-foreground",
  done: "border-status-idle/30 bg-status-idle/10 text-status-idle",
  archived: "border-border bg-muted text-muted-foreground",
};

// ── paths ────────────────────────────────────────────────────────────────────

export function boardPath(): string {
  return "/board";
}

export function cardPath(cardId: string): string {
  return `/card/${encodeURIComponent(cardId)}`;
}

// ── api ──────────────────────────────────────────────────────────────────────

// Conditional GET for the two board reads that POLL — the card list on every board screen, the
// card detail on every card screen. Both re-transfer their whole body every 1.5 s otherwise, and
// most of those bodies are identical to the last one.
//
// Same client-managed scheme as `fetchPane` in api.ts, INCLUDING ITS TWO INVARIANTS — see the
// comment there, which is the canonical explanation of why the tag is stored only together with its
// body and only after that body parses. Restating them here would give the next person two versions
// of a subtle rule to keep in step.
const etagCache = new Map<string, { etag: string; body: unknown }>();

/** Bounded so opening many cards over a long session can't grow it forever. FIFO is plenty. */
const ETAG_CACHE_MAX = 20;

async function conditionalGet<T>(url: string, signal?: AbortSignal): Promise<T> {
  const cached = etagCache.get(url);
  // The timeout is the point, not a nicety: the poller only fires again once the revalidator is
  // idle (use-polling.ts), so ONE fetch left pending by a black-holed link — a phone waking up, a
  // Tailscale route gone dark — stops the whole app polling, silently and for good.
  const res = await fetch(url, {
    signal: withTimeout(signal, GET_TIMEOUT_MS),
    headers: cached ? { "if-none-match": cached.etag } : {},
  });

  if (res.status === 304 && cached) return cached.body as T;
  // ApiError, not Error: the loaders detect an auth failure with an instanceof check, so a plain
  // Error would turn a 403 from the same-origin gate into a generic "can't reach the board".
  if (!res.ok) throw new ApiError(`${url} → ${res.status} ${(await res.text()).slice(0, 200)}`, res.status);

  const body = (await res.json()) as T;
  const etag = res.headers.get("etag");
  if (etag) {
    etagCache.set(url, { etag, body });
    if (etagCache.size > ETAG_CACHE_MAX) {
      const oldest = etagCache.keys().next().value;
      if (oldest !== undefined) etagCache.delete(oldest);
    }
  }
  return body;
}

// No invalidation hook, deliberately: the ETag is computed from the bridge's CURRENT data, so after
// a mutation the next poll sends a stale If-None-Match, the server computes a different tag, and we
// get the fresh body. A cache that self-corrects needs no cache-busting.

export function fetchCards(signal?: AbortSignal): Promise<{ cards: CardView[] }> {
  return conditionalGet<{ cards: CardView[] }>("/api/cards", signal);
}

export function fetchCard(id: string, signal?: AbortSignal): Promise<CardDetail> {
  return conditionalGet<CardDetail>(`/api/cards/${encodeURIComponent(id)}`, signal);
}

/** Fields a create/patch accepts. The bridge validates them again — this is convenience, not a gate. */
export interface CardInput {
  title?: string;
  spec?: string | null;
  rawInput?: string | null;
  acceptance?: string[];
  status?: CardStatus;
  repoPath?: string | null;
  baseRef?: string | null;
  branch?: string | null;
  agentKind?: string | null;
  /** Card ids. The bridge validates that they exist and that neither closes a loop. */
  parentId?: string | null;
  dependsOn?: string | null;
  /** Set by the copilot; the client only ever clears it — "not a duplicate" is one tap. */
  duplicateOf?: string | null;
  position?: number;
  keepWorktree?: boolean;
}

export function createCard(input: CardInput): Promise<{ ok: true; card: CardView }> {
  return apiRequest<{ ok: true; card: CardView }>("/api/cards", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function patchCard(id: string, input: CardInput): Promise<{ ok: true; card: CardView }> {
  return apiRequest<{ ok: true; card: CardView }>(`/api/cards/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteCard(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/cards/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/**
 * Start (or relaunch) a card: worktree → agent → the spec, in one call.
 *
 * The bridge answers 409 for a refusal it decided itself (no repo path, semaphore full, already
 * running) and 502 for a herdr failure — both carry a human `error` string. `apiRequest` throws on
 * any non-2xx, so callers catch and surface `err.message`, which already contains the body.
 */
export function startCard(id: string): Promise<{ ok: true; card: CardView }> {
  return apiRequest<{ ok: true; card: CardView }>(`/api/cards/${encodeURIComponent(id)}/start`, {
    method: "POST",
  });
}

/**
 * Put back the text an edit overwrote. With an event id it restores that entry; without one, the
 * most recent overwrite. Reverting is journalled as an edit itself, so it can be reverted in turn.
 */
export function revertCard(id: string, eventId?: number): Promise<{ ok: true; card: CardView }> {
  return apiRequest<{ ok: true; card: CardView }>(`/api/cards/${encodeURIComponent(id)}/revert`, {
    method: "POST",
    body: JSON.stringify(eventId === undefined ? {} : { eventId }),
  });
}

/** Send a follow-up instruction to the card's running agent (`agent.prompt`, text + submit). */
export function promptCard(id: string, text: string): Promise<{ ok: true; card: CardView }> {
  return apiRequest<{ ok: true; card: CardView }>(`/api/cards/${encodeURIComponent(id)}/prompt`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

// ── diff ─────────────────────────────────────────────────────────────────────
//
// Scoped by construction: the card owns a branch, herdr gave that branch its own worktree, so the
// bridge diffs that checkout against its fork point. Nothing here passes a scope — there is none to
// get wrong.

export interface DiffFile {
  path: string;
  added: number;
  removed: number;
  /** `binary` carries no line counts; `untracked` never reached the index (a brand-new file). */
  kind: "text" | "binary" | "untracked";
}

export interface DiffStat {
  ok: true;
  /** The commit the diff is measured from. */
  base: string;
  cwd: string;
  files: DiffFile[];
  added: number;
  removed: number;
}

/** A 409 from the diff route: the card has no branch, or its worktree is gone. */
export interface DiffUnavailable {
  ok: false;
  error: string;
  kind?: string;
}

export function fetchDiffStat(id: string, signal?: AbortSignal): Promise<DiffStat> {
  return apiRequest<DiffStat>(`/api/cards/${encodeURIComponent(id)}/diff`, { signal });
}

export function fetchDiffFile(
  id: string,
  path: string,
  untracked: boolean,
  signal?: AbortSignal,
): Promise<{ ok: true; path: string; diff: string; truncated: boolean }> {
  const q = new URLSearchParams({ mode: "file", path });
  if (untracked) q.set("untracked", "1");
  return apiRequest(`/api/cards/${encodeURIComponent(id)}/diff?${q}`, { signal });
}

/**
 * Ask the card's agent to write its handoff note. Returns as soon as the prompt is delivered — the
 * bridge finishes the swap (read the note, replace the pane, re-prompt) off its own poll loop, so
 * the card simply moves on its own a minute later. Never automatic: this is always a tap.
 */
export function handoffCard(id: string): Promise<{ ok: true; card: CardView }> {
  return apiRequest<{ ok: true; card: CardView }>(`/api/cards/${encodeURIComponent(id)}/handoff`, {
    method: "POST",
  });
}

// ── repo picker ──────────────────────────────────────────────────────────────

export interface RepoChoice {
  path: string;
  name: string;
  /** Where the bridge learned about it: a previous card, the live herd, or a configured scan root. */
  source: "card" | "herd" | "scan";
  lastUsedAt?: number;
  /** Pre-fills the card's base ref, so that field doesn't have to be typed either. */
  defaultBranch?: string;
  /** The operator hid it. Only ever present when the list was fetched with `all`. */
  hidden?: boolean;
}

/**
 * The repositories a card can be started in. Fetched when the new-card sheet opens, not on the poll:
 * the bridge shells out to git per distinct pane cwd to build it.
 */
export function fetchRepos(
  opts: { all?: boolean } = {},
  signal?: AbortSignal,
): Promise<{ repos: RepoChoice[]; hiddenCount: number }> {
  return apiRequest<{ repos: RepoChoice[]; hiddenCount: number }>(
    `/api/repos${opts.all ? "?all=1" : ""}`,
    { signal },
  );
}

/**
 * Hide a repo from the picker, or bring it back.
 *
 * The only thing the board stores ABOUT a repo. The list itself is derived from cards, the live herd
 * and a directory scan — all facts, all recomputed. This is a decision, it has no other source, and
 * a directory scan that turns up 27 repos when you card 3 is exactly why it needs one.
 */
export function setRepoHidden(path: string, hidden: boolean): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>("/api/repos/hide", {
    method: "POST",
    body: JSON.stringify({ path, hidden }),
  });
}

/**
 * The bridge's own sentence, out of an `apiRequest` failure.
 *
 * `apiRequest` builds `"<path> → <status> <body>"`, which is right for a log and wrong for a phone:
 * the useful half is the `error` field at the very end, so on a narrow screen the user reads a url
 * and a status code and never reaches the reason. Reported exactly that way against a merge refusal.
 *
 * Pure + exported: every board refusal now arrives through here.
 */
export function boardErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const brace = raw.indexOf("{");
  if (brace !== -1) {
    try {
      const parsed = JSON.parse(raw.slice(brace)) as { error?: unknown };
      if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error;
    } catch {
      // Not JSON after all — fall through to stripping the prefix.
    }
  }
  return raw.replace(/^\S+\s→\s\d+\s*/, "").trim() || "something went wrong";
}

/**
 * Ask the copilot what a RAW tool error means and what to do about it.
 *
 * Only for text relayed from git or herdr — the board's own refusals are already written for a
 * person. Returns immediately; the answer lands in the card's journal a minute later, like every
 * other copilot call.
 */
export function explainError(id: string, input: { action: string; error: string }): Promise<{ ok: true }> {
  return apiRequest(`/api/cards/${encodeURIComponent(id)}/explain`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Where a card's branch stands against the branch it forked from. */
export interface Integration {
  branch: string;
  base: string;
  /** Commits on the branch the base doesn't have. 0 means there is nothing left to integrate. */
  ahead: number;
  behind: number;
  /** The main checkout has uncommitted changes — a merge is refused. */
  baseDirty: boolean;
  /** The CARD's checkout has uncommitted work — merging would leave it behind. */
  branchDirty: boolean;
  baseCheckedOut: boolean;
}

/** What a card's branch looks like right now. Null when the card has no branch. */
export function fetchIntegration(id: string): Promise<{ integration: Integration | null }> {
  return apiRequest<{ integration: Integration | null }>(
    `/api/cards/${encodeURIComponent(id)}/integration`,
  );
}

/**
 * The four gestures that end a branch's life. All refuse before they act, so a rejection arrives as
 * a sentence to show rather than as a repository left in a state nobody asked for.
 *
 * `merge` is local and pushes nothing; `pr` pushes the branch and never touches the base; `resolve`
 * hands a conflict to the card's own agent, to settle on its own branch; `cleanup` removes the
 * worktree and deletes the branch, and is refused unless the work is already integrated.
 */
export function integrateCard(
  id: string,
  action: "merge" | "pr" | "resolve" | "cleanup" | "discard",
  /**
   * File the card as done in the same breath — only on success, and only for merge/pr.
   *
   * The two belong together because the tempting order is the broken one: filing a card first ends
   * its session, so the agent that could settle a merge conflict is already gone when the merge
   * finds one. This way a failed integration leaves the card untouched, agent included.
   */
  andDone = false,
): Promise<{ ok: true; url?: string | null; base?: string; discarded?: number; card: CardView }> {
  return apiRequest(`/api/cards/${encodeURIComponent(id)}/integration`, {
    method: "POST",
    body: JSON.stringify({ action, andDone }),
  });
}

/**
 * Hand the card back to the copilot for a fresh title / spec / acceptance criteria.
 *
 * Creation does this automatically, so this is for the two cases it can't cover: a card written
 * while the copilot was off, and a reformulation you didn't like. Returns immediately — the card
 * rewrites itself on a later poll, exactly as on create.
 */
export function reformulateCard(id: string): Promise<{ ok: true; card: CardView }> {
  return apiRequest<{ ok: true; card: CardView }>(
    `/api/cards/${encodeURIComponent(id)}/reformulate`,
    { method: "POST" },
  );
}
