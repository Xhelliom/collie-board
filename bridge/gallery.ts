import { Glob } from "bun";
import { realpath, stat } from "node:fs/promises";
import { basename, extname, normalize, sep } from "node:path";

import { computeEtag, gzipJsonResponse, notModified } from "./http-cache.ts";
import { scrubHtml } from "./scrub.ts";

// The image gallery — and now the scratchpad documents: the pictures AND the pages/reports an
// agent generated, browsable from the phone.
//
// Agents write their working files into the harness scratchpad —
// `/tmp/claude-<uid>/<project>/<session>/scratchpad/…` — and there is no way to look at them from a
// phone, which is the whole gap this closes. Images get the grid they always had; Markdown/HTML
// documents get the same rendering contract as the session-artifact reader (bridge/artifacts.ts):
// Markdown as text for the client's parser, HTML scrubbed server-side (the shared scrub.ts rule)
// and served under a `sandbox` CSP for the client's sandboxed iframe.
//
// SECURITY. Same posture as before, widened to two more extensions, not loosened: exactly one
// root, fixed at `/tmp/claude-<uid>`, and a requested path is served only if its FULLY RESOLVED
// form still lives under that root's fully resolved form. SVG stays excluded — it is a script host
// on a top-level navigation to this origin, and the app lives on this origin.
//
// SECURITY. This route hands file bytes to the tailnet, so the rule is deliberately narrow and has
// no client-supplied component: exactly one root, fixed at `/tmp/claude-<uid>`, and a requested path
// is served only if its FULLY RESOLVED form still lives under that root's fully resolved form. The
// resolution is what matters — a symlink planted in a scratchpad is the obvious way to turn an
// "image viewer" into "read any file the bridge user can read", and comparing unresolved strings
// would wave it straight through. Anything outside that root simply isn't servable; there is no
// second rule, no escape hatch, and no way to widen it from a request.

/** Extensions served, and the content-type each gets. Lowercased keys — callers normalise. */
export const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  // ponytail: no SVG. It's an image to <img> but a script host to a top-level navigation, and this
  // origin also serves the app. Add it only behind a sandboxing content-disposition.
};

/**
 * Files walked before the scan stops, across all scratchpads. A scratchpad is normally a handful of
 * files; one that isn't (an agent that checked out a repo into it) would otherwise make a phone
 * request walk a whole tree. The cap is a backstop, not a budget — hitting it means the listing is
 * short, which is the failure worth having.
 */
const MAX_SCAN = 20_000;

/** True when the path's extension is one we serve. Pure. */
export function isImagePath(p: string): boolean {
  return IMAGE_TYPES[extname(p).toLowerCase()] !== undefined;
}

/** What a scratchpad document is, and therefore how the client renders it. */
export type GalleryDocKind = "markdown" | "html";

/**
 * Document extensions served from the scratchpad. Lowercased keys — callers normalise. The same
 * two families the artifact reader serves (minus images, which are this module's own list), so a
 * `.txt`, a `.json`, a `.pdf` is not a gallery document either — every other kind just widens the
 * read surface.
 */
const GALLERY_DOC_TYPES: Record<string, GalleryDocKind> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".mdown": "markdown",
  ".html": "html",
  ".htm": "html",
};

/** The document kind an extension would get, or null when it is not a servable document. Pure. */
export function galleryDocKindOf(path: string): GalleryDocKind | null {
  return GALLERY_DOC_TYPES[extname(path).toLowerCase()] ?? null;
}

/** What a servable scratchpad file is — an image for the grid, a document for the reader. */
export type GalleryFileKind = "image" | GalleryDocKind;

/**
 * The one servable root: the harness scratchpad tree for the uid the bridge runs as. Not
 * configurable, deliberately — see the security note above.
 */
export function galleryRoot(): string {
  return `/tmp/claude-${process.getuid?.() ?? 0}`;
}

/**
 * True when `full` is `root` itself or sits beneath it. Both must already be resolved. The
 * `root + sep` form rejects a sibling that merely shares the prefix (`/tmp/claude-10` vs
 * `/tmp/claude-1`), which a bare startsWith would accept. Pure + exported for the test.
 */
export function containedIn(root: string, full: string): boolean {
  return full === root || full.startsWith(root + sep);
}

/**
 * Resolve a requested absolute path to the file to serve, or null if it must not be served.
 *
 * Both sides go through realpath first, so every symlink — in the root, in the path, or as the file
 * itself — is followed BEFORE the containment test. `/tmp` is itself a symlink on some systems,
 * which is why the root can't be compared as written either.
 */
export async function resolveImage(p: string, root: string = galleryRoot()): Promise<string | null> {
  const resolved = await resolveGalleryFile(p, root);
  return resolved !== null && resolved.kind === "image" ? resolved.full : null;
}

/**
 * Resolve a requested absolute path to the servable scratchpad file, or null when it must not be
 * served. Same containment rule as {@link resolveImage}, widened to the document kinds: the
 * generalisation the file endpoint serves through, while `resolveImage` stays the image-only
 * spelling the transcript path uses.
 */
export async function resolveGalleryFile(
  p: string,
  root: string = galleryRoot(),
): Promise<{ full: string; kind: GalleryFileKind } | null> {
  const kind: GalleryFileKind | null = isImagePath(p)
    ? "image"
    : (galleryDocKindOf(p) ?? null);
  if (kind === null) return null;
  try {
    const realRoot = await realpath(root);
    const full = await realpath(normalize(p));
    return containedIn(realRoot, full) ? { full, kind } : null;
  } catch {
    return null; // missing file, missing root, or a dangling symlink — all "not servable"
  }
}

/** One image in the gallery listing. `path` is what the client passes back to fetch the bytes. */
export interface GalleryImage {
  path: string;
  name: string;
  /** The harness project slug, shortened for display (see {@link shortProject}). */
  project: string;
  /** The session uuid that owns the scratchpad — the grouping key on the gallery screen. */
  session: string;
  size: number;
  mtime: number;
}

/**
 * Display form of a harness project slug. The slug is `cwd` with every non-alphanumeric byte turned
 * into `-`, so it can't be reversed (`collie-board` and `collie/board` mangle identically). All this
 * does is drop the leading home-directory run, which is the same on every entry and eats the width a
 * phone needs for the part that differs. Pure.
 */
export function shortProject(slug: string, home: string | undefined = process.env.HOME): string {
  const mangledHome = home ? home.replace(/[^A-Za-z0-9]/g, "-") : "";
  const trimmed =
    mangledHome && slug.startsWith(mangledHome) ? slug.slice(mangledHome.length) : slug;
  return trimmed.replace(/^-+/, "") || slug;
}

/**
 * Every image under every scratchpad in the root, newest first.
 *
 * Best-effort: a missing root (nothing has run yet) is an empty list, not an error, and a file that
 * vanishes between the walk and its stat is skipped — a scratchpad is live, agent-written state.
 */
export async function listImages(root: string = galleryRoot()): Promise<GalleryImage[]> {
  const images: GalleryImage[] = [];
  // `*/*/scratchpad/**` is the harness layout: <project>/<session>/scratchpad/. Globbing all files
  // and filtering by extension here keeps IMAGE_TYPES the single source of truth (and picks up
  // `.PNG`, which a brace pattern would miss).
  const glob = new Glob("*/*/scratchpad/**");
  let scanned = 0;
  try {
    for await (const rel of glob.scan({ cwd: root, onlyFiles: true, followSymlinks: false })) {
      if (++scanned > MAX_SCAN) break;
      if (!isImagePath(rel)) continue;
      const [project = "", session = ""] = rel.split(sep);
      const path = `${root}${sep}${rel}`;
      try {
        const s = await stat(path);
        images.push({
          path,
          name: basename(rel),
          project: shortProject(project),
          session,
          size: s.size,
          mtime: s.mtimeMs,
        });
      } catch {
        /* vanished between scan and stat — skip */
      }
    }
  } catch {
    return []; // root doesn't exist yet
  }
  return images.sort((a, b) => b.mtime - a.mtime);
}

/** One Markdown/HTML document under a harness scratchpad. Mirrors `GalleryImage`, plus the kind. */
export interface GalleryDoc {
  path: string;
  name: string;
  /** The harness project slug, shortened for display (see {@link shortProject}). */
  project: string;
  /** The session uuid that owns the scratchpad — the grouping key on the gallery screen. */
  session: string;
  kind: GalleryDocKind;
  size: number;
  mtime: number;
}

/**
 * Every Markdown/HTML document under every scratchpad in the root, newest first.
 *
 * A second glob over the same layout rather than a combined walk: scratchpads are a handful of
 * files, and one scan per kind keeps each listing's filter (and test) independent. Same
 * best-effort contract as {@link listImages}: a missing root is an empty list, a file that
 * vanishes mid-walk is skipped.
 */
export async function listGalleryDocs(root: string = galleryRoot()): Promise<GalleryDoc[]> {
  const docs: GalleryDoc[] = [];
  const glob = new Glob("*/*/scratchpad/**");
  let scanned = 0;
  try {
    for await (const rel of glob.scan({ cwd: root, onlyFiles: true, followSymlinks: false })) {
      if (++scanned > MAX_SCAN) break;
      const kind = galleryDocKindOf(rel);
      if (kind === null) continue;
      const [project = "", session = ""] = rel.split(sep);
      const path = `${root}${sep}${rel}`;
      try {
        const s = await stat(path);
        docs.push({
          path,
          name: basename(rel),
          project: shortProject(project),
          session,
          kind,
          size: s.size,
          mtime: s.mtimeMs,
        });
      } catch {
        /* vanished between scan and stat — skip */
      }
    }
  } catch {
    return []; // root doesn't exist yet
  }
  return docs.sort((a, b) => b.mtime - a.mtime);
}

/**
 * `/api/gallery` (the listing) and `/api/gallery/file?p=<absolute path>` (the bytes). Returns null
 * for anything else so the caller falls through to its other routes.
 *
 * The caller has already run the access guard — this handler adds no gate of its own beyond the
 * containment rule in {@link resolveGalleryFile}.
 */
export async function handleGalleryRoute(
  pathname: string,
  req: Request,
  root: string = galleryRoot(),
): Promise<Response | null> {
  if (req.method !== "GET") return null;

  if (pathname === "/api/gallery") {
    const [images, docs] = await Promise.all([listImages(root), listGalleryDocs(root)]);
    return gzipJsonResponse({ images, docs }, req.headers.get("accept-encoding"));
  }

  if (pathname === "/api/gallery/file") {
    const p = new URL(req.url).searchParams.get("p");
    if (!p) return new Response("missing p", { status: 400 });
    const resolved = await resolveGalleryFile(p, root);
    if (!resolved) return new Response("not found", { status: 404 });
    return serveGalleryFile(resolved.full, resolved.kind, req.headers.get("if-none-match"));
  }

  return null;
}

/**
 * Most bytes a scratchpad document may hand to the phone. Images ride on `Bun.file` directly. A
 * report beyond this is not a phone document — better a clipped page than a multi-megabyte
 * download. Same value as the artifact reader's cap; the two are independent on purpose (one per
 * root), kept equal by convention.
 */
const MAX_TEXT_GALLERY_BYTES = 2 * 1024 * 1024;

const GALLERY_DOC_HEADERS: Record<
  GalleryDocKind,
  { "content-type": string; "content-security-policy"?: string }
> = {
  markdown: { "content-type": "text/markdown; charset=utf-8" },
  // Same lock as the artifact reader: `sandbox` makes even a top-level navigation to this URL
  // inert, and the client's sandboxed iframe is the second one. The app's own CSP
  // (`frame-ancestors 'none'`) is deliberately NOT applied here: this document is MEANT to be
  // framed by the gallery's reading view.
  html: { "content-type": "text/html; charset=utf-8", "content-security-policy": "sandbox" },
};

/**
 * Serve one resolved scratchpad file: images as bytes, Markdown as text, HTML scrubbed under a
 * sandbox CSP. Same revalidation posture as before — a render the agent keeps overwriting must not
 * cache blind, and an unchanged one over a phone link is exactly the cost an ETag saves.
 */
async function serveGalleryFile(
  full: string,
  kind: GalleryFileKind,
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
  const text = file.size > MAX_TEXT_GALLERY_BYTES
    ? await file.slice(0, MAX_TEXT_GALLERY_BYTES).text()
    : await file.text();
  const base = GALLERY_DOC_HEADERS[kind];
  const body = kind === "html" ? scrubHtml(text) : text;
  return new Response(body, {
    headers: { ...base, "cache-control": "private, no-cache", etag },
  });
}
