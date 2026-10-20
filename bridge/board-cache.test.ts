import { describe, expect, it, spyOn } from "bun:test";

import { handleBoardRoute } from "./board-routes.ts";
import { BoardDb } from "./db.ts";
import { conditionalJson } from "./http-cache.ts";

// The polled board reads rebuild only when a write moved the db — see `memoOn`.
describe("polled board reads", () => {
  const snap = { agents: [], shellPanes: [], workspaces: [], tabs: [], bridge: "connected" };
  const setup = () => {
    const db = new BoardDb(":memory:");
    const card = db.createCard({ title: "a" });
    const ctx = (req: Request) =>
      ({
        db,
        engine: { current: () => snap },
        copilot: { busy: () => new Set() },
        guard: () => null,
        json: (data: unknown) => conditionalJson(data, req),
        text: (body: string, status: number) => new Response(body, { status }),
      }) as never;
    const get = async (path: string, etag?: string) => {
      const req = new Request(`http://x${path}`, etag ? { headers: { "if-none-match": etag } } : {});
      return (await handleBoardRoute(path.split("?")[0]!, req, ctx(req)))!;
    };
    return { db, card, get, listCards: spyOn(db, "listCards") };
  };

  it("conditionalJson stringifies a 200's body once, for both the ETag and the body", async () => {
    const stringify = spyOn(JSON, "stringify");
    const res = conditionalJson({ big: "x".repeat(1000) }, new Request("http://x", { headers: { "accept-encoding": "gzip" } }));
    expect(stringify).toHaveBeenCalledTimes(1);
    stringify.mockRestore();
    expect(res.headers.get("content-encoding")).toBe("gzip");
  });

  for (const path of ["/api/cards", "/api/cards?view=summary", "/api/project/facts"]) {
    it(`${path}: an unchanged poll is a 304 that recomputes nothing; a write changes the ETag`, async () => {
      const { db, card, get, listCards } = setup();
      const first = await get(path);
      const etag = first.headers.get("etag")!;
      expect(first.status).toBe(200);
      expect(listCards).toHaveBeenCalledTimes(1);

      const again = await get(path, etag);
      expect(again.status).toBe(304);
      expect(listCards).toHaveBeenCalledTimes(1);

      db.createCard({ title: "b" });
      const after = await get(path, etag);
      expect(after.status).toBe(200);
      expect(after.headers.get("etag")).not.toBe(etag);
      expect(listCards).toHaveBeenCalledTimes(2);

      // An edit is a write too: rebuilt (the facts don't carry the title, so their tag may stand).
      db.patchCard(card.id, { title: "renamed" });
      await get(path, after.headers.get("etag")!);
      expect(listCards).toHaveBeenCalledTimes(3);
    });
  }
});
