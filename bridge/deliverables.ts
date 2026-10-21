import { lstat, mkdir, readdir, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

import type { BoardContext } from "./board-routes.ts";
import { containedIn } from "./gallery.ts";
import { computeEtag, notModified } from "./http-cache.ts";
import { scrubHtml } from "./scrub.ts";

// What an agent made for a card — an image, a page, a PDF, a spreadsheet — published into a store
// the BRIDGE keeps, under `<stateDir>/deliverables/<cardId>/<name>` (ADR 0045). Not the worktree
// (artifacts.ts: gone after merge and cleanup), not the scratchpad (gallery.ts: /tmp). The file is
// the truth: no table, the listing is the directory. Deleted with the card; no TTL.
//
// SECURITY. The bridge never reads a path the client names: a publish carries the BYTES in its
// body, and the name is sanitised to one safe basename before it touches the disk. Serving is
// gallery.ts's rule — one root, realpath on both sides, containment — so a symlink planted in the
// store (by anything) still serves nothing outside it. SVG is refused: a script host on a top-level
// navigation to the app's origin. Anything not rendered inline goes out as an attachment.

/** Most bytes one deliverable may weigh. server.ts's runtime body cap sits just above it. */
export const MAX_DELIVERABLE_BYTES = 25 * 1024 * 1024;

/** The journal entry a publish writes on the card, for the orchestrator to see it pass. */
export const PUBLISHED_EVENT = "deliverable.published";

/** `/api/cards/<id>/deliverables` and `/api/cards/<id>/deliverables/<name>`. */
const ROUTE = /^\/api\/cards\/([^/]+)\/deliverables(?:\/([^/]+))?$/;

/** The store's root under the state dir — the same dir `uploads/` lives in. */
export const deliverablesRoot = (stateDir: string): string => join(stateDir, "deliverables");

/**
 * One safe file name out of whatever the client sent, or null when nothing usable is left. Basename
 * only (either slash), no control byte, nothing outside `[A-Za-z0-9._ -]`, no leading dot (no hidden
 * file, no `..`), at most 120 characters with the extension kept. Pure + exported for the test.
 */
export function sanitizeName(raw: string): string | null {
  const base = raw.split(/[/\\]/).pop() ?? "";
  let name = base.replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^[.\s]+/, "").trim();
  if (name.length > 120) {
    const ext = extname(name).slice(0, 20);
    name = name.slice(0, 120 - ext.length) + ext;
  }
  return name && !/^[._ -]*$/.test(name) ? name : null;
}

/** `name.ext` → `name-2.ext`, `name-3.ext`… — the suffix a name already taken gets. Pure. */
export function suffixed(name: string, n: number): string {
  const ext = extname(name);
  return `${name.slice(0, name.length - ext.length)}-${n}${ext}`;
}

const IMAGE: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** How a deliverable is served — decided by its extension alone, never by its bytes. Pure. */
export type ServedAs =
  | { kind: "image"; mime: string }
  | { kind: "markdown"; mime: "text/markdown" }
  | { kind: "html"; mime: "text/html" }
  | { kind: "pdf"; mime: "application/pdf" }
  | { kind: "attachment"; mime: "application/octet-stream" };

export function servedAs(name: string): ServedAs {
  const ext = extname(name).toLowerCase();
  if (IMAGE[ext]) return { kind: "image", mime: IMAGE[ext] };
  if (ext === ".md" || ext === ".markdown") return { kind: "markdown", mime: "text/markdown" };
  if (ext === ".html" || ext === ".htm") return { kind: "html", mime: "text/html" };
  if (ext === ".pdf") return { kind: "pdf", mime: "application/pdf" };
  return { kind: "attachment", mime: "application/octet-stream" };
}

/** True for the one family refused outright at publish (see the security note). Pure. */
export const isRefused = (name: string): boolean => /\.svgz?$/i.test(name);

/** One entry of a card's listing. `by` comes from the journal entry its publish wrote. */
export interface Deliverable {
  name: string;
  size: number;
  mime: string;
  publishedAt: number;
  by: "agent" | "operator" | null;
}

/** Every regular file in a card's store, newest first. Symlinks are not files here. */
export async function listDeliverables(
  dir: string,
  byName: Map<string, Deliverable["by"]> = new Map(),
): Promise<Deliverable[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // nothing published yet
  }
  const out: Deliverable[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    try {
      const s = await lstat(join(dir, e.name));
      out.push({ name: e.name, size: s.size, mime: servedAs(e.name).mime, publishedAt: s.mtimeMs, by: byName.get(e.name) ?? null });
    } catch {
      /* deleted between readdir and stat */
    }
  }
  return out.sort((a, b) => b.publishedAt - a.publishedAt);
}

/**
 * The file to serve for `name` in `dir`, or null: realpath on both sides, then containment, then a
 * regular file. A symlink pointing out of the store resolves outside it and is refused.
 */
export async function resolveDeliverable(dir: string, name: string): Promise<string | null> {
  try {
    const root = await realpath(dir);
    const full = await realpath(join(dir, name));
    if (!containedIn(root, full) || full === root) return null;
    return (await lstat(full)).isFile() ? full : null;
  } catch {
    return null;
  }
}

/**
 * Write `bytes` under a free name derived from `name` in `dir` and return the name used. `wx` makes
 * the "is it taken" check and the write one step, so two publishes of the same name both land.
 */
export async function writeDeliverable(dir: string, name: string, bytes: Uint8Array): Promise<string> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : suffixed(name, n);
    try {
      await writeFile(join(dir, candidate), bytes, { flag: "wx", mode: 0o600 });
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST" || n >= 1000) throw err;
    }
  }
}

/** Drop a card's whole store. Called when the card is deleted. */
export async function removeCardDeliverables(stateDir: string, cardId: string): Promise<void> {
  if (!cardId || cardId.includes("/") || cardId.startsWith(".")) return;
  await rm(join(deliverablesRoot(stateDir), cardId), { recursive: true, force: true });
}

/**
 * Remove the stores whose card is gone — the deletes that did not pass through the card route (a
 * copilot's replaced children, a converted card). Run once at startup; returns the ids removed.
 */
export async function sweepOrphanDeliverables(stateDir: string, cardExists: (id: string) => boolean): Promise<string[]> {
  let ids: string[];
  try {
    ids = await readdir(deliverablesRoot(stateDir));
  } catch {
    return [];
  }
  const gone = ids.filter((id) => !cardExists(id));
  for (const id of gone) await removeCardDeliverables(stateDir, id);
  return gone;
}

/** Who published each name, from the card's journal — the newest publish of a name wins. */
function publishers(ctx: Pick<BoardContext, "db">, cardId: string): Map<string, Deliverable["by"]> {
  const out = new Map<string, Deliverable["by"]>();
  // shortcut: reads the whole journal of the card; a dedicated typed query if a card's journal grows huge.
  for (const e of ctx.db.listEvents(cardId, Number.MAX_SAFE_INTEGER)) {
    if (e.type !== PUBLISHED_EVENT) continue;
    const p = e.payload as { name?: string; by?: Deliverable["by"] } | null;
    if (p?.name && !out.has(p.name)) out.set(p.name, p.by ?? null);
  }
  return out;
}

type DeliverablesContext = Pick<BoardContext, "db" | "cfg" | "guard" | "json" | "text" | "audit" | "session" | "device">;

/** The card's deliverable routes, or null when `pathname` is not one of them. */
export async function handleDeliverablesRoute(
  pathname: string,
  req: Request,
  ctx: DeliverablesContext,
): Promise<Response | null> {
  const m = ROUTE.exec(pathname);
  if (!m) return null;
  let cardId: string, rawName: string | null;
  try {
    cardId = decodeURIComponent(m[1]!);
    rawName = m[2] === undefined ? null : decodeURIComponent(m[2]);
  } catch {
    return ctx.text("not found", 404); // a malformed %-escape
  }
  const write = req.method === "POST" || req.method === "DELETE";
  const denied = ctx.guard(write ? "write" : "read");
  if (denied) return denied;
  if (!ctx.db.getCard(cardId)) return ctx.text("card not found", 404);
  const dir = join(deliverablesRoot(ctx.cfg.stateDir), cardId);

  if (rawName === null) {
    if (req.method === "GET") return ctx.json({ deliverables: await listDeliverables(dir, publishers(ctx, cardId)) });
    if (req.method !== "POST") return ctx.text("method not allowed", 405);
    const name = sanitizeName(new URL(req.url).searchParams.get("name") ?? "");
    if (!name) return ctx.text("name required", 400);
    if (isRefused(name)) return ctx.text("SVG is not accepted — publish a PNG", 415);
    if (Number(req.headers.get("content-length") ?? 0) > MAX_DELIVERABLE_BYTES) return ctx.text("too large (25 MB max)", 413);
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.byteLength > MAX_DELIVERABLE_BYTES) return ctx.text("too large (25 MB max)", 413);
    if (bytes.byteLength === 0) return ctx.text("empty body — send the file with --data-binary @file", 400);
    const saved = await writeDeliverable(dir, name, bytes);
    // Provenance is derived from the pane header (ADR 0010), never read from the request's body.
    const pane = req.headers.get("x-collie-pane")?.trim() || null;
    const by = pane ? "agent" : "operator";
    ctx.db.recordEvent(cardId, PUBLISHED_EVENT, { cardId, name: saved, size: bytes.byteLength, by, ...(pane ? { pane } : {}) });
    ctx.audit.record({ action: PUBLISHED_EVENT, session: ctx.session, device: ctx.device, detail: { cardId, name: saved, size: bytes.byteLength } });
    return ctx.json({ ok: true, name: saved, size: bytes.byteLength, mime: servedAs(saved).mime });
  }

  // A name in the path must already be one this store could have written; anything else is not here.
  if (sanitizeName(rawName) !== rawName) return ctx.text("not found", 404);
  const full = await resolveDeliverable(dir, rawName);
  if (!full) return ctx.text("not found", 404);
  if (req.method === "DELETE") {
    await unlink(full);
    // Journaled so the project's facts stop listing it (bridge/project-facts.ts).
    ctx.db.recordEvent(cardId, "deliverable.deleted", { cardId, name: rawName });
    ctx.audit.record({ action: "deliverable.delete", session: ctx.session, device: ctx.device, detail: { cardId, name: rawName } });
    return ctx.json({ ok: true });
  }
  if (req.method !== "GET") return ctx.text("method not allowed", 405);
  return serveDeliverable(full, rawName, req.headers.get("if-none-match"));
}

/** The bytes, under the headers their kind gets. `nosniff` on every one of them. */
async function serveDeliverable(full: string, name: string, ifNoneMatch: string | null): Promise<Response> {
  const file = Bun.file(full);
  const etag = computeEtag(`${file.size}-${file.lastModified}`);
  const base = { "cache-control": "private, no-cache", "x-content-type-options": "nosniff", etag };
  if (notModified(ifNoneMatch, etag)) return new Response(null, { status: 304, headers: base });
  const as = servedAs(name);
  switch (as.kind) {
    case "image":
      return new Response(file, { headers: { ...base, "content-type": as.mime } });
    case "markdown":
      return new Response(await file.text(), { headers: { ...base, "content-type": "text/markdown; charset=utf-8" } });
    case "html":
      return new Response(scrubHtml(await file.text()), {
        headers: { ...base, "content-type": "text/html; charset=utf-8", "content-security-policy": "sandbox" },
      });
    case "pdf":
      return new Response(file, { headers: { ...base, "content-type": as.mime, "content-security-policy": "sandbox" } });
    case "attachment":
      return new Response(file, {
        headers: { ...base, "content-type": as.mime, "content-disposition": `attachment; filename="${name}"` },
      });
  }
}
