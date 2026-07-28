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
   * The card that must finish before this one may start, or null. ORDERING, not provenance — and
   * deliberately one edge per card rather than a list: independent (null everywhere), serial (a
   * chain) and the realistic mixed case all fall out of the same nullable column, where a
   * two-mode "parallel or sequential" flag can only express the first two.
   */
  dependsOn: string | null;
  /** Manual ordering within a column. */
  position: number;
  createdAt: number;
  updatedAt: number;
}

export type SessionOutcome = "handoff" | "done" | "abandoned" | "lost";

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
  startedAt: number;
  endedAt: number | null;
}

export interface Review {
  id: string;
  cardId: string;
  sessionId: string | null;
  verdict: string | null;
  notes: string | null;
  todos: string[];
  createdAt: number;
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
  depends_on: string | null;
  position: number;
  created_at: number;
  updated_at: number;
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
function jsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
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
    dependsOn: r.depends_on ?? null,
    position: r.position,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
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
    todos: jsonArray(r.todos),
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
  depends_on   TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
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
  updated_at INTEGER NOT NULL
);
`;

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
  dependsOn?: string | null;
  /**
   * Explicit board position. Omit for the default — new cards land at the TOP of their column,
   * which is one less tap on a phone. A split passes it, because "top of the column" applied to
   * three cards created in a row reverses them, and a chain read backwards is worse than useless.
   */
  position?: number;
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
  dependsOn?: string | null;
  position?: number;
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
  dependsOn: "depends_on",
  position: "position",
};

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
   * Additive migrations. `CREATE TABLE IF NOT EXISTS` gets a NEW database right and does nothing at
   * all for an existing one, so a column added after someone's board has cards in it needs this.
   *
   * Deliberately the dumbest thing that works: a list of `ADD COLUMN`s, applied when the column
   * isn't already there. Additive only — no renames, no drops, no version table — because every
   * change so far is a nullable column, and a migration framework for that would be exactly the
   * kind of machinery this project doesn't buy.
   */
  private migrate(): void {
    const additions: { table: string; column: string; ddl: string }[] = [
      // 0.22: the handoff is asynchronous (the agent has to finish writing the file first), so the
      // request has to survive a bridge restart — a board whose whole point is durable memory can't
      // hold a pending handoff in RAM.
      { table: "session", column: "handoff_requested_at", ddl: "INTEGER" },
      // 0.32: a split used to produce bare titles with nothing tying them together. These two are
      // what make a split legible afterwards — where a card came from, and what it waits on.
      { table: "card", column: "parent_id", ddl: "TEXT" },
      { table: "card", column: "depends_on", ddl: "TEXT" },
    ];
    for (const { table, column, ddl } of additions) {
      const cols = this.db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
      if (cols.some((c) => c.name === column)) continue;
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
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
                           branch, workspace_id, agent_kind, parent_id, depends_on, position,
                           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
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
        input.position ?? (minPos ?? 0) - 1,
        ts,
        ts,
      );
    this.recordEvent(id, "card.created", { title: input.title, status });
    return this.getCard(id)!;
  }

  getCard(id: string): Card | null {
    const row = this.db.query<CardRow, [string]>("SELECT * FROM card WHERE id = ?").get(id);
    return row ? toCard(row) : null;
  }

  /** Every card except `archived`, ordered for the board (column order, then manual position). */
  listCards(opts: { includeArchived?: boolean } = {}): Card[] {
    const sql = opts.includeArchived
      ? "SELECT * FROM card ORDER BY position, created_at"
      : "SELECT * FROM card WHERE status != 'archived' ORDER BY position, created_at";
    return this.db.query<CardRow, []>(sql).all().map(toCard);
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
      values.push(key === "acceptance" ? JSON.stringify(value ?? []) : (value as string | number | null));
    }
    if (sets.length === 0) return this.getCard(id);

    const before = this.getCard(id);
    sets.push("updated_at = ?");
    values.push(this.now(), id);
    this.db.query(`UPDATE card SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    if (before) this.recordEdit(before, patch, reason);
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

  patchSession(
    id: string,
    patch: {
      paneId?: string | null;
      agentSessionId?: string | null;
      ctxTokens?: number | null;
      ctxPct?: number | null;
      handoffMd?: string | null;
      handoffRequestedAt?: number | null;
    },
  ): CardSession | null {
    const columns: Record<string, string> = {
      paneId: "pane_id",
      agentSessionId: "agent_session_id",
      ctxTokens: "ctx_tokens",
      ctxPct: "ctx_pct",
      handoffMd: "handoff_md",
      handoffRequestedAt: "handoff_requested_at",
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
    todos?: string[];
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
    this.recordEvent(input.cardId, "review.created", { reviewId: id, verdict: input.verdict ?? null });
    return this.getReview(id)!;
  }

  getReview(id: string): Review | null {
    const row = this.db.query<ReviewRow, [string]>("SELECT * FROM review WHERE id = ?").get(id);
    return row ? toReview(row) : null;
  }

  listReviews(cardId: string): Review[] {
    return this.db
      .query<ReviewRow, [string]>("SELECT * FROM review WHERE card_id = ? ORDER BY created_at")
      .all(cardId)
      .map(toReview);
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
   * Hide or unhide a repo. Un-hiding DELETES the row rather than storing `hidden = 0`: the default
   * is "visible", so a row that says so is a row that means nothing and would accumulate forever.
   */
  setRepoHidden(path: string, hidden: boolean): void {
    if (!hidden) {
      this.db.query("DELETE FROM repo_pref WHERE path = ?").run(path);
      return;
    }
    this.db
      .query(
        `INSERT INTO repo_pref (path, hidden, updated_at) VALUES (?, 1, ?)
         ON CONFLICT(path) DO UPDATE SET hidden = 1, updated_at = excluded.updated_at`,
      )
      .run(path, this.now());
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

  /** A card's journal, newest first. */
  listEvents(cardId: string, limit = 100): BoardEvent[] {
    return this.db
      .query<EventRow, [string, number]>(
        "SELECT * FROM event WHERE card_id = ? ORDER BY ts DESC, id DESC LIMIT ?",
      )
      .all(cardId, limit)
      .map((r) => ({
        id: r.id,
        cardId: r.card_id,
        type: r.type,
        payload: r.payload === null ? null : safeJson(r.payload),
        ts: r.ts,
      }));
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
