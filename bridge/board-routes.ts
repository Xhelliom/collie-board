// The board's HTTP surface, kept in its own module on purpose.
//
// Everything Collie-the-upstream serves lives in server.ts; everything the FORK adds lives here,
// behind a single `handleBoardRoute()` call. That keeps the diff against upstream to one import and
// one dispatch line, so rebasing stays trivial (see the fork's README → upstream posture).
//
// Auth is NOT re-implemented here: the caller hands in the same `guard()` it uses for every other
// route, so a board write is gated exactly like typing into a pane — because that is what starting
// a card eventually does.

import type { AuditLog } from "./audit.ts";
import { cardView, cardViews, startCard } from "./cards.ts";
import type { Config } from "./config.ts";
import type { BoardDb, CardPatch, CardStatus } from "./db.ts";
import { isCardStatus } from "./db.ts";
import type { HerdrClient } from "./herdr-client.ts";
import type { StateEngine } from "./state-engine.ts";

/** `/api/cards` and `/api/cards/<id>[/<action>]`. */
const CARD_ROUTE = /^\/api\/cards(?:\/([^/]+))?(?:\/(start|diff|handoff|prompt|sessions|events|review))?$/;

/** What the board handler needs from the server. Passed in so this module imports no HTTP helpers. */
export interface BoardContext {
  db: BoardDb;
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

  for (const key of ["spec", "rawInput", "repoPath", "baseRef", "branch", "agentKind"] as const) {
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

  return { ok: true, value: out };
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
  const match = pathname.match(CARD_ROUTE);
  if (!match) return null;

  const id = match[1] ? decodeURIComponent(match[1]) : undefined;
  const action = match[2];
  const { db, engine, json, text } = ctx;

  // ── collection ───────────────────────────────────────────────────────────
  if (!id) {
    if (req.method === "GET") {
      const denied = ctx.guard("read");
      if (denied) return denied;
      return json({ cards: cardViews(db, engine.current()) });
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
      const card = db.createCard({ ...parsed.value, title: parsed.value.title! });
      ctx.audit.record({
        action: "card.create",
        session: ctx.session,
        device: ctx.device,
        detail: { cardId: card.id, title: card.title },
      });
      return json({ ok: true, card: cardView(db, engine.current(), card.id) });
    }
    return text("method not allowed", 405);
  }

  // ── one card ─────────────────────────────────────────────────────────────
  if (!action) {
    if (req.method === "GET") {
      const denied = ctx.guard("read");
      if (denied) return denied;
      const view = cardView(db, engine.current(), id);
      if (!view) return text("card not found", 404);
      return json({
        card: view,
        sessions: db.listSessions(id),
        reviews: db.listReviews(id),
        events: db.listEvents(id),
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
      // A status change goes through setStatus so it lands in the card's journal; everything else
      // is a plain field edit.
      const { status, ...fields } = parsed.value;
      db.patchCard(id, fields);
      if (status) db.setStatus(id, status, "manual");
      ctx.audit.record({
        action: "card.patch",
        session: ctx.session,
        device: ctx.device,
        detail: { cardId: id, ...parsed.value },
      });
      return json({ ok: true, card: cardView(db, engine.current(), id) });
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
    return json({ ok: true, card: cardView(db, engine.current(), id) });
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
      await ctx.herdr.promptAgent({ target: session.paneId, text: promptText });
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
    return json({ ok: true, card: cardView(db, engine.current(), id) });
  }

  return text("method not allowed", 405);
}
