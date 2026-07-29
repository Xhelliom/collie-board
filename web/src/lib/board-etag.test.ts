import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The conditional-GET cache behind fetchCards/fetchCard. Worth pinning because its failure mode is
// silent and permanent: a cache that returns the wrong body, or one that keeps an ETag without the
// body it belongs to, would 304 every later poll into a board that never changes again.
//
// fetch is stubbed rather than driven through MSW — what is under test is the ETag bookkeeping,
// and a stub makes the request headers directly inspectable.

interface Call {
  url: string;
  ifNoneMatch: string | null;
}

function stubFetch(responses: Array<{ status: number; etag?: string; body?: unknown }>) {
  const calls: Call[] = [];
  let i = 0;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, ifNoneMatch: headers["if-none-match"] ?? null });
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return Promise.resolve(
      new Response(r.status === 304 ? null : JSON.stringify(r.body ?? {}), {
        status: r.status,
        headers: r.etag ? { etag: r.etag, "content-type": "application/json" } : {},
      }),
    );
  });
  return calls;
}

// The cache is module-scoped, so a fresh module per test is what isolates them. Done here rather
// than by exporting a reset hook: production code should not grow a door that only tests open.
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

/** The board module with an empty cache. */
async function freshBoard() {
  return import("./board");
}

describe("board conditional GET", () => {
  it("sends no If-None-Match on the first call, and the stored tag afterwards", async () => {
    const calls = stubFetch([
      { status: 200, etag: '"a1"', body: { cards: [] } },
      { status: 304 },
    ]);
    const board = await freshBoard();
    await board.fetchCards();
    await board.fetchCards();

    expect(calls[0]!.ifNoneMatch).toBeNull();
    expect(calls[1]!.ifNoneMatch).toBe('"a1"');
  });

  it("returns the cached body on a 304 — the poll must not blank the board", async () => {
    stubFetch([
      { status: 200, etag: '"b1"', body: { cards: [{ id: "x" }] } },
      { status: 304 },
    ]);
    const board = await freshBoard();
    const first = await board.fetchCards();
    const second = await board.fetchCards();

    expect(second).toEqual(first);
    expect((second as { cards: unknown[] }).cards).toHaveLength(1);
  });

  it("takes the new body when the tag changed — a write must not be masked", async () => {
    stubFetch([
      { status: 200, etag: '"c1"', body: { cards: [{ id: "old" }] } },
      { status: 200, etag: '"c2"', body: { cards: [{ id: "new" }] } },
    ]);
    const board = await freshBoard();
    await board.fetchCards();
    const after = (await board.fetchCards()) as { cards: { id: string }[] };

    expect(after.cards[0]!.id).toBe("new");
  });

  it("caches nothing when the response carries no ETag", async () => {
    const calls = stubFetch([
      { status: 200, body: { cards: [] } },
      { status: 200, body: { cards: [] } },
    ]);
    const board = await freshBoard();
    await board.fetchCards();
    await board.fetchCards();

    expect(calls[1]!.ifNoneMatch).toBeNull();
  });

  it("keys by URL, so one card's body can never answer for another's", async () => {
    const calls = stubFetch([
      { status: 200, etag: '"card-a"', body: { card: { id: "a" } } },
      { status: 200, etag: '"card-b"', body: { card: { id: "b" } } },
    ]);
    const board = await freshBoard();
    await board.fetchCard("a");
    const b = (await board.fetchCard("b")) as { card: { id: string } };

    expect(calls[1]!.ifNoneMatch).toBeNull();
    expect(b.card.id).toBe("b");
  });

  it("raises an ApiError carrying the status, so a 403 still reads as an auth failure", async () => {
    stubFetch([{ status: 403 }]);
    const board = await freshBoard();
    await expect(board.fetchCards()).rejects.toMatchObject({ name: "ApiError", status: 403 });
  });
});
