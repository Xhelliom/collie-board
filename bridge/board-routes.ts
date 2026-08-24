// The board's HTTP surface, kept in its own module on purpose.
//
// Everything Collie-the-upstream serves lives in server.ts; everything the FORK adds lives here,
// behind a single `handleBoardRoute()` call. That keeps the diff against upstream to one import and
// one dispatch line, so rebasing stays trivial (see the fork's README → upstream posture).
//
// Auth is NOT re-implemented here: the caller hands in the same `guard()` it uses for every other
// route, so a board write is gated exactly like typing into a pane — because that is what starting
// a card eventually does.

import { existsSync } from "node:fs";
import { homedir } from "node:os";

import type { AuditLog } from "./audit.ts";
import { buildBackup, parseBackup, restoreBackup, writeSafetyBackup } from "./backup.ts";
import {
  cardView,
  cardViews,
  promptAndConfirm,
  releaseSession,
  startCard,
  wouldCycle,
} from "./cards.ts";
import type { Config } from "./config.ts";
import type { CopilotCoordinator } from "./copilot.ts";
import type { BoardDb, BoardEvent, Card, CardPatch, CardStatus, ReviewTodo } from "./db.ts";
import { isCardStatus, MAX_AGENTS_CAP } from "./db.ts";
import { cardDiffSummary, diffFile, diffStat, worktreePathFor } from "./git.ts";
import { requestHandoff } from "./handoff.ts";
import { cleanupCard, integrationFor, mergeCard, prForCard, resolveConflict } from "./integrate.ts";
import { usageTracker } from "./usage.ts";
import { fileAsDone } from "./wrapup.ts";
import { listRepos, scanRootsFor } from "./repos.ts";
import type { HerdrClient } from "./herdr-client.ts";
import type { StateEngine } from "./state-engine.ts";

/** `/api/repos` — the new-card picker's source (see repos.ts). `/api/repos/hide` toggles one. */
const REPOS_ROUTE = "/api/repos";
const REPOS_HIDE_ROUTE = "/api/repos/hide";

/** `/api/board/prefs` — the board-wide switches (see BoardDb's `board_pref`). */
const BOARD_PREFS_ROUTE = "/api/board/prefs";

/** `/api/board/usage` — how much Claude Code quota is left (see usage.ts). */
const BOARD_USAGE_ROUTE = "/api/board/usage";

/** `/api/backup` — the whole durable state as one JSON document (see backup.ts). */
const BACKUP_ROUTE = "/api/backup";
/** `/api/backup/restore` — read one back, after exporting the current state as a safety net. */
const BACKUP_RESTORE_ROUTE = "/api/backup/restore";

/** `/api/cards` and `/api/cards/<id>[/<action>]`. */
const CARD_ROUTE =
  /^\/api\/cards(?:\/([^/]+))?(?:\/(start|diff|handoff|prompt|sessions|events|review|reformulate|refine|revert|integration|explain))?$/;

/** What the board handler needs from the server. Passed in so this module imports no HTTP helpers. */
export interface BoardContext {
  db: BoardDb;
  /** Reformulation on create. Inert when the copilot is disabled, so callers never branch on it. */
  copilot: CopilotCoordinator;
  engine: StateEngine;
  /** The primary session's socket client — starting a card and handing it off both drive Herdr. */
  herdr: HerdrClient;
  cfg: Config;
  audit: AuditLog;
  /** The session name this board is bound to — recorded in the audit trail. */
  session: string;
  /** Returns a 403 Response to short-circuit, or null to proceed (server.ts's `guard`). */
  guard: (level: "read" | "write") => Response | null;
  /** The authorised device id for audit attribution, or null. */
  device: string | null;
  /** JSON response; pass a status for the non-200 board errors (409 busy, 502 herdr). */
  json: (data: unknown, status?: number) => Response;
  text: (body: string, status: number) => Response;
}

/**
 * Validate an untrusted card body into the fields we accept. Pure + exported: this is the only
 * thing standing between a JSON body and a SQL write, and it is where a wrong status or a
 * non-string acceptance entry has to die.
 */
export function parseCardBody(
  v: unknown,
  opts: { requireTitle: boolean },
): { ok: true; value: CardPatch & { title?: string } } | { ok: false; error: string } {
  if (typeof v !== "object" || v === null) return { ok: false, error: "bad body" };
  const o = v as Record<string, unknown>;
  const out: CardPatch & { title?: string } = {};

  if ("title" in o) {
    if (typeof o.title !== "string" || o.title.trim() === "") return { ok: false, error: "title required" };
    out.title = o.title.trim();
  } else if (opts.requireTitle) {
    return { ok: false, error: "title required" };
  }

  // parentId/dependsOn are card ids, so they get the same string-or-null treatment here and a
  // SEMANTIC check (does it exist, does it close a loop) in the route, which has the db.
  for (const key of [
    "spec",
    "rawInput",
    "repoPath",
    "baseRef",
    "branch",
    "agentKind",
    "parentId",
    "dependsOn",
    "duplicateOf",
    // Shape only. The canonical form (case, spacing, length) is `normalizeTag`, applied in the db so
    // the copilot's writes get it too — see there.
    "tag",
  ] as const) {
    if (!(key in o)) continue;
    const value = o[key];
    if (value !== null && typeof value !== "string") return { ok: false, error: `bad ${key}` };
    out[key] = value === null ? null : value.trim() || null;
  }

  if ("acceptance" in o) {
    if (!Array.isArray(o.acceptance)) return { ok: false, error: "bad acceptance" };
    if (!o.acceptance.every((a) => typeof a === "string")) return { ok: false, error: "bad acceptance" };
    out.acceptance = (o.acceptance as string[]).map((a) => a.trim()).filter(Boolean);
  }

  if ("status" in o) {
    if (!isCardStatus(o.status)) return { ok: false, error: "bad status" };
    out.status = o.status as CardStatus;
  }

  if ("position" in o) {
    if (typeof o.position !== "number" || !Number.isFinite(o.position)) {
      return { ok: false, error: "bad position" };
    }
    out.position = o.position;
  }

  if ("keepWorktree" in o) {
    if (typeof o.keepWorktree !== "boolean") return { ok: false, error: "bad keepWorktree" };
    out.keepWorktree = o.keepWorktree;
  }

  return { ok: true, value: out };
}

/**
 * How much of a replaced spec the card view carries.
 *
 * The journal is polled — it rides `GET /api/cards/:id`, which the card screen re-reads every
 * 1.5 s — and every edit adds a full copy of the previous title, spec and acceptance to it. Left
 * whole, one card's response grows without bound with the number of times it has been rewritten.
 *
 * A preview is enough to DECIDE, which is all this screen has to support: you recognise your own
 * paragraph from its opening, and restoring is itself reversible, so the cost of guessing wrong is
 * one more tap. The full text is never lost — `revert` reads it from the row.
 */
const REPLACED_PREVIEW_CHARS = 160;

/**
 * Trim the bulky part of a journal entry for the polled card view. Only `card.edited` carries text
 * worth trimming; every other event type is small by construction and passes through untouched.
 */
function trimEvent(event: BoardEvent): BoardEvent {
  const payload = event.payload as { reason?: unknown; replaced?: Record<string, unknown> } | null;
  if (event.type !== "card.edited" || !payload?.replaced) return event;
  const replaced: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload.replaced)) {
    replaced[key] =
      typeof value === "string" && value.length > REPLACED_PREVIEW_CHARS
        ? `${value.slice(0, REPLACED_PREVIEW_CHARS)}…`
        : value;
  }
  // `truncated` so the client can say "preview" rather than quietly presenting a clipped spec as
  // the whole of what it would restore.
  const truncated = JSON.stringify(replaced) !== JSON.stringify(payload.replaced);
  return { ...event, payload: { ...payload, replaced, ...(truncated ? { truncated } : {}) } };
}

/** Just enough of a linked card to name it on screen. Never the whole card — this is a label. */
function linkSummary(card: Card): { id: string; title: string; status: CardStatus } {
  return { id: card.id, title: card.title, status: card.status };
}

/** A review's suggested follow-ups, resolved to the card each became — or null once it's been
 *  deleted, so the detail page can show what was suggested without linking to nothing. */
function resolveReviewTodos(db: BoardDb, todos: ReviewTodo[]): { title: string; card: ReturnType<typeof linkSummary> | null }[] {
  return todos.map((t) => {
    const card = t.cardId ? db.getCard(t.cardId) : null;
    return { title: t.title, card: card ? linkSummary(card) : null };
  });
}

/**
 * The half of card-link validation that needs the database: the target has to exist, and neither
 * link may close a loop. Returns an error message, or null when the edit is fine.
 *
 * Both matter for the same reason — a card pointing at a card that isn't there, or at itself
 * through a chain, is a card that can never be started again and never says why.
 */
function checkLinks(db: BoardDb, cardId: string, patch: CardPatch): string | null {
  for (const field of ["parentId", "dependsOn"] as const) {
    const target = patch[field];
    if (target === undefined || target === null) continue;
    if (!db.getCard(target)) return `${field}: no such card`;
    if (wouldCycle(db, cardId, target, field)) return `${field}: that would make a loop`;
  }
  // `duplicateOf` gets the existence check but NOT the cycle check: it blocks nothing and is walked
  // by nothing, so two cards pointing at each other is merely redundant, never a wedge.
  if (patch.duplicateOf && !db.getCard(patch.duplicateOf)) return "duplicateOf: no such card";
  return null;
}

/**
 * Route a board request, or return null when `pathname` isn't one of ours (the caller then falls
 * through to Collie's own routes and the static PWA).
 */
export async function handleBoardRoute(
  pathname: string,
  req: Request,
  ctx: BoardContext,
): Promise<Response | null> {
  try {
    return await route(pathname, req, ctx);
  } catch (err) {
    // An unhandled throw here reaches Bun.serve, which answers with its own HTML error page and a
    // 500 — so a client polling JSON gets a document, and the cause is only visible in journalctl.
    // Every expected failure is already handled below; this is the net under the unexpected ones.
    console.error(`[board] ${req.method} ${pathname} failed: ${(err as Error).message}`);
    return ctx.json({ ok: false, error: (err as Error).message, kind: "internal" }, 500);
  }
}

async function route(
  pathname: string,
  req: Request,
  ctx: BoardContext,
): Promise<Response | null> {
  // The repo picker. A read, and on-demand only — it shells out per distinct pane cwd.
  if (pathname === REPOS_ROUTE) {
    if (req.method !== "GET") return ctx.text("method not allowed", 405);
    const denied = ctx.guard("read");
    if (denied) return denied;
    const roots = scanRootsFor(ctx.cfg.boardRepoRoots, homedir(), existsSync);
    const all = await listRepos(ctx.db, ctx.engine.current(), roots);
    // `?all=1` is how the client shows the hidden ones so they can be brought back.
    const showAll = new URL(req.url).searchParams.get("all") === "1";
    return ctx.json({
      repos: showAll ? all : all.filter((r) => !r.hidden),
      hiddenCount: all.filter((r) => r.hidden).length,
    });
  }

  // Hide / unhide one repo. A preference, not a terminal action — but it writes, so it takes the
  // write gate like everything else that writes.
  if (pathname === REPOS_HIDE_ROUTE) {
    if (req.method !== "POST") return ctx.text("method not allowed", 405);
    const denied = ctx.guard("write");
    if (denied) return denied;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return ctx.text("bad body", 400);
    }
    const { path, hidden } = (body ?? {}) as { path?: unknown; hidden?: unknown };
    if (typeof path !== "string" || path.trim() === "") return ctx.text("path required", 400);
    if (typeof hidden !== "boolean") return ctx.text("hidden must be a boolean", 400);
    ctx.db.setRepoHidden(path.trim(), hidden);
    ctx.audit.record({
      action: "repo.hide",
      session: ctx.session,
      device: ctx.device,
      detail: { path: path.trim(), hidden },
    });
    return ctx.json({ ok: true });
  }

  // The board's switches: whether a review's follow-up suggestions become cards, and how many agents
  // may run at once. Read to GET (a preference is not terminal-driving), write to change — same rule
  // as hiding a repo. POST is a PATCH in spirit: only the keys present change, so the two controls on
  // the settings screen never overwrite each other's value with a stale copy.
  // The Claude Code quota gauge. A read, cached for the TTL in usage.ts, so the dashboard asking on
  // every visit costs one subprocess per quarter hour rather than one per page load. `?refresh=1` is
  // the refresh control on that gauge — it skips the cache, which is the whole point of the button.
  if (pathname === BOARD_USAGE_ROUTE) {
    if (req.method !== "GET") return ctx.text("method not allowed", 405);
    const denied = ctx.guard("read");
    if (denied) return denied;
    const force = new URL(req.url).searchParams.get("refresh") === "1";
    // null when there is no reading to be had (no `claude` on PATH, an unrecognised panel): the
    // client then shows nothing rather than a made-up number.
    return ctx.json({ usage: await usageTracker.get(force) });
  }

  if (pathname === BOARD_PREFS_ROUTE) {
    // The concurrency limit answers as its EFFECTIVE value (the stored preference, else the env
    // default), so the settings screen shows the number that will actually be enforced.
    const prefs = () => ({
      autoFollowUps: ctx.db.autoFollowUps(),
      maxAgents: ctx.db.maxAgents() ?? ctx.cfg.boardMaxAgents,
    });
    if (req.method === "GET") {
      const denied = ctx.guard("read");
      if (denied) return denied;
      return ctx.json(prefs());
    }
    if (req.method === "POST") {
      const denied = ctx.guard("write");
      if (denied) return denied;
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return ctx.text("bad body", 400);
      }
      const { autoFollowUps, maxAgents } = (body ?? {}) as {
        autoFollowUps?: unknown;
        maxAgents?: unknown;
      };
      if (autoFollowUps !== undefined) {
        if (typeof autoFollowUps !== "boolean")
          return ctx.text("autoFollowUps must be a boolean", 400);
        ctx.db.setAutoFollowUps(autoFollowUps);
      }
      if (maxAgents !== undefined) {
        if (typeof maxAgents !== "number" || !Number.isInteger(maxAgents) || maxAgents < 1 || maxAgents > MAX_AGENTS_CAP)
          return ctx.text(`maxAgents must be a whole number between 1 and ${MAX_AGENTS_CAP}`, 400);
        ctx.db.setMaxAgents(maxAgents);
      }
      ctx.audit.record({
        action: "board.prefs",
        session: ctx.session,
        device: ctx.device,
        detail: { autoFollowUps, maxAgents },
      });
      return ctx.json(prefs());
    }
    return ctx.text("method not allowed", 405);
  }

  // The backup export. A read, but it hands over every durable byte the plugin owns — push
  // subscription keys and the audit log included — so it takes the WRITE gate: the stronger door is
  // the right one for the single request that can walk off with the lot.
  if (pathname === BACKUP_ROUTE) {
    if (req.method !== "GET") return ctx.text("method not allowed", 405);
    const denied = ctx.guard("write");
    if (denied) return denied;
    const backup = await buildBackup(ctx.db, ctx.cfg.stateDir);
    ctx.audit.record({
      action: "backup.export",
      session: ctx.session,
      device: ctx.device,
      detail: { files: backup.files.length },
    });
    return ctx.json(backup);
  }

  // The other direction. Ordered so that nothing is destroyed without a way back: validate the
  // whole document, THEN export the current state to `backups/`, and only then write. A safety
  // export that fails aborts the import — an import with no net is not one worth having.
  if (pathname === BACKUP_RESTORE_ROUTE) {
    if (req.method !== "POST") return ctx.text("method not allowed", 405);
    const denied = ctx.guard("write");
    if (denied) return denied;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return ctx.text("bad body", 400);
    }
    const parsed = parseBackup(body);
    if (!parsed.ok) return ctx.text(parsed.error, 400);

    let safetyBackup: string;
    try {
      safetyBackup = await writeSafetyBackup(ctx.db, ctx.cfg.stateDir);
    } catch (err) {
      return ctx.json(
        { ok: false, error: `safety backup failed, nothing restored: ${(err as Error).message}` },
        500,
      );
    }

    let result;
    try {
      result = await restoreBackup(ctx.db, ctx.cfg.stateDir, parsed.value);
    } catch (err) {
      // The table half is transactional, so a throw there changed nothing; the file half may be
      // half-written. Either way the operator has `safetyBackup` — name it in the error.
      return ctx.json(
        { ok: false, error: (err as Error).message, safetyBackup },
        422,
      );
    }

    ctx.audit.record({
      action: "backup.restore",
      session: ctx.session,
      device: ctx.device,
      detail: { exportedAt: parsed.value.exportedAt, ...result, safetyBackup },
    });
    // The board reads sqlite per request, so cards are live immediately. Snooze, notify-prefs and
    // the push subscriptions were loaded into memory at boot and would overwrite the restored files
    // on their next save — hence the restart, which the client relays as a herdr action.
    return ctx.json({ ok: true, ...result, safetyBackup, restartRequired: true });
  }

  const match = pathname.match(CARD_ROUTE);
  if (!match) return null;

  const id = match[1] ? decodeURIComponent(match[1]) : undefined;
  const action = match[2];
  const { db, engine, json, text } = ctx;
  // Every card view carries the copilot's in-flight set, including the ones echoed straight back
  // from a POST — a card created from a dictated dump is busy the instant it exists, and the client
  // renders that echo before its next poll.
  const view = (cardId: string) => cardView(db, engine.current(), cardId, ctx.copilot.busy());

  // ── collection ───────────────────────────────────────────────────────────
  if (!id) {
    if (req.method === "GET") {
      const denied = ctx.guard("read");
      if (denied) return denied;
      return json({ cards: cardViews(db, engine.current(), { copilotBusy: ctx.copilot.busy() }) });
    }
    if (req.method === "POST") {
      const denied = ctx.guard("write");
      if (denied) return denied;
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return text("bad body", 400);
      }
      const parsed = parseCardBody(body, { requireTitle: true });
      if (!parsed.ok) return text(parsed.error, 400);
      // A card that doesn't exist yet can't be in a cycle, but its links still have to point at
      // something real — hence the empty id, which matches nothing.
      const linkError = checkLinks(db, "", parsed.value);
      if (linkError) return text(linkError, 400);
      const card = db.createCard({ ...parsed.value, title: parsed.value.title! });
      // Reformulation is deliberately NOT awaited: creating a card has to be instant on a phone,
      // and this is an agent turn. The card is usable now and improves itself a minute later.
      if (card.rawInput) void ctx.copilot.reformulate(card.id);
      ctx.audit.record({
        action: "card.create",
        session: ctx.session,
        device: ctx.device,
        detail: { cardId: card.id, title: card.title },
      });
      return json({ ok: true, card: view(card.id) });
    }
    return text("method not allowed", 405);
  }

  // ── one card ─────────────────────────────────────────────────────────────
  if (!action) {
    if (req.method === "GET") {
      const denied = ctx.guard("read");
      if (denied) return denied;
      const detail = view(id);
      if (!detail) return text("card not found", 404);
      // The two links, RESOLVED — the detail page has only this card, so without them it cannot say
      // "waiting on X" or know it is a container, and would have to fetch the whole board to find
      // out. Two queries here, and only on the detail: doing it in `cardViews` would be N+1 on
      // every poll of the list.
      const predecessor = detail.dependsOn ? db.getCard(detail.dependsOn) : null;
      const parent = detail.parentId ? db.getCard(detail.parentId) : null;
      const duplicate = detail.duplicateOf ? db.getCard(detail.duplicateOf) : null;
      const originCard = detail.originCardId ? db.getCard(detail.originCardId) : null;
      return json({
        card: detail,
        predecessor: predecessor ? linkSummary(predecessor) : null,
        parent: parent ? linkSummary(parent) : null,
        // Resolved here for the same reason the other two are: the card screen has only this card,
        // and "you may already have this" is useless without the other one's title.
        duplicate: duplicate ? linkSummary(duplicate) : null,
        // The card this one came out of. A follow-up read on its own has lost the sentence that
        // produced it — this is the way back to it, and a dangling id resolves to null rather than
        // to a broken link.
        originCard: originCard ? linkSummary(originCard) : null,
        children: db.listChildren(id).map(linkSummary),
        sessions: db.listSessions(id),
        reviews: db.listReviews(id).map((r) => ({ ...r, todos: resolveReviewTodos(db, r.todos) })),
        events: db.listEvents(id).map(trimEvent),
      });
    }
    if (req.method === "PATCH" || req.method === "POST") {
      const denied = ctx.guard("write");
      if (denied) return denied;
      if (!db.getCard(id)) return text("card not found", 404);
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return text("bad body", 400);
      }
      const parsed = parseCardBody(body, { requireTitle: false });
      if (!parsed.ok) return text(parsed.error, 400);
      const linkError = checkLinks(db, id, parsed.value);
      if (linkError) return text(linkError, 400);
      // A status change goes through setStatus so it lands in the card's journal; everything else
      // is a plain field edit. Moving the card out of the live columns by hand also ends its
      // session — otherwise the next poll reconciles the decision away (see `releaseSession`).
      const { status, ...fields } = parsed.value;
      db.patchCard(id, fields);
      if (status === "done") {
        // The whole sequence — close the session, set the column, ask for the closing report — lives
        // in one place so this route and merge-and-done cannot drift apart on its order.
        fileAsDone(db, ctx.herdr, db.getCard(id)!);
      } else if (status) {
        releaseSession(db, id, status);
        db.setStatus(id, status, "manual");
      }
      ctx.audit.record({
        action: "card.patch",
        session: ctx.session,
        device: ctx.device,
        detail: { cardId: id, ...parsed.value },
      });
      return json({ ok: true, card: view(id) });
    }
    if (req.method === "DELETE") {
      const denied = ctx.guard("write");
      if (denied) return denied;
      if (!db.getCard(id)) return text("card not found", 404);
      db.deleteCard(id);
      ctx.audit.record({
        action: "card.delete",
        session: ctx.session,
        device: ctx.device,
        detail: { cardId: id },
      });
      return json({ ok: true });
    }
    return text("method not allowed", 405);
  }

  // ── sub-resources ────────────────────────────────────────────────────────
  if (action === "sessions" && req.method === "GET") {
    const denied = ctx.guard("read");
    if (denied) return denied;
    if (!db.getCard(id)) return text("card not found", 404);
    return json({ sessions: db.listSessions(id) });
  }
  if (action === "events" && req.method === "GET") {
    const denied = ctx.guard("read");
    if (denied) return denied;
    if (!db.getCard(id)) return text("card not found", 404);
    return json({ events: db.listEvents(id) });
  }

  // ── start: worktree + workspace + pane + agent + the spec, in one tap ─────
  if (action === "start" && req.method === "POST") {
    const denied = ctx.guard("write");
    if (denied) return denied;
    if (!db.getCard(id)) return text("card not found", 404);
    const result = await startCard(db, ctx.herdr, ctx.cfg, id);
    ctx.audit.record({
      action: "card.start",
      session: ctx.session,
      device: ctx.device,
      detail: { cardId: id, ok: result.ok, ...(result.ok ? {} : { error: result.error.message }) },
    });
    if (!result.ok) {
      // 409 for "the board says no" (busy / already running / no repo) vs 502 for a herdr failure —
      // the phone shows the message either way, but the status tells a script which is retryable.
      const status = result.error.kind === "herdr" ? 502 : 409;
      return ctx.json({ ok: false, error: result.error.message, kind: result.error.kind }, status);
    }
    return json({ ok: true, card: view(id) });
  }

  // ── reformulate: hand the card back to the copilot ───────────────────────
  // Creation runs this automatically, but a card written while the copilot was off (or one whose
  // reformulation you simply didn't like) has no other way back in. Runs in the background: the
  // request returns immediately and the card improves itself on a later poll, same as on create.
  if (action === "reformulate" && req.method === "POST") {
    const denied = ctx.guard("write");
    if (denied) return denied;
    const card = db.getCard(id);
    if (!card) return text("card not found", 404);
    if (!ctx.cfg.boardCopilot) {
      return ctx.json({ ok: false, error: "the copilot is off (COLLIE_BOARD_COPILOT)", kind: "disabled" }, 409);
    }
    // Reformulating needs SOMETHING to work from. The spec is the fallback for a card typed by hand,
    // which never had a raw dump.
    const source = card.rawInput ?? card.spec;
    if (!source?.trim()) {
      return ctx.json({ ok: false, error: "this card has nothing to reformulate", kind: "empty" }, 409);
    }
    void ctx.copilot.reformulate(id, source);
    ctx.audit.record({
      action: "card.reformulate",
      session: ctx.session,
      device: ctx.device,
      detail: { cardId: id },
    });
    return json({ ok: true, card: view(id) });
  }

  // ── refine: one free-text correction, applied to the card as it stands ────
  //
  // Separate from `reformulate` because the SOURCE differs, and that is the whole point: this one
  // reads the current card, not the original dictation, so "you said the format is unspecified —
  // make it JSON" fixes one sentence instead of redoing the card from the dump.
  if (action === "refine" && req.method === "POST") {
    const denied = ctx.guard("write");
    if (denied) return denied;
    if (!db.getCard(id)) return text("card not found", 404);
    if (!ctx.cfg.boardCopilot) {
      return ctx.json({ ok: false, error: "the copilot is off (COLLIE_BOARD_COPILOT)", kind: "disabled" }, 409);
    }
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return text("bad body", 400);
    }
    const { instruction } = (body ?? {}) as { instruction?: unknown };
    if (typeof instruction !== "string" || !instruction.trim()) {
      return text("instruction required", 400);
    }
    // Capped like every other free text that rides into a prompt — a dictation that ran away would
    // otherwise push the card itself out of the model's attention.
    void ctx.copilot.refine(id, instruction.slice(0, 4000));
    ctx.audit.record({
      action: "card.refine",
      session: ctx.session,
      device: ctx.device,
      detail: { cardId: id },
    });
    return json({ ok: true, card: view(id) });
  }

  // ── revert: put back the text an edit overwrote ───────────────────────────
  //
  // No version table and no undo stack: `patchCard` already journals every overwrite of the card's
  // written fields with the values it replaced, and the journal is append-only, so it IS the
  // history. This just reads one entry back out.
  //
  // Takes an OPTIONAL event id rather than only undoing the last change — the card view already
  // renders the journal, so "restore this one" on any entry costs nothing extra here and is more
  // honest than a stack, which forces you to undo three things to reach the one you meant.
  if (action === "revert" && req.method === "POST") {
    const denied = ctx.guard("write");
    if (denied) return denied;
    if (!db.getCard(id)) return text("card not found", 404);
    let wanted: number | undefined;
    if (req.headers.get("content-type")?.includes("json")) {
      const body = (await req.json().catch(() => null)) as { eventId?: unknown } | null;
      if (body?.eventId !== undefined) {
        if (typeof body.eventId !== "number") return text("bad eventId", 400);
        wanted = body.eventId;
      }
    }
    // A named entry is fetched BY ID, not searched for in listEvents — that one is capped at 100 for
    // the card view, so scanning it would answer "nothing to restore" for an older entry the user is
    // looking at. With no id, the newest overwrite is what the cap can always reach anyway.
    const event =
      wanted === undefined
        ? db.listEvents(id).find((e) => e.type === "card.edited")
        : (db.getEvent(wanted) ?? undefined);
    // An id from another card must not reach through — the write gate is per-request, not per-card,
    // but the audit trail and the UI both assume an entry belongs to the card it is restored onto.
    if (event && (event.cardId !== id || event.type !== "card.edited")) {
      return text("that journal entry is not an edit of this card", 400);
    }
    const replaced = (event?.payload as { replaced?: Record<string, unknown> } | null)?.replaced;
    if (!event || !replaced) {
      return ctx.json({ ok: false, error: "nothing to restore on this card", kind: "no-history" }, 409);
    }
    // Only the three written fields are ever journalled, so this cannot restore a branch or a
    // status by accident. Reverting is itself an edit, and journals as one — so it can be undone.
    const patch: CardPatch = {};
    if (typeof replaced.title === "string") patch.title = replaced.title;
    if ("spec" in replaced) patch.spec = typeof replaced.spec === "string" ? replaced.spec : null;
    if (Array.isArray(replaced.acceptance)) {
      patch.acceptance = replaced.acceptance.filter((a): a is string => typeof a === "string");
    }
    db.patchCard(id, patch, "revert");
    ctx.audit.record({
      action: "card.revert",
      session: ctx.session,
      device: ctx.device,
      detail: { cardId: id, eventId: event.id },
    });
    return json({ ok: true, card: view(id) });
  }

  // ── diff: what this card has written, scoped by construction ─────────────
  // No path filtering and no per-card bookkeeping: the card owns a branch, herdr gave that branch
  // its own worktree, so the checkout's diff against its fork point IS the card's diff.
  if (action === "diff" && req.method === "GET") {
    const denied = ctx.guard("read");
    if (denied) return denied;
    const card = db.getCard(id);
    if (!card) return text("card not found", 404);
    if (!card.repoPath || !card.branch) {
      return ctx.json({ ok: false, error: "this card has no branch yet", kind: "no-branch" }, 409);
    }
    const cwd = await worktreePathFor(card.repoPath, card.branch);
    if (!cwd) {
      return ctx.json({ ok: false, error: "no worktree for this branch", kind: "no-worktree" }, 409);
    }
    const url = new URL(req.url);
    if (url.searchParams.get("mode") === "file") {
      const path = url.searchParams.get("path") ?? "";
      const result = await diffFile(cwd, card.baseRef, path, {
        untracked: url.searchParams.get("untracked") === "1",
      });
      if (!result.ok) return ctx.json({ ok: false, error: result.error }, 400);
      return json({ ok: true, path, diff: result.diff, truncated: result.truncated });
    }
    return json({ ok: true, ...(await diffStat(cwd, card.baseRef)), cwd });
  }

  // ── review: ask the copilot for its verdict again, now ───────────────────
  //
  // The review normally fires on its own when work lands (copilot.ts → update). This is the one
  // case a person has to ask: the review ran against the WRONG BASE REF, reported "nothing
  // changed", and the base has since been corrected. Nothing here re-points the base — that is a
  // plain PATCH, and keeping the two apart means this route is also just "review it again".
  if (action === "review" && req.method === "POST") {
    const denied = ctx.guard("write");
    if (denied) return denied;
    if (!db.getCard(id)) return text("card not found", 404);
    if (!ctx.cfg.boardCopilot) {
      return ctx.json({ ok: false, error: "the copilot is off (COLLIE_BOARD_COPILOT)", kind: "disabled" }, 409);
    }
    // Background, like every other copilot call: it is an agent turn behind a one-at-a-time queue,
    // and the verdict lands in the Review section the card screen already polls.
    void ctx.copilot.reviewNow(id, (cardId) => cardDiffSummary(db, cardId));
    ctx.audit.record({
      action: "card.review",
      session: ctx.session,
      device: ctx.device,
      detail: { cardId: id },
    });
    return json({ ok: true, card: view(id) });
  }

  // ── explain: hand a RAW tool error to the copilot, for a person to read ──
  //
  // Only ever reached for text we relayed from git or herdr. The board's own refusals are already
  // written for a human, and running an agent over them would add noise and spend quota for nothing
  // — the client is what enforces that, since it knows which kind it got.
  if (action === "explain" && req.method === "POST") {
    const denied = ctx.guard("write");
    if (denied) return denied;
    const card = db.getCard(id);
    if (!card) return text("card not found", 404);
    if (!ctx.cfg.boardCopilot) {
      return ctx.json({ ok: false, error: "the copilot is off (COLLIE_BOARD_COPILOT)", kind: "disabled" }, 409);
    }
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return text("bad body", 400);
    }
    const { action: tried, error } = (body ?? {}) as { action?: unknown; error?: unknown };
    if (typeof tried !== "string" || typeof error !== "string" || !error.trim()) {
      return text("action and error required", 400);
    }
    // Background, like every other copilot call: it is an agent turn behind a one-at-a-time queue,
    // and the answer lands in the journal the card screen already polls.
    void ctx.copilot.explain(id, { action: tried.slice(0, 40), error: error.slice(0, 4000) });
    ctx.audit.record({
      action: "card.explain",
      session: ctx.session,
      device: ctx.device,
      detail: { cardId: id, tried },
    });
    return json({ ok: true, card: view(id) });
  }

  // ── integration: where the branch stands, and the three taps that end it ──
  //
  // One route, three actions, because they share a gate and differ only in which one they ask for.
  // GET is the state the card screen renders; POST is the tap. Never automatic — see integrate.ts.
  if (action === "integration") {
    const card = db.getCard(id);
    if (!card) return text("card not found", 404);

    if (req.method === "GET") {
      const denied = ctx.guard("read");
      if (denied) return denied;
      return json({ integration: await integrationFor(card) });
    }
    if (req.method !== "POST") return text("method not allowed", 405);

    const denied = ctx.guard("write");
    if (denied) return denied;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return text("bad body", 400);
    }
    const what = (body as { action?: unknown }).action;
    if (
      what !== "merge" &&
      what !== "pr" &&
      what !== "cleanup" &&
      what !== "resolve" &&
      what !== "discard"
    ) {
      return text("action must be merge, pr, resolve, cleanup or discard", 400);
    }
    const andDone = (body as { andDone?: unknown }).andDone === true;

    const result =
      what === "merge"
        ? await mergeCard(db, card)
        : what === "pr"
          ? await prForCard(db, card)
          : what === "resolve"
            ? await resolveConflict(db, ctx.herdr, card)
            : await cleanupCard(db, ctx.herdr, card, { discard: what === "discard" });

    // INTEGRATE FIRST, FILE SECOND, and only on success. The other order is the one everybody
    // reaches for — mark it done, then merge it — and it is the wrong one: filing a card ends its
    // session, so the agent that could have settled a merge conflict is gone by the time the merge
    // discovers one. A failed integration leaves the card exactly where it was, agent included.
    if (result.ok && andDone && (what === "merge" || what === "pr")) {
      fileAsDone(db, ctx.herdr, db.getCard(id)!);
    }

    ctx.audit.record({
      action: `card.${what}`,
      session: ctx.session,
      device: ctx.device,
      detail: {
        cardId: id,
        ok: result.ok,
        ...(andDone ? { andDone } : {}),
        ...(result.ok ? {} : { error: result.error.message }),
      },
    });
    if (!result.ok) {
      // 409 for "the situation says no" — a refusal, or a conflict, both of which left the
      // repository exactly as they found it. 502 for a git or herdr failure. The phone shows the
      // message either way; the status is what tells a script which one is worth retrying.
      const status = result.error.kind === "refused" || result.error.kind === "conflict" ? 409 : 502;
      return ctx.json({ ok: false, error: result.error.message, kind: result.error.kind }, status);
    }
    return json({ ok: true, ...result.value, card: view(id) });
  }

  // ── handoff: ask the agent to write its note; the poll loop does the rest ──
  if (action === "handoff" && req.method === "POST") {
    const denied = ctx.guard("write");
    if (denied) return denied;
    if (!db.getCard(id)) return text("card not found", 404);
    const result = await requestHandoff(db, ctx.herdr, id);
    ctx.audit.record({
      action: "card.handoff",
      session: ctx.session,
      device: ctx.device,
      detail: { cardId: id, ok: result.ok, ...(result.ok ? {} : { error: result.error.message }) },
    });
    if (!result.ok) {
      const status = result.error.kind === "herdr" ? 502 : 409;
      return ctx.json({ ok: false, error: result.error.message, kind: result.error.kind }, status);
    }
    return json({ ok: true, card: view(id) });
  }

  // ── prompt: a follow-up instruction to the card's running agent ───────────
  if (action === "prompt" && req.method === "POST") {
    const denied = ctx.guard("write");
    if (denied) return denied;
    const card = db.getCard(id);
    if (!card) return text("card not found", 404);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return text("bad body", 400);
    }
    const promptText = (body as { text?: unknown }).text;
    if (typeof promptText !== "string" || promptText.trim() === "") return text("text required", 400);
    const session = db.openSessionFor(id);
    if (!session?.paneId) {
      return ctx.json({ ok: false, error: "this card has no running agent", kind: "no-session" }, 409);
    }
    try {
      await promptAndConfirm(ctx.herdr, session.paneId, promptText);
    } catch (err) {
      return ctx.json({ ok: false, error: (err as Error).message, kind: "herdr" }, 502);
    }
    db.recordEvent(id, "card.prompted", { chars: promptText.length, followUp: true });
    ctx.audit.record({
      action: "card.prompt",
      paneId: session.paneId,
      session: ctx.session,
      device: ctx.device,
      detail: { cardId: id, text: promptText },
    });
    return json({ ok: true, card: view(id) });
  }

  return text("method not allowed", 405);
}
