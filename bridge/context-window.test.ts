// Per-model context windows: the static table pins every generation boundary, and the resolver
// chain (table → cache → registry → default) never touches the network in tests.
import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createWindowResolver,
  lookupRegistry,
  windowForModel,
  type ModelsDevRegistry,
} from "./context-window.ts";

describe("windowForModel", () => {
  it.each([
    ["claude-opus-5", 1_000_000],
    ["claude-opus-4-6", 1_000_000],
    ["claude-sonnet-4-6", 1_000_000],
    ["claude-opus-4-6-20260205", 1_000_000], // dated slug
    ["anthropic/claude-sonnet-4-6", 1_000_000], // provider-prefixed
    ["Claude-Opus-5", 1_000_000], // case-insensitive
    ["claude-sonnet-4-5", 200_000],
    ["claude-haiku-4-5", 200_000],
    ["claude-opus-4-5", 200_000], // 4.5 never left 200k
    ["claude-sonnet-4", 200_000],
    ["claude-opus-4-1", 200_000],
    ["claude-3-5-sonnet-20241022", 200_000],
  ])("%s → %s", (slug, window) => {
    expect(windowForModel(slug)).toBe(window);
  });

  it.each([["muse-spark-1.3-contributor-free"], ["gpt-5"], [""], [null], [undefined]])(
    "leaves non-Claude slugs unclaimed: %s",
    (slug) => {
      expect(windowForModel(slug as string | null)).toBeNull();
    },
  );
});

const REGISTRY: ModelsDevRegistry = {
  opencode: {
    models: {
      "muse-spark-1.3-contributor-free": { limit: { context: 1_048_576, output: 131072 } },
    },
  },
  anthropic: {
    models: {
      "claude-opus-4-6": { limit: { context: 1_000_000, output: 128000 } },
      "no-limit": {},
    },
  },
};

describe("lookupRegistry", () => {
  it("finds a model by provider + id", () => {
    expect(lookupRegistry(REGISTRY, "muse-spark-1.3-contributor-free", "opencode")).toBe(1_048_576);
  });

  it("scans every provider for a bare slug", () => {
    expect(lookupRegistry(REGISTRY, "claude-opus-4-6")).toBe(1_000_000);
  });

  it("returns null for unknown slugs and malformed limits", () => {
    expect(lookupRegistry(REGISTRY, "nope", "opencode")).toBeNull();
    expect(lookupRegistry(REGISTRY, "no-limit", "anthropic")).toBeNull();
    expect(lookupRegistry(REGISTRY, "", "opencode")).toBeNull();
  });
});

describe("createWindowResolver", () => {
  const table = (slug: string | null | undefined) =>
    createWindowResolver({
      defaultWindow: 200_000,
      fetchRegistry: async () => {
        throw new Error("no network in tests");
      },
    }).resolve(slug);

  it("answers from the static table without fetching", async () => {
    expect(await table("claude-opus-5")).toBe(1_000_000);
    expect(await table("claude-sonnet-4-5")).toBe(200_000);
  });

  it("falls back to the default for unknown slugs when the network fails", async () => {
    expect(await table("muse-spark-1.3-contributor-free")).toBe(200_000);
    expect(await table(null)).toBe(200_000);
  });

  it("resolves unknown slugs from the registry and persists them to the cache file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ctxwin-"));
    const cachePath = join(dir, "cache.json");
    let fetches = 0;
    const resolve = createWindowResolver({
      defaultWindow: 200_000,
      cachePath,
      fetchRegistry: async () => {
        fetches += 1;
        return REGISTRY;
      },
    }).resolve;

    expect(await resolve("muse-spark-1.3-contributor-free", "opencode")).toBe(1_048_576);
    expect(fetches).toBe(1);

    // Second resolver, same file: served from disk, no second fetch.
    const again = createWindowResolver({
      defaultWindow: 200_000,
      cachePath,
      fetchRegistry: async () => {
        fetches += 1;
        return REGISTRY;
      },
    }).resolve;
    expect(await again("muse-spark-1.3-contributor-free")).toBe(1_048_576);
    expect(fetches).toBe(1);
    expect(JSON.parse(readFileSync(cachePath, "utf8")).entries).toEqual({
      "muse-spark-1.3-contributor-free": 1_048_576,
    });
  });
});
