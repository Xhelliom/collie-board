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

  // Polled by the Project page (perf audit 2026-11, P1): 39 calls/min, none a 304 before.
  for (const path of ["/api/runs?repo=/r", "/api/phases?repo=/r"]) {
    it(`${path}: an unchanged poll is a 304; a write changes the ETag`, async () => {
      const { db, card, get } = setup();
      const phase = db.createPhase({ repoPath: "/r", name: "p" });
      db.patchCard(card.id, { repoPath: "/r" });
      db.createRun({ repoPath: "/r", cardIds: [card.id], foldInCap: 0, phaseId: phase.id, planned: true });
      const first = await get(path);
      expect(first.status).toBe(200);
      const etag = first.headers.get("etag")!;
      expect(etag).toBeTruthy();
      expect((await get(path, etag)).status).toBe(304);

      db.createPhase({ repoPath: "/r", name: "q" });
      db.createRun({ repoPath: "/r", cardIds: [], foldInCap: 0, planned: true });
      const after = await get(path, etag);
      expect(after.status).toBe(200);
      expect(after.headers.get("etag")).not.toBe(etag);
    });
  }
});

describe("lot reads (perf audit 2026-11, P1 + P3)", () => {
  it("indexes card(run_id), idempotently, and reads runMembers through it", () => {
    const db = new BoardDb(":memory:");
    // A second migrate on the same db must not fail: the index is CREATE … IF NOT EXISTS.
    (db as unknown as { migrate(): void }).migrate();
    const raw = (db as unknown as { db: import("bun:sqlite").Database }).db;
    const plan = raw.query<{ detail: string }, []>("EXPLAIN QUERY PLAN SELECT * FROM card WHERE run_id = 'x'").all();
    expect(plan.map((p) => p.detail).join()).toContain("card_run_idx");
  });

  it("runFinishedAt reads run.finished_at, and falls back to the event for a lot finished before the column", () => {
    const db = new BoardDb(":memory:");
    const card = db.createCard({ title: "a", repoPath: "/r" });
    const run = db.createRun({ repoPath: "/r", cardIds: [card.id], foldInCap: 0 });
    expect(db.runFinishedAt(run.id)).toBeNull();
    db.recordRunEvent(null, "run.finished", { runId: run.id } as never);
    const raw = (db as unknown as { db: import("bun:sqlite").Database }).db;
    const at = raw.query<{ f: number }, [string]>("SELECT finished_at AS f FROM run WHERE id = ?").get(run.id)!.f;
    expect(db.runFinishedAt(run.id)).toBe(at);
    raw.query("UPDATE run SET finished_at = NULL WHERE id = ?").run(run.id);
    expect(db.runFinishedAt(run.id)).not.toBeNull();
  });
});
