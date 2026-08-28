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

/**
 * Mirrors the bridge's `CARD_CATEGORIES` — the closed vocabulary an automatic card is filed under.
 * A value, not just a type, because the settings screen renders one switch per entry and the board
 * has to agree with the bridge on both the list and its order.
 */
export const CARD_CATEGORIES = ["test", "feature", "bug", "docs", "chore"] as const;

export type CardCategory = (typeof CARD_CATEGORIES)[number];

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
  /**
   * `"copilot"` for a card that appeared without anyone asking — the follow-ups a review files while
   * you are elsewhere. `null` means a person wrote it, which is nearly every card. Immutable: the
   * bridge sets it at creation and no PATCH can reach it.
   */
  origin: "copilot" | null;
  /**
   * The card this one came OUT of — the reviewed card a follow-up was filed against. Not
   * {@link parentId}: that one makes the other card a container, this one only says where this came
   * from. Immutable, and it may dangle (deleted source) — resolve it, don't assume it exists.
   */
  originCardId: string | null;
  /**
   * WHY an automatic card exists, on a different axis from {@link tag} (which says where the work
   * lives). Always null when {@link origin} is null — a person's card is not classified. Immutable,
   * like `origin`.
   */
  category: CardCategory | null;
  /** One tag, or none — most cards have none, and that is a normal card. Colour: {@link tagHue}. */
  tag: string | null;
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
  /**
   * TOO SMALL FOR A CARD — the copilot judged this follow-up's whole job to be one edit, so it can
   * be handed to the agent it came out of instead of being started. Still an ordinary card in every
   * other way: {@link startCard} works on it exactly as before. False for every card a person wrote.
   */
  tiny: boolean;
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
  /** The card this one was filed against, resolved — a follow-up's whole context, in one line. */
  originCard: CardLink | null;
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
  // LEFT TO RIGHT IS THE FLOW, not the urgency. That is the opposite of BOARD_COLUMNS, and both are
  // right for where they are used: a phone shows one column, so what needs you has to be at the top
  // or you scroll past it; a wide board shows all four at once, so nothing is buried and the axis is
  // free to carry the thing a board is actually for — where the work is in its life. The phone
  // stacks these same four and re-sorts them in CSS alone (board.tsx, LANE_PHONE_ORDER) so the live
  // lanes lead there — so neither reading loses.
  { label: "To do", statuses: ["ready", "backlog"] },
  // `blocked` leads: inside a column, urgency still wins. It reads as "in progress, and it is
  // waiting on you", which is what it is — the agent is running, it just can't continue alone.
  { label: "Doing", statuses: ["blocked", "working", "starting", "orphaned"] },
  { label: "To review", statuses: ["review"] },
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
 *
 * `from === to` IS allowed — that is a reorder, and it is the same two conditions: a column you own,
 * holding a card no agent is in.
 */
export function canDropCard(from: CardStatus, to: CardStatus): boolean {
  return to !== "archived" && MANUAL_STATUSES.includes(from) && MANUAL_STATUSES.includes(to);
}

/**
 * The `position` a card needs to land at slot `index` of a column, given its neighbours' positions
 * IN ORDER and WITHOUT the dragged card itself.
 *
 * Halfway between the two it lands between — a fractional rank. The column is `position INTEGER` in
 * SQLite, which sounds like it forbids this and does not: SQLite's INTEGER affinity stores a REAL
 * that can't be represented exactly as an integer AS a real, and `ORDER BY position` sorts it
 * correctly (verified against bun:sqlite, not assumed). So one PATCH on one card is the whole
 * operation — no renumbering the neighbours, no batch endpoint, no migration.
 *
 * The known ceiling is float precision: halving the same gap ~50 times exhausts a double's mantissa
 * and two cards collide, at which point `ORDER BY position, created_at` still gives a stable order,
 * just not the asked-for one. Reaching it by hand is not plausible; if it ever matters, the fix is a
 * renumber pass over one column, not a schema change.
 */
export function positionFor(neighbours: number[], index: number): number {
  const before = index > 0 ? neighbours[index - 1] : undefined;
  const after = index < neighbours.length ? neighbours[index] : undefined;
  if (before === undefined) return after === undefined ? 0 : after - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
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

// ── tags ─────────────────────────────────────────────────────────────────────

/**
 * How many distinct hues a tag can land on. Twelve 30° bands, not 360 free degrees: two tags a few
 * degrees apart are two colours nobody can tell apart, which is worse than two tags sharing one —
 * a shared colour reads as "same family", a near-miss reads as "these differ, squint harder".
 *
 * ponytail: twelve bands means two tags DO sometimes collide (birthday problem — it is visible from
 * about five tags). Accepted: the alternative is assigning colours in inventory order, which makes a
 * tag's colour depend on what else exists and breaks the one property this whole design is for.
 */
const TAG_HUES = 12;

/**
 * The hue for a tag name, in degrees. THE definition of a tag's colour — nothing stores one, so a
 * tag is the same colour on the tile, in the picker and anywhere else it ever renders, on any
 * device, and still the same after the database is deleted and rebuilt.
 *
 * FNV-1a rather than the usual `h * 31 + c`: over short lowercase words (which is what tags are)
 * that one clumps badly — measured, it put `bug`, `infra` and `ui` on the same band and left a third
 * of the wheel unused.
 *
 * Only the hue varies. Lightness and chroma are fixed per theme in `.tag-chip` (index.css), so a tag
 * has the same weight and the same contrast whatever hue it drew.
 */
export function tagHue(tag: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < tag.length; i++) {
    h ^= tag.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const band = 360 / TAG_HUES;
  // Centred in its band, which also keeps every hue clear of 0° — pure red is the blocked colour.
  return (h % TAG_HUES) * band + band / 2;
}

/** Mirrors the bridge's own cap. A longer tag is a sentence, and the chip has no room for one. */
export const TAG_MAX_CHARS = 24;

/**
 * Fold a typed tag to its canonical form, or null when there isn't one. The SAME rule as the
 * bridge's `normalizeTag` — lowercase, collapsed whitespace, clipped — and deliberately duplicated
 * rather than shared: the bridge is the authority (it re-normalises every write, including the
 * copilot's), this copy exists so the field can tell you, before you tap Add, that what you typed
 * IS the `bug` already on the board. Without it `Bug ` looks like a new tag right up until it
 * silently isn't.
 *
 * Applied on SUBMIT and for matching, never per keystroke: collapsing whitespace as you type makes
 * the space bar swallow itself, so `front end` becomes unspellable.
 */
export function normalizeTag(value: string): string | null {
  return value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, TAG_MAX_CHARS).trim() || null;
}

/**
 * The tags in use, most recently touched first — derived from the cards the screen already has, so
 * it costs no request and cannot disagree with what is on screen. The bridge derives the same list
 * the same way (`BoardDb.listTags`) for the consumers that have no card list to hand.
 */
export function tagsOf(cards: readonly CardView[]): string[] {
  const seen = new Map<string, number>();
  for (const card of cards) {
    if (!card.tag) continue;
    seen.set(card.tag, Math.max(seen.get(card.tag) ?? 0, card.updatedAt));
  }
  return [...seen].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag);
}

/**
 * The board's fine filters, as one predicate: what kind of work (`tag`) and who wrote the card
 * (`autoOnly`). They COMPOSE — asking for the copilot's cards inside a tag is a legitimate question,
 * and two axes that can't be crossed would be two filters pretending to be one.
 *
 * The repo scope is applied before this rather than through it: it is the coarser, remembered axis
 * (ADR 0006), and the tag/source strips are derived FROM the scoped list so they never offer a
 * combination that comes back empty.
 */
export function matchesFilters(
  card: CardView,
  filters: { tag: string | null; autoOnly: boolean },
): boolean {
  if (filters.tag && card.tag !== filters.tag) return false;
  return !filters.autoOnly || card.origin === "copilot";
}

// ── repo scope ───────────────────────────────────────────────────────────────

/** A repo the board can be scoped to: the stored path, and what a chip shows for it. */
export interface RepoScope {
  path: string;
  name: string;
}

/** The last segment of a repo path — what the picker already shows (`RepoChoice.name`). */
export function repoName(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() || path;
}

/**
 * The repos in play, most recently touched first — derived from the cards on screen exactly like
 * {@link tagsOf}, for the same reason: no request, and it cannot disagree with what is rendered.
 *
 * ponytail: two repos with the same last segment (`~/work/collie` and `~/perso/collie`) get two
 * chips reading the same word. They still scope to different paths, so nothing is wrong beyond the
 * label; disambiguate by parent directory if that ever actually happens to someone.
 */
export function reposOf(cards: readonly CardView[]): RepoScope[] {
  const seen = new Map<string, number>();
  for (const card of cards) {
    if (!card.repoPath) continue;
    seen.set(card.repoPath, Math.max(seen.get(card.repoPath) ?? 0, card.updatedAt));
  }
  return [...seen]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([path]) => ({ path, name: repoName(path) }));
}

/**
 * The repo scope is REMEMBERED, unlike the tag filter — see
 * [ADR 0006](../../../.adr/0006-the-board-scopes-by-repo-and-remembers-it.md). "All repos" is a
 * remembered choice too, stored as the empty string, so picking it means the board opens global
 * from then on rather than seeding itself again from the repo before it.
 */
const REPO_SCOPE_KEY = "collie:board-repo";

export function loadRepoScope(): string | null {
  try {
    return localStorage.getItem(REPO_SCOPE_KEY) || null;
  } catch {
    return null;
  }
}

export function saveRepoScope(path: string | null): void {
  try {
    localStorage.setItem(REPO_SCOPE_KEY, path ?? "");
  } catch {
    // Private-mode Safari and friends. A scope that doesn't survive a reload is a small loss.
  }
}

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
  /** One tag, or `null` to clear it. The bridge normalises it — send what was typed. */
  tag?: string | null;
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

/**
 * Finish a {@link CardView.tiny} card on the spot: its spec goes to the agent the card came out of,
 * which is still at its prompt in the right worktree, and the card is filed done.
 *
 * Never the only way to deal with such a card — it starts like any other. Refuses (409) when the
 * card has already been started, or when that agent is gone, and the message says to start it.
 */
export function finishCardNow(id: string): Promise<{ ok: true; card: CardView }> {
  return apiRequest<{ ok: true; card: CardView }>(`/api/cards/${encodeURIComponent(id)}/finish-now`, {
    method: "POST",
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
 * The worktree's copy of one file, verbatim — what the Markdown reader renders. Same route and same
 * path guard as {@link fetchDiffFile}, one lens over: a patch shows what moved, this shows the file.
 */
export function fetchWorktreeFile(
  id: string,
  path: string,
  signal?: AbortSignal,
): Promise<{ ok: true; path: string; text: string; truncated: boolean }> {
  const q = new URLSearchParams({ mode: "read", path });
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

/** The board's switches. Bridge-side, so the choice is the board's, not this device's. */
export interface BoardPrefs {
  /** Turn a review's follow-up suggestions into backlog cards. Default off — opt in. */
  autoFollowUps: boolean;
  /** Which kinds of follow-up may be filed, once `autoFollowUps` is on. Defaults to all of them;
   *  the global switch stays the coarse cut, and off means none of these are consulted. A category
   *  left out here produces NO card — nothing is created and then hidden. */
  followUpCategories: CardCategory[];
  /** How many cards may run an agent at once. Reads as the effective limit: the number set here,
   *  or the bridge's `COLLIE_BOARD_MAX_AGENTS` default while none has been. */
  maxAgents: number;
}

/** The ceiling the bridge enforces on `maxAgents` (mirrors `MAX_AGENTS_CAP`). */
export const MAX_AGENTS_CAP = 32;

export function fetchBoardPrefs(signal?: AbortSignal): Promise<BoardPrefs> {
  return apiRequest<BoardPrefs>("/api/board/prefs", { signal });
}

/** Only the keys you send change — the bridge treats this POST as a patch. */
export function setBoardPrefs(patch: Partial<BoardPrefs>): Promise<BoardPrefs> {
  return apiRequest<BoardPrefs>("/api/board/prefs", {
    method: "POST",
    body: JSON.stringify(patch),
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
  /**
   * Every commit is on the branch's upstream too. This is where the PR path leaves the work — not
   * in the base, but not only here either — and the difference between "nowhere else" and "on the
   * remote" is the whole reason `cleanup` accepts a branch `ahead` still calls unmerged.
   */
  pushed: boolean;
}

/** What a card's branch looks like right now. Null when the card has no branch. */
export function fetchIntegration(id: string): Promise<{ integration: Integration | null }> {
  return apiRequest<{ integration: Integration | null }>(
    `/api/cards/${encodeURIComponent(id)}/integration`,
  );
}

/** What a card's pull request became, as GitHub sees it right now. */
export interface PrStatus {
  state: "open" | "merged" | "closed";
  url: string;
  /** Epoch ms, null unless it was merged. */
  mergedAt: number | null;
}

/**
 * Ask GitHub what the card's PR became — the one call behind a card that leaves the machine.
 *
 * Kept OFF `fetchIntegration` on purpose: that one renders the section, this one only sharpens a
 * sentence in it, so it is asked afterwards and the screen never waits on it. `null` whenever GitHub
 * cannot be asked (no `gh`, not logged in, no GitHub remote, no PR, offline) — the caller then keeps
 * showing what the journal knows rather than inventing a state. Cached a minute bridge-side.
 */
export function fetchPrStatus(id: string): Promise<{ pr: PrStatus | null }> {
  return apiRequest<{ pr: PrStatus | null }>(`/api/cards/${encodeURIComponent(id)}/pr`);
}

/**
 * The four gestures that end a branch's life. All refuse before they act, so a rejection arrives as
 * a sentence to show rather than as a repository left in a state nobody asked for.
 *
 * `merge` is local and pushes nothing; `pr` pushes the branch and never touches the base; `resolve`
 * hands a conflict to the card's own agent, to settle on its own branch; `cleanup` removes the
 * worktree and deletes the branch, and is refused unless the work is merged or at least pushed.
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

/**
 * Ask the copilot for its verdict on this card again, now.
 *
 * The review normally fires on its own when the work lands. This is for the case where it judged
 * the card against the wrong base ref and reported "nothing changed": re-point the base with
 * `patchCard`, then call this. Returns immediately — the verdict lands on a later poll.
 */
export function reviewCard(id: string): Promise<{ ok: true; card: CardView }> {
  return apiRequest<{ ok: true; card: CardView }>(`/api/cards/${encodeURIComponent(id)}/review`, {
    method: "POST",
  });
}

/**
 * Hand the card back to the copilot WITH a correction to apply — "you said the format isn't
 * specified, say it will be JSON".
 *
 * Not `reformulateCard` with an extra argument, because the input is different: this one works from
 * the card as it stands, so it fixes the one thing that came out wrong instead of redoing the card
 * from the original dictation. Returns immediately, same as every copilot call.
 */
export function refineCard(id: string, instruction: string): Promise<{ ok: true; card: CardView }> {
  return apiRequest<{ ok: true; card: CardView }>(`/api/cards/${encodeURIComponent(id)}/refine`, {
    method: "POST",
    body: JSON.stringify({ instruction }),
  });
}

/** One Claude Code limit line, as `/usage` prints it (bridge/usage.ts). */
export interface UsageLimit {
  label: string;
  /** Percentage of that limit already USED — the gauge shows 100 − this. */
  percent: number;
  resetsAt: string | null;
}

export interface ClaudeUsage {
  limits: UsageLimit[];
  /** When the bridge took this reading (epoch ms). */
  checkedAt: number;
}

/**
 * How much Claude Code quota is left. `null` when the bridge has no reading to give (no `claude` on
 * the host, an unrecognised panel) — the caller shows nothing rather than a made-up number.
 *
 * The bridge caches it for 15 minutes, so calling this on every visit to the dashboard is cheap;
 * `refresh` skips that cache and is what the gauge's refresh button sends.
 */
export function fetchUsage(
  refresh = false,
  signal?: AbortSignal,
): Promise<{ usage: ClaudeUsage | null }> {
  return apiRequest<{ usage: ClaudeUsage | null }>(`/api/board/usage${refresh ? "?refresh=1" : ""}`, {
    signal: withTimeout(signal, GET_TIMEOUT_MS),
  });
}
