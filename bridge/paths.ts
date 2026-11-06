// One spelling for a path, and one way to compare two.
//
// Git for Windows prints `C:/Users/x/repo`; Node and herdr say `C:\Users\x\repo`, and NTFS ignores
// case on top of that. Compared as strings, one repo becomes two and a valid diff path is refused
// (docs/multi-machine/reconnaissance-windows.md §2). So every path git hands back goes through
// `normalizePath`, and every comparison through `pathKey`/`samePath`.
//
// Off win32 all three are the identity: Linux paths come out of git already absolute and clean, and
// leaving them untouched is the guarantee that nothing changes there. `platform` is injectable so
// `bun test` covers the win32 branch on Linux, through `path.win32`.

import { win32 } from "node:path";

/** A path in the platform's own spelling: on win32, absolute with `\` separators. */
export function normalizePath(path: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" && path ? win32.resolve(path) : path;
}

/** The form two paths are compared by — normalized, and case-folded on win32. */
export function pathKey(path: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? normalizePath(path, platform).toLowerCase() : path;
}

/** Whether two paths name the same directory, as the platform's filesystem sees it. */
export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  return pathKey(a, platform) === pathKey(b, platform);
}

/**
 * A repo path a caller sent, as the key the board files it under — or null when it is not absolute.
 * On win32 `C:\x`, `C:/x` and `C:\x\` are one repo, stored in the `\` spelling `/api/repos` hands out
 * (`normalizePath`), so the roadmap, phases and orchestrator memory are found whichever one a caller
 * sends. Off win32: absolute means a leading `/`, and the path is kept byte for byte.
 */
export function repoPathOf(v: unknown, platform: NodeJS.Platform = process.platform): string | null {
  if (typeof v !== "string" || v === "") return null;
  if (platform !== "win32") return v.startsWith("/") ? v : null;
  if (/^[A-Za-z]:[\\/]/.test(v) || /^[\\/]{2}[^\\/]/.test(v)) return normalizePath(v, platform);
  // A single leading `/` was accepted before drive paths were, and is kept as it was sent: resolving
  // it would move it onto the current drive and lose every row already filed under it.
  return /^\/(?!\/)/.test(v) ? v : null;
}
