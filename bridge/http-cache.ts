// Pure, injectable HTTP cache helpers: ETag + conditional GET + gzip JSON.
//
// Kept separate from server.ts so they can be exercised under `bun test` without
// needing Bun.serve or the Herdr socket — all functions are synchronous or return
// a plain Response, with no I/O.

// Only compress if serialised body is at least this many bytes; below this the
// deflate overhead and header cost outweigh the savings.
const GZIP_MIN_BYTES = 256;

/**
 * Compute a strong ETag for the given response body string.
 * Uses Bun.hash (Wyhash) — fast and deterministic within a process.
 * Returns a quoted ETag value as required by RFC 7232.
 */
export function computeEtag(body: string): string {
  // toString(16) works for both number and bigint, which covers all Bun.hash overloads.
  return `"${Bun.hash(body).toString(16)}"`;
}

/**
 * Return true when the request's If-None-Match header equals the computed ETag,
 * meaning the client already holds the current representation.
 * Returns false for a null header (no previous ETag known to the client).
 */
export function notModified(ifNoneMatch: string | null, etag: string): boolean {
  return ifNoneMatch !== null && ifNoneMatch === etag;
}

/**
 * Build a JSON Response, gzip-compressing the body when the client signals gzip
 * support via Accept-Encoding and the serialised body is large enough to benefit.
 *
 * Behaviour:
 * - Always sets `content-type: application/json` and `cache-control: no-store`.
 * - When compressed: adds `content-encoding: gzip` and `vary: accept-encoding`.
 * - `extraHeaders` are merged in after the standard headers so callers can attach
 *   an ETag or other fields (e.g. `{ etag: '"abc"' }`).
 */
export function gzipJsonResponse(
  data: unknown,
  acceptEncoding: string | null,
  extraHeaders: Record<string, string> = {},
): Response {
  return gzipBodyResponse(JSON.stringify(data), acceptEncoding, extraHeaders);
}

/** {@link gzipJsonResponse} for a body already serialised — `gz` is reused when given. */
function gzipBodyResponse(
  body: string,
  acceptEncoding: string | null,
  extraHeaders: Record<string, string>,
  entry?: Serialized,
): Response {
  const useGzip =
    acceptEncoding !== null &&
    acceptEncoding.includes("gzip") &&
    body.length >= GZIP_MIN_BYTES;

  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  };

  if (useGzip) {
    const compressed = entry ? (entry.gz ??= Bun.gzipSync(body)) : Bun.gzipSync(body);
    headers["content-encoding"] = "gzip";
    headers["vary"] = "accept-encoding";
    headers["content-length"] = String(compressed.byteLength);
    return new Response(compressed, { headers });
  }

  // content-length is what route-cost.ts reads to count bytes without buffering the body.
  headers["content-length"] = String(Buffer.byteLength(body));
  return new Response(body, { headers });
}

/**
 * A polled GET's JSON: a 304 with no body when the client's `If-None-Match` already names this
 * body, else the gzip-aware JSON carrying its ETag. The tag is derived from the body, so a mutation
 * needs no invalidation — the next poll simply gets a different tag.
 */
export function conditionalJson(data: unknown, req: Request): Response {
  // One stringify per data object: a memoised one (see `memoOn`) comes back with its body, tag and gzip.
  let entry = typeof data === "object" && data !== null ? serialized.get(data) : undefined;
  if (!entry) {
    const body = JSON.stringify(data);
    entry = { body, etag: computeEtag(body) };
    if (typeof data === "object" && data !== null) serialized.set(data, entry);
  }
  const { etag } = entry;
  if (notModified(req.headers.get("if-none-match"), etag)) {
    // RFC 7232 §4.1: a 304 MUST echo the ETag; its body MUST be empty.
    return new Response(null, { status: 304, headers: { etag, "cache-control": "no-store" } });
  }
  return gzipBodyResponse(entry.body, req.headers.get("accept-encoding"), { etag }, entry);
}

interface Serialized {
  body: string;
  etag: string;
  gz?: ReturnType<typeof Bun.gzipSync>;
}
const serialized = new WeakMap<object, Serialized>();

const memos = new WeakMap<object, Map<string, { deps: readonly unknown[]; data: unknown }>>();

/**
 * The last `build()` of `owner`'s `slot`, handed back as long as every dep is `===` the last call's.
 * The deps must be cheap and change on every write (`BoardDb.revision()`, the engine's pane arrays):
 * an unchanged poll then costs neither the rebuild nor — through `conditionalJson` — the stringify.
 * ponytail: one entry per slot, the newest; a slot per query variant keeps that bounded.
 */
export function memoOn<T>(owner: object, slot: string, deps: readonly unknown[], build: () => T): T {
  let slots = memos.get(owner);
  if (!slots) memos.set(owner, (slots = new Map()));
  const last = slots.get(slot);
  if (last && last.deps.length === deps.length && last.deps.every((d, i) => d === deps[i])) return last.data as T;
  const data = build();
  slots.set(slot, { deps, data });
  return data;
}
