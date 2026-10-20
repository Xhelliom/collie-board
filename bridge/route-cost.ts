// What each route costs the bridge, since it started: calls, cumulated and max handler time, bytes
// sent, 304s. Plus the StateEngine's poll under the same counter, so the background loop and the
// HTTP surface read on one scale. No timer, nothing persisted — performance.now() around the work,
// and one Map entry per normalised route. Read back on `GET /api/diag/routes`.

export interface RouteStat {
  calls: number;
  totalMs: number;
  maxMs: number;
  bytes: number;
  notModified: number;
}

// ponytail: a hard cap on distinct keys — the path is client-controlled and metered before the gate,
// so a junk path must not grow the map for ever. Past it, everything lands in one bucket.
const MAX_KEYS = 200;
const OVERFLOW = "(other)";

const stats = new Map<string, RouteStat>();
const startedAt = Date.now();

/**
 * `GET /api/pane/w1%3Ap3/history` → `GET /api/pane/:id/history`. A segment carrying a digit, `%` or
 * `:` is an id (pane, tab, card, log entry); a route's own words never do. Everything outside `/api`
 * is the PWA's static files, one bucket.
 */
export function routeKey(method: string, pathname: string): string {
  if (pathname !== "/api" && !pathname.startsWith("/api/")) return `${method} (static)`;
  return `${method} ${pathname.replace(/\/[^/]*[0-9%:][^/]*/g, "/:id")}`;
}

export function record(key: string, ms: number, bytes = 0, status = 200): void {
  let s = stats.get(key);
  if (!s) {
    if (stats.size >= MAX_KEYS && key !== OVERFLOW) return record(OVERFLOW, ms, bytes, status);
    s = { calls: 0, totalMs: 0, maxMs: 0, bytes: 0, notModified: 0 };
    stats.set(key, s);
  }
  s.calls++;
  s.totalMs += ms;
  if (ms > s.maxMs) s.maxMs = ms;
  s.bytes += bytes;
  if (status === 304) s.notModified++;
}

/** Time `work` under `key` — the engine's poll and its session-name sniffing use this. */
export async function timed<T>(key: string, work: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await work();
  } finally {
    record(key, performance.now() - t0);
  }
}

/**
 * The fetch handler, metered. The body is never read: bytes come from `content-length` when the
 * response carries one (`gzipJsonResponse` sets it), else they read 0 — a static file, a stream.
 * The Response goes back untouched.
 */
export async function metered(req: Request, handle: (req: Request) => Promise<Response>): Promise<Response> {
  const t0 = performance.now();
  const key = routeKey(req.method, new URL(req.url).pathname);
  const res = await handle(req);
  record(key, performance.now() - t0, Number(res.headers.get("content-length")) || 0, res.status);
  return res;
}

/** Busiest first (cumulated time), rounded for reading. */
export function routeCostSnapshot() {
  const round = (n: number) => Math.round(n * 100) / 100;
  const routes = [...stats.entries()]
    .map(([route, s]) => ({
      route,
      calls: s.calls,
      totalMs: round(s.totalMs),
      avgMs: round(s.totalMs / s.calls),
      maxMs: round(s.maxMs),
      bytes: s.bytes,
      notModified: s.notModified,
    }))
    .sort((a, b) => b.totalMs - a.totalMs);
  return { since: startedAt, uptimeMs: Date.now() - startedAt, routes };
}

/** Tests only. */
export function resetRouteCost(): void {
  stats.clear();
}
