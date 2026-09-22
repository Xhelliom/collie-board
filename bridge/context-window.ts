// Per-model context windows — the gauge's denominator.
//
// `COLLIE_BOARD_CTX_WINDOW` is one number for the whole deployment, but the window is a property
// of the MODEL: Opus 4.6 runs 1M tokens where Sonnet 4.5 runs 200k, and a herd that mixes either
// (two cards, or one card relaunched under another model) grades both against the same ruler.
// The transcript states the usage but never the window, so this file is the other half:
//
//   model slug (transcript / session db) → static table → models.dev → env default
//
// The static table covers every Claude model Anthropic documents (verified 2026-09-22 against
// platform.claude.com/docs/en/build-with-claude/context-windows: 1M for Opus 5, Sonnet 5,
// Opus 4.8/4.7/4.6, Sonnet 4.6, Fable/M Mythos 5.x; 200k for Sonnet 4.5, Haiku 4.5, Opus ≤ 4.5 and
// everything older). models.dev is the fallback for slugs nobody curated — the OpenCode model
// universe is unbounded (75+ providers), so no static table can hold it. It stays a FALLBACK:
// the registry dump is ~5 MB, so it is fetched at most once per TTL and only resolved entries
// are cached, never the whole dump. Anything failing degrades to the env default — the
// configured default is the operator's explicit claim, not a guess.

import { readFileSync, writeFileSync } from "node:fs";

/** Where the registry fallback is read from (a static public JSON — no session data is sent). */
export const MODELS_DEV_URL = "https://models.dev/api.json";

/** How long one registry fetch serves fallback lookups before it is refreshed. */
export const MODELS_DEV_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** One curated entry: slugs matching `match` run `window` tokens. Order matters — first hit wins. */
interface ModelWindow {
  match: RegExp;
  window: number;
}

const M_1M = 1_000_000;
const K_200 = 200_000;

// Substring patterns, so dated slugs (`claude-opus-4-6-20260205`) and provider-prefixed ones
// (`anthropic/claude-opus-4-6`) match without enumerating every alias. Specific (1M) before
// general (4.x defaults to 200k): `sonnet-4.6` must win over the `sonnet-4` 200k rule below.
const MODEL_WINDOWS: ModelWindow[] = [
  // 1M, GA with no header (platform docs, 2026-03-13): Opus 4.6, Sonnet 4.6 and everything newer.
  // Slugs use dashes (`opus-4-6`), docs use dots (`4.6`) — both separators match.
  { match: /opus-5|sonnet-5|opus-4[-.][6-9]|sonnet-4[-.][6-9]|opus-[6-9]|sonnet-[6-9]/, window: M_1M },
  { match: /fable|mythos/, window: M_1M },
  // 200k: the 4.5 generation and everything that never left 200k.
  { match: /sonnet-4[-.]5|haiku-4[-.]5|opus-4[-.]5/, window: K_200 },
  { match: /sonnet-4|sonnet-[1-3]|opus-[1-4]|haiku/, window: K_200 },
  { match: /claude-(3|2|1|instant)/, window: K_200 },
];

/**
 * A model's context window from the static table, or null when no entry claims the slug.
 * Pure — the unit tests pin every generation boundary here, not on the network.
 */
export function windowForModel(slug: string | null | undefined): number | null {
  if (!slug || typeof slug !== "string") return null;
  const s = slug.toLowerCase().trim();
  if (!s) return null;
  for (const { match, window } of MODEL_WINDOWS) {
    if (match.test(s)) return window;
  }
  return null;
}

/** Resolved-entries cache on disk: `{ version, savedAt, entries: { slug: window } }`. */
interface WindowCacheFile {
  version: 1;
  savedAt: number;
  entries: Record<string, number>;
}

function readCache(path: string | null | undefined, now: number): Record<string, number> {
  if (!path) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as WindowCacheFile;
    if (parsed?.version !== 1 || !parsed.entries || typeof parsed.entries !== "object") return {};
    if (!Number.isFinite(parsed.savedAt) || now - parsed.savedAt > MODELS_DEV_TTL_MS) return {};
    return parsed.entries;
  } catch {
    return {};
  }
}

function writeCache(
  path: string | null | undefined,
  entries: Record<string, number>,
  now: number,
): void {
  if (!path) return;
  try {
    writeFileSync(path, JSON.stringify({ version: 1, savedAt: now, entries } satisfies WindowCacheFile));
  } catch {
    // A cache that can't be written is a cache miss next time, not an error.
  }
}

/** Minimal shape of the models.dev registry this resolver reads — `limit.context` per model. */
export interface ModelsDevRegistry {
  [provider: string]:
    | { models?: Record<string, { limit?: Record<string, unknown> }> }
    | undefined;
}

function validWindow(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Find a model's `limit.context` in the registry. With a provider id it is a direct lookup;
 * without one every provider's models are scanned (a transcript slug carries no provider).
 * Pure — pinned by tests against a canned registry.
 */
export function lookupRegistry(
  registry: ModelsDevRegistry,
  slug: string,
  providerId?: string | null,
): number | null {
  const s = slug.toLowerCase().trim();
  if (!s) return null;
  const providers = providerId ? [registry[providerId]] : Object.values(registry);
  for (const provider of providers) {
    const models = provider?.models;
    if (!models || typeof models !== "object") continue;
    for (const [id, meta] of Object.entries(models)) {
      if (id.toLowerCase() === s) {
        const found = validWindow(meta?.limit?.context);
        if (found !== null) return found;
      }
    }
    // Bare slugs (`claude-opus-5`) also match a `provider/id` key ending in the slug.
    if (!providerId) {
      for (const [id, meta] of Object.entries(models)) {
        if (!id.toLowerCase().endsWith(`/${s}`)) continue;
        const found = validWindow(meta?.limit?.context);
        if (found !== null) return found;
      }
    }
  }
  return null;
}

export interface WindowResolverOpts {
  /** The operator's claim — returned whenever nothing else resolves. */
  defaultWindow: number;
  /** File the resolved entries persist in. Omitted = memory only (tests, mostly). */
  cachePath?: string | null;
  /**
   * Fetch the registry (defaults to `fetch(MODELS_DEV_URL)`). Inject a stub in tests; pass an
   * always-throwing one to disable the network (`COLLIE_BOARD_MODELS_DEV=off`).
   */
  fetchRegistry?: () => Promise<ModelsDevRegistry>;
  now?: () => number;
}

export interface WindowResolver {
  resolve: (slug: string | null | undefined, providerId?: string | null) => Promise<number>;
}

/**
 * Resolve a model's context window: static table → file-cached entries → registry → default.
 * The registry is fetched at most once per TTL per process (single-flight) — a gauge fallback
 * must never cost a 5 MB download per pane per refresh. Never throws: the worst answer is the
 * operator's default.
 */
export function createWindowResolver(opts: WindowResolverOpts): WindowResolver {
  const now = opts.now ?? Date.now;
  const fetchRegistry =
    opts.fetchRegistry ??
    (async () => {
      const res = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`models.dev: ${res.status}`);
      return (await res.json()) as ModelsDevRegistry;
    });
  let memory: Record<string, number> = readCache(opts.cachePath, now());
  let inFlight: Promise<ModelsDevRegistry | null> | null = null;

  function flight(): Promise<ModelsDevRegistry | null> {
    if (!inFlight) {
      inFlight = fetchRegistry().catch(() => null);
      void inFlight.then(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  return {
    async resolve(slug, providerId = null) {
      const key = (slug ?? "").toLowerCase().trim();
      const fromTable = windowForModel(slug);
      if (fromTable !== null) return fromTable;
      if (key) {
        // Another process may have resolved it since boot — re-read before paying for a fetch.
        memory = { ...memory, ...readCache(opts.cachePath, now()) };
        const cached = memory[key];
        if (typeof cached === "number" && cached > 0) return cached;
        const registry = await flight();
        if (registry) {
          const found = lookupRegistry(registry, key, providerId);
          if (found !== null) {
            memory = { ...memory, [key]: found };
            writeCache(opts.cachePath, memory, now());
            return found;
          }
        }
      }
      return opts.defaultWindow;
    },
  };
}
