import { describe, expect, it } from "bun:test";

import { handleBoardRoute } from "./board-routes.ts";
import { BoardDb } from "./db.ts";
import { lotView } from "./lot.ts";
import { filesCited, lotOverlaps, overlapWarning } from "./lot-overlap.ts";

describe("filesCited", () => {
  it("reads paths and bare file names, not URLs, versions or abbreviations", () => {
    expect(
      filesCited("Edit `bridge/lot.ts` and ./web/src/lib/board.ts, then CLAUDE.md and .adr/0016-x.md. e.g. v1.2, see https://x.io/a.ts"),
    ).toEqual(["bridge/lot.ts", "web/src/lib/board.ts", "CLAUDE.md", ".adr/0016-x.md"]);
  });
  it("is empty for no spec", () => expect(filesCited(null)).toEqual([]));
});

const card = (id: string, spec: string | null, dependsOn: string | null = null) => ({ id, title: id, spec, dependsOn });

describe("lotOverlaps", () => {
  const a = card("a", "touch bridge/run.ts and skills/collie-board/SKILL.md");
  const b = card("b", "also bridge/run.ts");
  const c = card("c", "only web/src/x.tsx");

  it("flags two parallel cards citing the same file", () =>
    expect(lotOverlaps({ maxParallel: null }, [a, b, c])).toEqual([{ cardIds: ["a", "b"], files: ["bridge/run.ts"] }]));
  it("says nothing without a shared file", () => expect(lotOverlaps({ maxParallel: 3 }, [a, c])).toEqual([]));
  it("says nothing for a lot that goes one at a time", () => expect(lotOverlaps({ maxParallel: 1 }, [a, b])).toEqual([]));
  it("says nothing for cards already chained, even through a third", () => {
    expect(lotOverlaps({ maxParallel: 2 }, [a, card("m", null, "a"), card("b", "bridge/run.ts", "m")])).toEqual([]);
  });
  it("a spec that names no file is never flagged", () => expect(lotOverlaps({ maxParallel: 2 }, [card("x", "refactor"), card("y", "refactor")])).toEqual([]));
  it("warns with the way out", () => {
    expect(overlapWarning([])).toBeNull();
    expect(overlapWarning(lotOverlaps({ maxParallel: 2 }, [a, b]))).toContain("maxParallel to 1");
  });
});

const ctx = (db: BoardDb) =>
  ({
    db,
    engine: { current: () => ({ bridge: "connected", agents: [] }) },
    cfg: {},
    audit: { record: () => {} },
    guard: () => null,
    json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
    text: (body: string, status: number) => new Response(body, { status }),
  }) as never;

describe("a lot whose cards cite the same file", () => {
  it("POST /api/runs answers with the warning, and the lot carries it", async () => {
    const db = new BoardDb(":memory:");
    const [x, y] = ["x", "y"].map((t) => db.createCard({ title: t, repoPath: "/r", spec: "change bridge/lot.ts" }));
    const post = (cardIds: string[], maxParallel: number | null) =>
      handleBoardRoute("/api/runs", new Request("http://x/api/runs", { method: "POST", body: JSON.stringify({ cardIds, foldInCap: 0, planned: true, maxParallel }) }), ctx(db));
    const res = await post([x!.id, y!.id], 2);
    expect(res!.status).toBe(201);
    const body = (await res!.json()) as { run: { id: string }; overlaps: unknown[]; warning: string | null };
    expect(body.overlaps).toEqual([{ cardIds: [x!.id, y!.id], files: ["bridge/lot.ts"] }]);
    expect(body.warning).toContain("bridge/lot.ts");
    expect(lotView(db, db.getRun(body.run.id)!).overlaps).toHaveLength(1);

    const z = db.createCard({ title: "z", repoPath: "/r", spec: "web/src/a.tsx" });
    const quiet = (await (await post([z.id], 2))!.json()) as { overlaps: unknown[]; warning: string | null };
    expect([quiet.overlaps, quiet.warning]).toEqual([[], null]);
  });
});
