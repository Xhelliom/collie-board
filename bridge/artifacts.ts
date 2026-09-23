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

import { realpath, readdir, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, normalize, sep } from "node:path";

import { containedIn, IMAGE_TYPES } from "./gallery.ts";
import { diffStat, runGit, worktreePathFor, type GitRunner } from "./git.ts";
import { computeEtag, gzipJsonResponse, notModified } from "./http-cache.ts";
import { scrubHtml } from "./scrub.ts";
import type { TranscriptEntry } from "./transcript.ts";

// Re-exported so existing importers (and their tests) keep spelling it from here: the scrubber
// lives in scrub.ts so the gallery's scratchpad docs scrub with the identical rule, no drift.
export { scrubHtml };

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
// Lives in scrub.ts, shared with the gallery: both roots serve agent-authored pages under the same
// scrub + `sandbox` CSP, and the rule must not drift between them.

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
 * Three unambiguous signals only: a tool call that surfaced an image path (the transcript already
 * decided it is a picture), a tool summary that IS an absolute path (Read/Write/Edit summarize to
 * exactly that), or a tool summary that is a RELATIVE single-token path with a servable extension —
 * the shape a Write/Read/Edit names when it runs with a worktree-relative path
 * (`{path: "docs/hero-recette/page.html"}` — the transcript holds the path exactly as the call made
 * it, and {@link listWorktreeArtifacts} joins relatives against the root). A bare name with no "/"
 * is a pattern or a phrase, not a file here. Anything ambiguous is left for the containment filter
 * to drop downstream, not guessed at here. Pure + exported for the test.
 */
export function mentionedArtifactCandidates(entries: TranscriptEntry[]): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    for (const part of entry.parts) {
      if (part.kind !== "tool") continue;
      if (part.image !== undefined && !part.image.startsWith("data:")) out.push(part.image);
      const summary = part.summary.trim();
      // A path is absolute and single-token; anything else is a pattern or a phrase, not a file.
      const isAbsolutePath = summary.startsWith("/") && !summary.includes(" ") && !summary.includes("\t");
      // Relative, single-token, servable extension, and path-shaped (contains a "/") — the
      // containment filter is the single gate, exactly as for every other candidate.
      const isRelativeArtifact =
        summary.includes("/") &&
        !summary.startsWith("/") &&
        !summary.includes(" ") &&
        !summary.includes("\t") &&
        artifactKindOf(summary) !== null;
      if (isAbsolutePath || isRelativeArtifact) out.push(summary);
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
    if (isExcludedArtifactPath(rel)) continue; // node_modules, dist, .board, … — never artifacts
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

/** How deep an untracked-directory expansion will walk. Deep enough for `docs/hero-recette/`. */
const MAX_ARTIFACT_DIR_DEPTH = 5;
/** Cap on files collected from one expansion, so a huge untracked tree can't balloon the walk. */
const MAX_ARTIFACT_DIR_FILES = 200;

/**
 * Directory names that never contribute artifacts — dependency checkouts, build outputs, caches,
 * and the board's own scratch dir. Compared per path SEGMENT (case-insensitively), so
 * `docs/hero-recette/` still serves while `node_modules/acme/docs/page.html` never does.
 *
 * WHY. The listing is "files the session wrote ∪ files it mentioned", and neither half knows a
 * dependency tree from a deliverable: an untracked `node_modules/` (a repo without a matching
 * `.gitignore`) expands to hundreds of third-party `.html`/`.md`/`.png`, a `npm run build`
 * drops a `dist/` full of generated pages that are build output rather than session deliverables,
 * and a `Read` that merely OPENED such a file promotes it to an artifact via the "mentioned"
 * half. `.board/` is the same story one level closer: the handoff note is plumbing, and it must
 * not surface as a phone document (diffStat already drops it from the written half; this drops
 * it from the mentioned half and the directory expansion too).
 */
const EXCLUDED_ARTIFACT_DIRS = new Set([
  ".board",
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  "dist",
  "build",
  "out",
  "coverage",
  ".nyc_output",
  ".next",
  ".nuxt",
  ".parcel-cache",
  ".cache",
  "target",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
]);

/** True when a worktree-relative path lives under an excluded directory. Pure + exported. */
export function isExcludedArtifactPath(rel: string): boolean {
  return rel.split("/").some((seg) => EXCLUDED_ARTIFACT_DIRS.has(seg.toLowerCase()));
}

async function walkForArtifacts(
  dir: string,
  depth: number,
  out: string[],
  remaining: { n: number },
): Promise<void> {
  if (depth > MAX_ARTIFACT_DIR_DEPTH || remaining.n <= 0) return;
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (remaining.n <= 0) return;
    if (EXCLUDED_ARTIFACT_DIRS.has(name.toLowerCase())) continue; // deps/build/cache — never artifacts
    const p = join(dir, name);
    let st;
    try {
      st = await stat(p);
    } catch {
      continue; // vanished under us — a live worktree
    }
    if (st.isDirectory()) {
      await walkForArtifacts(p, depth + 1, out, remaining);
    } else if (artifactKindOf(p) !== null) {
      remaining.n -= 1;
      out.push(p);
    }
  }
}

/**
 * Expand untracked-directory entries into their contained servable files.
 *
 * `git status --porcelain` collapses an untracked DIRECTORY to a single `?? docs/hero-recette/`
 * entry (trailing slash): the files inside are invisible to every git command, so a card whose
 * agent produced an unreviewed folder of screenshots would list no artifacts at all. This walks
 * such entries (bounded) and returns the servable files inside; every path still has to pass
 * {@link resolveArtifact}, so the expansion only widens the CANDIDATE set, never what is served.
 * Non-directory candidates pass through unchanged. Exported for the test.
 */
export async function expandDirectoryCandidates(root: string, candidates: string[]): Promise<string[]> {
  const out: string[] = [];
  const remaining = { n: MAX_ARTIFACT_DIR_FILES };
  for (const c of candidates) {
    const abs = isAbsolute(c) ? normalize(c) : normalize(join(root, c));
    let st;
    try {
      st = await stat(abs);
    } catch {
      out.push(c); // missing — resolveArtifact drops it anyway
      continue;
    }
    if (!st.isDirectory()) {
      out.push(abs);
      continue;
    }
    await walkForArtifacts(abs, 0, out, remaining);
  }
  return out;
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
  // `git status` collapses an untracked DIRECTORY to one `?? docs/…/` entry — expand those before
  // containment, or a folder of fresh screenshots lists as nothing at all.
  const candidates = await expandDirectoryCandidates(opts.worktree.root, [...written, ...mentioned]);
  const artifacts = await listWorktreeArtifacts(opts.worktree.root, candidates);
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