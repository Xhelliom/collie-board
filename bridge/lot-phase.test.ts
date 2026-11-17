import { describe, expect, it } from "bun:test";

import { handleBoardRoute } from "./board-routes.ts";
import { BoardDb } from "./db.ts";

const ctx = (db: BoardDb) =>
  ({
    db,
    audit: { record: () => {} },
    guard: () => null,
    json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
    text: (body: string, status: number) => new Response(body, { status }),
  }) as never;

describe("a lot with a phase files its cards in it", () => {
  it("POST /api/runs files a phaseless card, leaves one of another phase and says so", async () => {
    const db = new BoardDb(":memory:");
    const p = db.createPhase({ repoPath: "/repo", name: "P" });
    const other = db.createPhase({ repoPath: "/repo", name: "Q" });
    const a = db.createCard({ title: "a", repoPath: "/repo" });
    const b = db.createCard({ title: "b", repoPath: "/repo", phaseId: other.id });
    const res = await handleBoardRoute(
      "/api/runs",
      new Request("http://x/api/runs", { method: "POST", body: JSON.stringify({ planned: true, cardIds: [a.id, b.id], foldInCap: 0, phaseId: p.id }) }),
      ctx(db),
    );
    expect(res!.status).toBe(201);
    expect(db.getCard(a.id)!.phaseId).toBe(p.id);
    expect(db.getCard(b.id)!.phaseId).toBe(other.id);
    expect(((await res!.json()) as { warning: string }).warning).toContain(b.id);
  });

  it("a lot given a phase later (PATCH) files its phaseless cards", () => {
    const db = new BoardDb(":memory:");
    const p = db.createPhase({ repoPath: "/repo", name: "P" });
    const a = db.createCard({ title: "a", repoPath: "/repo" });
    const run = db.createRun({ repoPath: "/repo", cardIds: [a.id], foldInCap: 0, planned: true });
    db.updateLot(run.id, { phaseId: p.id });
    expect(db.fileLotInPhase(run.id)).toEqual([]);
    expect(db.getCard(a.id)!.phaseId).toBe(p.id);
  });

  it("the boot repair files the open cards of a phased lot, not the done ones", () => {
    const db = new BoardDb(":memory:");
    const p = db.createPhase({ repoPath: "/repo", name: "P" });
    const open = db.createCard({ title: "open", repoPath: "/repo" });
    const done = db.createCard({ title: "done", repoPath: "/repo", status: "done" });
    db.createRun({ repoPath: "/repo", cardIds: [open.id, done.id], foldInCap: 0, planned: true, phaseId: p.id });
    db.repairLotPhases();
    expect(db.getCard(open.id)!.phaseId).toBe(p.id);
    expect(db.getCard(done.id)!.phaseId).toBeNull();
  });
});
