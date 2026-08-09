import { Glob } from "bun";
import { realpath, stat } from "node:fs/promises";
import { basename, extname, normalize, sep } from "node:path";

import { computeEtag, gzipJsonResponse, notModified } from "./http-cache.ts";

// The image gallery: the pictures an agent generated or read, browsable from the phone.
//
// Agents write their working images into the harness scratchpad —
// `/tmp/claude-<uid>/<project>/<session>/scratchpad/…` — and there is no way to look at them from a
// phone, which is the whole gap this closes. Two views over the same files: every scratchpad at once
// (the /gallery screen) and the ones a single session touched (rendered inline in that session's
// transcript, see `imagePath` in transcript.ts).
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
  if (!isImagePath(p)) return null;
  try {
    const realRoot = await realpath(root);
    const full = await realpath(normalize(p));
    return containedIn(realRoot, full) ? full : null;
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

/**
 * `/api/gallery` (the listing) and `/api/gallery/file?p=<absolute path>` (the bytes). Returns null
 * for anything else so the caller falls through to its other routes.
 *
 * The caller has already run the access guard — this handler adds no gate of its own beyond the
 * containment rule in {@link resolveImage}.
 */
export async function handleGalleryRoute(
  pathname: string,
  req: Request,
  root: string = galleryRoot(),
): Promise<Response | null> {
  if (req.method !== "GET") return null;

  if (pathname === "/api/gallery") {
    return gzipJsonResponse({ images: await listImages(root) }, req.headers.get("accept-encoding"));
  }

  if (pathname === "/api/gallery/file") {
    const p = new URL(req.url).searchParams.get("p");
    if (!p) return new Response("missing p", { status: 400 });
    const full = await resolveImage(p, root);
    if (!full) return new Response("not found", { status: 404 });
    const file = Bun.file(full);
    // A scratchpad file is rewritten in place often enough (a regenerated render keeps its name)
    // that it can't be cached blind, and big enough that re-sending an unchanged one over a phone
    // link is the cost worth avoiding. So: always revalidate, and answer an unchanged one with a 304.
    const etag = computeEtag(`${file.size}-${file.lastModified}`);
    if (notModified(req.headers.get("if-none-match"), etag)) {
      return new Response(null, { status: 304, headers: { etag, "cache-control": "private, no-cache" } });
    }
    return new Response(file, {
      headers: {
        "content-type": IMAGE_TYPES[extname(full).toLowerCase()] ?? "application/octet-stream",
        "cache-control": "private, no-cache",
        etag,
      },
    });
  }

  return null;
}
