// The files the agent NAMES in its prose — `src/a.ts:42` in the reading view — opened read-only from
// the phone. Idea from upstream Collie 1.17/1.18 (bridge/files-view.ts there), rewritten small: no
// explorer, no listing, just "do these paths exist" (one grouped call) and "give me this one file".
//
// SECURITY. The ROOT is never the client's: it is the pane's cwd as the live snapshot reports it,
// and its real path must sit strictly below home — a shell pane opened in `~` or `/` serves nothing.
// The client names a path RELATIVE to that root, refused on its shape before any disk call
// ({@link parseRelPath}); no segment may start with a dot, so `.git`, `.env`, `.ssh` are never read.
// Then realpath on both sides and the containment test, and the same dot rule on the REAL relative
// path, so a symlink planted in the tree can neither lead out nor into a dotfile. Text is masked by
// bridge/redact.ts like every other pane read. Every refusal is the same 404.

import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, relative, sep } from "node:path";

import { containedIn, IMAGE_TYPES } from "./gallery.ts";
import { redactText } from "./redact.ts";

/** The longest relative path accepted, in UTF-8 bytes. */
const MAX_REL_PATH_BYTES = 4096;
/** Paths checked per grouped call; the rest are ignored (a turn never names more). */
export const MAX_EXISTS_PATHS = 200;
/** Most bytes of a text file handed to the phone. */
const MAX_TEXT_BYTES = 1024 * 1024;

/**
 * A client path accepted as relative-to-root, or null. Pure. Refused: not a string, empty, too long,
 * absolute, NUL, backslash, colon (drive letters, streams), an empty / `.` / `..` / dot-led segment.
 */
export function parseRelPath(p: unknown): string | null {
  if (typeof p !== "string" || p === "" || p.startsWith("/")) return null;
  if (new TextEncoder().encode(p).length > MAX_REL_PATH_BYTES) return null;
  if (/[\0\\:]/.test(p)) return null;
  return p.split("/").every((seg) => seg !== "" && !seg.startsWith(".")) ? p : null;
}

/** The pane folder's real path, or null when it must serve nothing (missing, home itself, outside home). */
export async function paneRoot(cwd: string | undefined, home: string = homedir()): Promise<string | null> {
  if (!cwd) return null;
  try {
    const [root, realHome] = await Promise.all([realpath(cwd), realpath(home)]);
    return root.startsWith(realHome + sep) ? root : null;
  } catch {
    return null;
  }
}

/** The real path of an existing regular file `rel` under `root` (already real), or null. */
export async function resolveInRoot(root: string, rel: unknown): Promise<string | null> {
  const ok = parseRelPath(rel);
  if (ok === null) return null;
  try {
    const full = await realpath(join(root, ok));
    if (!containedIn(root, full) || full === root) return null;
    // A symlink inside the tree may point at a dotfile inside it: the real path gets the same rule.
    if (parseRelPath(relative(root, full).split(sep).join("/")) === null) return null;
    return (await stat(full)).isFile() ? full : null;
  } catch {
    return null;
  }
}

/** The subset of `paths` that exist as files under `root` — the one grouped call. */
export async function existingPaths(root: string, paths: unknown): Promise<string[]> {
  if (!Array.isArray(paths)) return [];
  const wanted = [...new Set(paths.slice(0, MAX_EXISTS_PATHS))];
  const hits = await Promise.all(wanted.map((p) => resolveInRoot(root, p)));
  return wanted.filter((_, i) => hits[i] !== null) as string[];
}

const notFound = () => new Response("not found", { status: 404 });

/** One file's bytes: an image verbatim, anything else as masked UTF-8 text; binary is refused. */
async function serveFile(full: string): Promise<Response> {
  const file = Bun.file(full);
  const imageType = IMAGE_TYPES[extname(full).toLowerCase()];
  if (imageType) return new Response(file, { headers: { "content-type": imageType, "cache-control": "private, no-cache" } });
  const bytes = new Uint8Array(await file.slice(0, MAX_TEXT_BYTES).arrayBuffer());
  if (bytes.subarray(0, 8192).includes(0)) return notFound(); // binary: nothing a phone can read
  return new Response(redactText(new TextDecoder().decode(bytes)), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-cache" },
  });
}

const FILES_EXISTS_ROUTE = /^\/api\/pane\/([^/]+)\/files\/exists$/;
const FILE_ROUTE = /^\/api\/pane\/([^/]+)\/file$/;

/**
 * POST /api/pane/:id/files/exists {paths} → {existing}, GET /api/pane/:id/file?path=rel. Null when
 * the path is neither. `cwdOf` reads the pane's cwd off the live snapshot (undefined when the pane
 * is unknown or the snapshot is disconnected) — the root is derived here, never taken from the request.
 */
export async function handleFilesRoute(
  pathname: string,
  req: Request,
  cwdOf: (paneId: string) => string | undefined,
  home: string = homedir(),
): Promise<Response | null> {
  const existsMatch = pathname.match(FILES_EXISTS_ROUTE);
  const fileMatch = pathname.match(FILE_ROUTE);
  if (!existsMatch && !fileMatch) return null;
  const root = await paneRoot(cwdOf(decodeURIComponent((existsMatch ?? fileMatch)![1]!)), home);
  if (existsMatch) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const body = (await req.json().catch(() => null)) as { paths?: unknown } | null;
    return Response.json({ existing: root === null ? [] : await existingPaths(root, body?.paths) });
  }
  if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
  if (root === null) return notFound();
  const full = await resolveInRoot(root, new URL(req.url).searchParams.get("path"));
  return full === null ? notFound() : serveFile(full);
}
