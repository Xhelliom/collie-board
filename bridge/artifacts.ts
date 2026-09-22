// Session artifacts — the images/HTML/Markdown a card's session wrote or mentioned, readable from the
// phone. This is the fork's answer to "the agent produced a screenshot / a validation page / a report,
// and I can't open any of them without a laptop": the read/History view of a pane offers the list and
// renders each kind — PNG/JPEG as an image, Markdown rendered, HTML scrubbed and sandboxed.
//
// WHY A NEW ROOT. The gallery (gallery.ts) serves the HARNESS scratchpad — `/tmp/claude-<uid>` — which
// is where an agent SAVES a picture it happens to generate. A card's WORKTREE is a different thing:
// the files it genuinely produces for the task — `docs/hero-recette/*.png`, a validation `*.html`, a
// `*.md` report — live in the checkout herdr created for the card's branch, and the gallery root can
// not see them. This module serves that tree instead.
//
// SECURITY. The posture is the same "one root, resolved on both sides" rule the gallery and the
// transcript reader use, with one difference that makes it NARROWER, not wider: the root is not a
// compile-time constant, it is DERIVED PER REQUEST from the card backing the pane —
// `git worktree list` for the card's own branch. A client never names the root; it only passes a
// path back that this same module offered, and a file is served only when its FULLY RESOLVED form
// still lives under the fully resolved worktree root. A symlink an agent planted in the checkout
// (or one that was in the repo before it started) is the same escape route the gallery refuses:
// realpath on both sides, then the containment test. Anything else — an unknown extension, a
// missing file, a path outside the root — is "not servable", no second rule, no escape hatch.
//
// RENDERING. The route serves bytes; the phone renders. Images are handed over verbatim (the same
// content-types as the gallery, so still no SVG). Markdown is handed over as text and rendered by the
// client's existing MarkdownText. HTML is scrubbed SERVER-SIDE — `script`/`iframe`/`object`/`embed`
// subtrees dropped, external stylesheet `<link>`s dropped, `on*` handlers stripped — and served under
// a `sandbox` CSP, and the client additionally frames it in a sandboxed iframe. Belt and braces, and
// each half is independently testable.

import { realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, normalize, sep } from "node:path";

import { containedIn, IMAGE_TYPES } from "./gallery.ts";
import { diffStat, runGit, worktreePathFor, type GitRunner } from "./git.ts";
import { computeEtag, gzipJsonResponse, notModified } from "./http-cache.ts";
import type { TranscriptEntry } from "./transcript.ts";

/** What an artifact is, and therefore how the client renders it. */
export type ArtifactKind = "image" | "markdown" | "html";

/**
 * The image side is the gallery's own list — so an image type added there extends the artifact reader
 * here with zero drift, and SVG stays excluded for the same reason it is excluded from the gallery.
 */
const IMAGE_KINDS: Record<string, ArtifactKind> = {};
for (const ext of Object.keys(IMAGE_TYPES)) IMAGE_KINDS[ext] = "image";

/**
 * Extensions served, and the kind each gets. Lowercased keys — callers normalise the extension.
 * Only these three families are ever servable: a `.txt`, a `.json`, a `.pdf` is not a session
 * artifact this view knows how to render, and every other kind just widens the read surface.
 */
export const ARTIFACT_TYPES: Record<string, ArtifactKind> = {
  ...IMAGE_KINDS,
  ".md": "markdown",
  ".markdown": "markdown",
  ".mdown": "markdown",
  ".html": "html",
  ".htm": "html",
};

/** The kind an extension would get, or null when the extension is not servable at all. Pure. */
export function artifactKindOf(path: string): ArtifactKind | null {
  return ARTIFACT_TYPES[extname(path).toLowerCase()] ?? null;
}

/** One artifact in the list. `path` is what the client passes back to fetch the bytes. */
export interface ArtifactInfo {
  /** Absolute path inside the worktree — the `p` the client echoes back to the file endpoint. */
  path: string;
  /** The filename, for the row label. */
  name: string;
  /** Path relative to the worktree root, for the muted secondary line. */
  rel: string;
  kind: ArtifactKind;
  size: number;
  mtime: number;
}

/**
 * Resolve a requested absolute path to the servable file, or null when it must not be served.
 *
 * Both sides go through realpath before the containment test — the same rule as
 * {@link gallery.ts resolveImage}: a symlink in the worktree (a committed `docs/link.md -> /etc/x`,
 * an agent-planted escape) must not become a way to read arbitrary files, and comparing unresolved
 * strings would wave it straight through. The root here is the CARD's worktree, derived server-side;
 * it is never client input.
 */
export async function resolveArtifact(
  root: string,
  requested: string,
): Promise<{ full: string; root: string; kind: ArtifactKind } | null> {
  if (!isAbsolute(requested)) return null;
  const kind = artifactKindOf(requested);
  if (!kind) return null;
  try {
    const realRoot = await realpath(root);
    const full = await realpath(normalize(requested));
    return containedIn(realRoot, full) ? { full, root: realRoot, kind } : null;
  } catch {
    return null; // missing file, missing root, or a dangling symlink — all "not servable"
  }
}

/**
 * Most bytes a text artifact may hand to the phone. Images ride on `Bun.file` directly. A report
 * beyond this is not a phone document — better a clipped page than a multi-megabyte download.
 */
const MAX_TEXT_ARTIFACT_BYTES = 2 * 1024 * 1024;

const ARTIFACT_KIND_HEADERS: Record<
  Exclude<ArtifactKind, "image">,
  { "content-type": string; "content-security-policy"?: string }
> = {
  markdown: { "content-type": "text/markdown; charset=utf-8" },
  // The `sandbox` CSP makes even a top-level navigation to this URL inert: no scripts, no forms, no
  // top navigation, no popups — the same restriction the client's sandboxed iframe applies. The
  // app's own CSP (`frame-ancestors 'none'`) is deliberately NOT applied here: this document is
  // MEANT to be framed by the reading view.
  html: { "content-type": "text/html; charset=utf-8", "content-security-policy": "sandbox" },
};

/**
 * Serve one resolved artifact: images as bytes, Markdown as text, HTML scrubbed under a sandbox CSP.
 * Revalidates like the gallery — a render the agent keeps overwriting must not cache blind, and an
 * unchanged one over a phone link is exactly the cost an ETag saves. Pure I/O given a resolved path.
 */
async function serveArtifact(
  full: string,
  kind: ArtifactKind,
  ifNoneMatch: string | null,
): Promise<Response> {
  const file = Bun.file(full);
  const etag = computeEtag(`${file.size}-${file.lastModified}`);
  if (notModified(ifNoneMatch, etag)) {
    return new Response(null, { status: 304, headers: { etag, "cache-control": "private, no-cache" } });
  }
  if (kind === "image") {
    return new Response(file, {
      headers: {
        "content-type": IMAGE_TYPES[extname(full).toLowerCase()] ?? "application/octet-stream",
        "cache-control": "private, no-cache",
        etag,
      },
    });
  }
  const text = file.size > MAX_TEXT_ARTIFACT_BYTES
    ? await file.slice(0, MAX_TEXT_ARTIFACT_BYTES).text()
    : await file.text();
  const base = ARTIFACT_KIND_HEADERS[kind];
  const body = kind === "html" ? scrubHtml(text) : text;
  return new Response(body, {
    headers: { ...base, "cache-control": "private, no-cache", etag },
  });
}

// ── HTML scrubbing ────────────────────────────────────────────────────────────
//
// The one place agent-authored bytes are interpreted as markup, so the survival rule is "a `script`
// tag names a script even if it once contained prose" — everything in these subtrees is dropped, and
// everything else is kept but neutered. The sandboxed iframe is the second lock; the scrubber is the
// first, and it is the one that keeps the served bytes clean even outside the iframe.

/** Tags whose whole subtree is discarded — each is a script/foreign-content host. */
const SCRUB_BLOCK_TAGS = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "frame",
  "frameset",
  "noscript",
  "noembed",
]);

/** Index just past the first `</tag>` close tag at/after `from`, or -1 when the block never closes. */
function closeTagEnd(html: string, tag: string, from: number): number {
  // `g` is load-bearing: without it lastIndex is ignored and the match can land BEFORE `from`,
  // which would send the scanner's cursor backward — an infinite loop on a second block tag.
  const re = new RegExp(`</${tag}\\s*>`, "gi");
  re.lastIndex = from;
  const m = re.exec(html);
  return m === null ? -1 : m.index + m[0]!.length;
}

/** True when a `<link …>` tag is an external stylesheet (`rel` contains `stylesheet`). */
function isStylesheetLink(tag: string): boolean {
  const m = /\brel\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i.exec(tag);
  if (m === null) return false;
  const rel = m[1]!.replace(/^["']|["']$/g, "").toLowerCase();
  return rel.split(/\s+/).includes("stylesheet");
}

/** Strip `onclick="…"`-style event-handler attributes from a surviving tag. */
function scrubEventHandlers(tag: string): string {
  return tag.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

/**
 * Scrub agent-written HTML for safe display. Pure + exported so a fixture can pin the rules.
 *
 * Removed: the whole subtree of `script`/`iframe`/`object`/`embed`/`frame`/`frameset` (and the
 * no-script variants), external `<link rel=stylesheet>` tags, and `on*` attributes on any tag that
 * survives. Kept: the document's own inline `<style>` (its `@import`s can't fetch under sandbox) and
 * everything else, on the assumption that the sandboxed context renders it inert.
 *
 * The scanner is a small tag tokenizer, not a regex over the whole document, because agent HTML is
 * arbitrary: a `>` inside quoted attribute values must not end a tag early, and a `>` inside a
 * script body must not defeat the block drop. Script bodies are never tokenized — they are skipped
 * in one `</script>` search, so `if (a > b)` cannot smuggle anything past.
 */
export function scrubHtml(html: string): string {
  const out: string[] = [];
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      out.push(html.slice(i));
      break;
    }
    out.push(html.slice(i, lt));

    // Comments stay whole; the doc keeps its annotations.
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      if (end === -1) {
        out.push(html.slice(lt));
        break;
      }
      out.push(html.slice(lt, end + 3));
      i = end + 3;
      continue;
    }

    // Declarations (`<!DOCTYPE …>`) and processing instructions (`<?…>`) stay whole.
    const bang = html[lt + 1];
    if (bang === "!" || bang === "?") {
      const gt = html.indexOf(">", lt + 2);
      if (gt === -1) {
        out.push(html.slice(lt));
        break;
      }
      out.push(html.slice(lt, gt + 1));
      i = gt + 1;
      continue;
    }

    // Tag name — letters, digits, `:`, `_`, `-` (namespaces, custom elements). A leading `/`
    // marks a CLOSE tag, which is kept verbatim (a block tag's close is consumed by the skip below,
    // so any `</…>` that reaches here is a normal close).
    let j = lt + 1;
    let closing = false;
    if (html[j] === "/") {
      closing = true;
      j++;
    }
    let name = "";
    while (j < n && /[A-Za-z0-9:_-]/.test(html[j]!)) {
      name += html[j]!;
      j++;
    }
    const lower = name.toLowerCase();
    if (lower === "") {
      out.push("<"); // a stray `<` that isn't a tag — literal text
      i = lt + 1;
      continue;
    }

    // Scan to the tag's `>`, honouring quoted attribute values so a `>` inside one doesn't end the
    // tag early — and an attribute value can't smuggle a tag boundary.
    let k = j;
    let quote = "";
    while (k < n) {
      const ch = html[k]!;
      if (ch === '"' || ch === "'") {
        if (quote === "") quote = ch;
        else if (quote === ch) quote = "";
      } else if (ch === ">" && quote === "") {
        break;
      }
      k++;
    }
    const tagText = html.slice(lt, k + 1);
    const selfClosing = tagText.endsWith("/>");

    if (SCRUB_BLOCK_TAGS.has(lower)) {
      // Drop the whole element. A self-closing one is just its tag; anything else goes through the
      // first matching close tag — content between is discarded untokenized.
      let next = k + 1;
      if (!selfClosing) {
        const end = closeTagEnd(html, lower, k + 1);
        next = end === -1 ? n : end;
      }
      // Belt: never let the cursor move backward, whatever a pathological document did to the scan.
      i = next > i ? next : k + 1;
      continue;
    }

    if (closing) {
      out.push(scrubEventHandlers(tagText));
      i = k + 1;
      continue;
    }

    if (lower === "link" && isStylesheetLink(tagText)) {
      i = k + 1; // external stylesheets don't load in a sandbox, and their CSP is not ours to trust
      continue;
    }

    out.push(scrubEventHandlers(tagText));
    i = k + 1;
  }
  return out.join("");
}

// ── discovery ────────────────────────────────────────────────────────────────
//
// "Session artifacts" = files the session WROTE (the card's worktree diff against its fork point,
// the same sign the card's own diff view uses) ∪ files it MENTIONED (paths named in the
// conversation, from the parsed transcript). Both are just CANDIDATES — every one still has to
// resolve inside the worktree root and be a servable kind before it becomes an entry, so a noisy
// candidate (a grep pattern that looks like a path, a file an agent read and replaced) costs
// nothing more than a containment check.

/**
 * The absolute paths a parsed conversation named — the "mentioned" half of discovery.
 *
 * Two unambiguous signals only: a tool call that surfaced an image path (the transcript already
 * decided it is a picture), and a tool summary that IS an absolute path (Read/Write/Edit summarize
 * to exactly that). Anything ambiguous is left for the containment filter to drop downstream, not
 * guessed at here. Pure + exported for the test.
 */
export function mentionedArtifactCandidates(entries: TranscriptEntry[]): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    for (const part of entry.parts) {
      if (part.kind !== "tool") continue;
      if (part.image !== undefined && !part.image.startsWith("data:")) out.push(part.image);
      const summary = part.summary.trim();
      // A path is absolute and single-token; anything else is a pattern or a phrase, not a file.
      if (summary.startsWith("/") && !summary.includes(" ") && !summary.includes("\t")) out.push(summary);
    }
  }
  return out;
}

/**
 * The servable artifacts among a set of candidates, newest first. Candidates may be relative (git
 * diff paths, which are relative to the worktree) or absolute (transcript mentions); each is
 * confined through {@link resolveArtifact}, so a candidate that resolves outside — or a symlink that
 * escapes — simply never becomes an entry. De-duplicated by resolved path.
 */
export async function listWorktreeArtifacts(
  root: string,
  candidates: Iterable<string>,
): Promise<ArtifactInfo[]> {
  const seen = new Set<string>();
  const artifacts: ArtifactInfo[] = [];
  for (const candidate of candidates) {
    const abs = isAbsolute(candidate) ? normalize(candidate) : normalize(join(root, candidate));
    const resolved = await resolveArtifact(root, abs);
    if (resolved === null || seen.has(resolved.full)) continue;
    seen.add(resolved.full);
    let st;
    try {
      st = await stat(resolved.full);
    } catch {
      continue; // vanished between resolve and stat — a live worktree, skip it
    }
    const rel = resolved.full.startsWith(resolved.root + sep)
      ? resolved.full.slice(resolved.root.length + 1)
      : basename(resolved.full);
    artifacts.push({
      path: resolved.full,
      name: basename(resolved.full),
      rel,
      kind: resolved.kind,
      size: st.size,
      mtime: st.mtimeMs,
    });
  }
  return artifacts.sort((a, b) => b.mtime - a.mtime);
}

// ── the pane → worktree link ────────────────────────────────────────────────
//
// The root is derived from the CARD, never from the request: a pane id names a session, the session
// names a card, the card names its branch and repo, and `git worktree list` answers where that
// branch is checked out. A pane with no card — a hand-launched agent, a bare shell — has no root,
// which reads as "no artifacts", exactly as its pane screen offers no card diff.

/** The board surface this derivation needs — a structural slice of `BoardDb`. */
export interface PaneArtifactBoard {
  listOpenSessions(): { paneId: string | null; cardId: string }[];
  getCard(id: string): { repoPath: string | null; branch: string | null; baseRef: string | null } | null;
}

/** A card-backed pane's servable root, plus the base ref its diff is measured from. */
export interface PaneWorktree {
  root: string;
  baseRef: string | null;
}

/**
 * The servable root for a card-backed pane, or null when the pane backs no card or the branch has
 * no worktree on disk (never started, or cleaned up after its work landed). `git` is injectable for
 * the test — the one seam this module needs, since everything else is fs.
 */
export async function worktreeForPane(
  board: PaneArtifactBoard,
  paneId: string,
  git: GitRunner = runGit,
): Promise<PaneWorktree | null> {
  const session = board.listOpenSessions().find((s) => s.paneId === paneId);
  if (session === undefined) return null;
  const card = board.getCard(session.cardId);
  if (card === null || card.repoPath === null || card.branch === null) return null;
  const root = await worktreePathFor(card.repoPath, card.branch, git);
  if (root === null) return null;
  return { root, baseRef: card.baseRef };
}

/**
 * GET /api/pane/:id/artifacts — the session-artifact listing (never polled; fetched when the
 * reading view's artifacts surface opens). `worktree` is derived by the caller through
 * {@link worktreeForPane}; `entries` is the pane's parsed conversation, when one could be read —
 * the "mentioned" half of discovery. An absent worktree answers an empty list, not an error: a pane
 * with no card has no artifacts, and that is an ordinary state.
 */
export async function paneArtifactsResponse(opts: {
  worktree: PaneWorktree | null;
  /** Parsed conversation turns for this pane — the "mentioned" half. Null when none could be read. */
  entries?: TranscriptEntry[] | null;
  git?: GitRunner;
  acceptEncoding: string | null;
}): Promise<Response> {
  if (opts.worktree === null) return gzipJsonResponse({ artifacts: [] }, opts.acceptEncoding);
  const written: string[] = [];
  try {
    const stat = await diffStat(opts.worktree.root, opts.worktree.baseRef, opts.git);
    written.push(...stat.files.map((f) => f.path));
  } catch {
    // git couldn't run — the repo moved under us, or the worktree is mid-life. The mentions below
    // may still serve, and next open will re-derive the root anyway.
  }
  const mentioned = opts.entries === null || opts.entries === undefined
    ? []
    : mentionedArtifactCandidates(opts.entries);
  const artifacts = await listWorktreeArtifacts(opts.worktree.root, [...written, ...mentioned]);
  return gzipJsonResponse({ artifacts }, opts.acceptEncoding);
}

/**
 * GET /api/pane/:id/artifact?p=<absolute path> — the bytes of one artifact.
 *
 * `root` is the caller-derived worktree root for THIS pane (null when the pane has no card) and is
 * the only thing this handler trusts: the path is confined to it via {@link resolveArtifact}, so a
 * path that escapes — traversal, a symlink, a foreign absolute path — is a 404, and a path naming a
 * kind this reader does not serve (`.svg`, `.txt`, `.json`) is a 404 too.
 */
export async function handleArtifactFile(root: string | null, req: Request): Promise<Response> {
  if (root === null) return new Response("not found", { status: 404 });
  const p = new URL(req.url).searchParams.get("p");
  if (p === null) return new Response("missing p", { status: 400 });
  const resolved = await resolveArtifact(root, p);
  if (resolved === null) return new Response("not found", { status: 404 });
  return serveArtifact(resolved.full, resolved.kind, req.headers.get("if-none-match"));
}