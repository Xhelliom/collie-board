// Serve the build's precompressed sibling (`x.js.gz`, written by web/vite-gzip.ts) instead of the raw
// file when the client accepts gzip. Nothing is compressed per request: no `.gz` beside the file — an
// image, an old build — and the raw file goes out as before.

import type { BunFile } from "bun";

/** Pure: does this Accept-Encoding take gzip? Same reading as http-cache.ts's gzipJsonResponse. */
export function acceptsGzip(acceptEncoding: string | null): boolean {
  return acceptEncoding !== null && acceptEncoding.includes("gzip");
}

/**
 * The file to send for `full`, plus the headers the choice adds. `vary` goes on BOTH variants
 * whenever a `.gz` exists, so a cache never hands the gzip body to a client that didn't ask for it.
 */
export async function precompressed(
  full: string,
  file: BunFile,
  acceptEncoding: string | null,
): Promise<{ file: BunFile; headers: Record<string, string> }> {
  const gz = Bun.file(`${full}.gz`);
  if (!(await gz.exists())) return { file, headers: {} };
  if (!acceptsGzip(acceptEncoding)) return { file, headers: { vary: "accept-encoding" } };
  return { file: gz, headers: { "content-encoding": "gzip", vary: "accept-encoding" } };
}
