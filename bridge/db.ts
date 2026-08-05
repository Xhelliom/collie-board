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

/**
 * The complement of {@link LIVE_STATUSES}: a column that says no agent is meant to be working. Moving
 * a card into one of these BY HAND is the operator ending the card's session, so it is also the test
 * the API uses to decide whether to close it (see ADR 0002).
 */
export function isLiveStatus(status: CardStatus): boolean {
  return LIVE_STATUSES.includes(status);
}

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
   * worktree" tap would, and just as safely refused if the branch turns out not to be fully merged.
   * This is the one flag that skips the attempt outright, for the branch the operator wants to poke
   * at afterwards.
   */
  keepWorktree: boolean;
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

/** A review-suggested follow-up, and the card it became — `cardId` is null only for data written
 *  before this linked (bare titles, no card to point at). */
export interface ReviewTodo {
  title: string;
  cardId: string | null;
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
  tag: string | null;
  position: number;
  created_at: number;
  updated_at: number;
  keep_worktree: number;
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
      const cardId = (v as { cardId?: unknown }).cardId;
      out.push({ title: (v as { title: string }).title, cardId: typeof cardId === "string" ? cardId : null });
    }
  }
  return out;
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
    // No tag is the normal state, not a gap: every card written before tags existed reads as null,
    // and nothing downstream may treat that as missing data.
    tag: r.tag ?? null,
    position: r.position,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    keepWorktree: r.keep_worktree === 1,
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
  -- One tag or none. Nullable by design — see Card.tag.
  tag          TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  keep_worktree INTEGER NOT NULL DEFAULT 0
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
  tag?: string | null;
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
  duplicateOf?: string | null;
  dependsOn?: string | null;
  tag?: string | null;
  position?: number;
  keepWorktree?: boolean;
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
    this.db.transaction(() => {
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
    })();
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
                           branch, workspace_id, agent_kind, parent_id, depends_on, tag, position,
                           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
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
        normalizeTag(input.tag),
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

  /**
   * Cards whose work has landed and is worth a copilot review: an agent that finished its turn, and
   * a card the operator filed as done. `done` is deliberately included — it is the only path that
   * carries a wrapup note, and the operator filing a card is the clearest "this work is finished"
   * signal the board ever gets.
   */
  listReviewableCards(): Card[] {
    return this.db
      .query<CardRow, []>("SELECT * FROM card WHERE status IN ('review', 'done')")
      .all()
      .map(toCard);
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
        key === "acceptance"
          ? JSON.stringify(value ?? [])
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
    todos?: ReviewTodo[];
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

  /**
   * One journal entry by id. Separate from {@link listEvents} because that one is CAPPED at 100 for
   * the card view — scanning its result to find an entry to restore silently makes the 101st-oldest
   * unreachable, and answers "nothing to restore" for an entry the user can see.
   */
  getEvent(id: number): BoardEvent | null {
    const r = this.db.query<EventRow, [number]>("SELECT * FROM event WHERE id = ?").get(id);
    if (!r) return null;
    return {
      id: r.id,
      cardId: r.card_id,
      type: r.type,
      payload: r.payload === null ? null : safeJson(r.payload),
      ts: r.ts,
    };
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
