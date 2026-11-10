import { describe, expect, it } from "bun:test";

import { handleBoardRoute } from "./board-routes.ts";
import { BoardDb } from "./db.ts";
import { parseBudget, DEFAULT_BUDGET, weekPercent } from "./goal-routes.ts";

const ctx = (db: BoardDb) =>
  ({
    db,
    audit: { record: () => {} },
    session: "default",
    guard: () => null,
    device: null,
    json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
    text: (body: string, status: number) => new Response(body, { status }),
  }) as never;

const call = async (db: BoardDb, method: string, path: string, body?: unknown, pane?: string) => {
  const res = await handleBoardRoute(
    path.split("?")[0]!,
    new Request(`http://x${path}`, { method, headers: pane ? { "x-collie-pane": pane } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    ctx(db),
  );
  const text = await res!.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // plain text
  }
  // biome-ignore lint: test helper
  return { status: res!.status, body: parsed as any };
};

const NEW = { repoPath: "/r", text: "Ship v1", criteria: ["CI green", "docs written"] };

describe("a repo's objective (ADR 0056)", () => {
  it("the operator creates one with criteria and the default budget", async () => {
    const db = new BoardDb(":memory:");
    const r = await call(db, "POST", "/api/goals", NEW);
    expect(r.status).toBe(201);
    expect(r.body.goal).toMatchObject({ repoPath: "/r", text: "Ship v1", criteria: ["CI green", "docs written"], status: "active", budget: DEFAULT_BUDGET });
    expect(r.body.goal.spent).toEqual({ lots: 0, lotIds: [], cardIds: [], quotaPct: null });
  });

  it("refuses an agent pane on create, edit, pause, abandon and validate — but lets it claim", async () => {
    const db = new BoardDb(":memory:");
    expect((await call(db, "POST", "/api/goals", NEW, "p1")).status).toBe(403);
    const id = (await call(db, "POST", "/api/goals", NEW)).body.goal.id;
    expect((await call(db, "PATCH", `/api/goals/${id}`, { text: "x" }, "p1")).status).toBe(403);
    for (const m of ["pause", "abandon", "achieve", "resume"]) expect((await call(db, "POST", `/api/goals/${id}/${m}`, undefined, "p1")).status).toBe(403);
    const claimed = await call(db, "POST", `/api/goals/${id}/claim`, undefined, "p1");
    expect(claimed.body.goal.status).toBe("claimed");
    expect((await call(db, "POST", `/api/goals/${id}/achieve`, undefined, "p1")).status).toBe(403);
    const done = await call(db, "POST", `/api/goals/${id}/achieve`);
    expect(done.body.goal.status).toBe("achieved");
    expect(done.body.goal.endedAt).not.toBeNull();
  });

  it("keeps one open objective per repo, and frees the slot once it is closed", async () => {
    const db = new BoardDb(":memory:");
    const id = (await call(db, "POST", "/api/goals", NEW)).body.goal.id;
    expect((await call(db, "POST", "/api/goals", NEW)).status).toBe(409);
    expect((await call(db, "POST", "/api/goals", { ...NEW, repoPath: "/other" })).status).toBe(201);
    await call(db, "POST", `/api/goals/${id}/pause`);
    expect((await call(db, "POST", "/api/goals", NEW)).status).toBe(409); // paused is still open
    await call(db, "POST", `/api/goals/${id}/abandon`);
    expect((await call(db, "POST", "/api/goals", NEW)).status).toBe(201);
    expect((await call(db, "GET", "/api/goals?repo=/r")).body.goals.map((g: { status: string }) => g.status)).toEqual(["active", "abandoned"]);
    expect((await call(db, "PATCH", `/api/goals/${id}`, { text: "late" })).status).toBe(409); // closed: frozen
  });

  it("moves only along its transitions", async () => {
    const db = new BoardDb(":memory:");
    const id = (await call(db, "POST", "/api/goals", NEW)).body.goal.id;
    expect((await call(db, "POST", `/api/goals/${id}/resume`)).status).toBe(409);
    await call(db, "POST", `/api/goals/${id}/pause`);
    expect((await call(db, "POST", `/api/goals/${id}/claim`, undefined, "p1")).status).toBe(409);
    expect((await call(db, "POST", `/api/goals/${id}/resume`)).body.goal.status).toBe("active");
  });

  it("edits text, criteria and budget, validating each", async () => {
    const db = new BoardDb(":memory:");
    const id = (await call(db, "POST", "/api/goals", NEW)).body.goal.id;
    const r = await call(db, "PATCH", `/api/goals/${id}`, { criteria: ["one"], budget: { maxLots: 3, deadline: 1_800_000_000_000 } });
    expect(r.body.goal).toMatchObject({ text: "Ship v1", criteria: ["one"], budget: { maxLots: 3, quotaPct: 80, deadline: 1_800_000_000_000 } });
    expect((await call(db, "PATCH", `/api/goals/${id}`, { criteria: [] })).status).toBe(400);
    expect((await call(db, "POST", "/api/goals", { ...NEW, repoPath: "/x", criteria: [""] })).status).toBe(400);
  });

  it("counts as its lots the repo's lots launched while it was open", async () => {
    let now = 1_000;
    const db = new BoardDb(":memory:", () => now);
    const before = db.createRun({ repoPath: "/r", cardIds: [], foldInCap: 1, planned: true });
    db.launchRun(before.id);
    now = 2_000;
    const id = (await call(db, "POST", "/api/goals", NEW)).body.goal.id;
    const card = db.createCard({ title: "step", repoPath: "/r" });
    now = 3_000;
    const lot = db.createRun({ repoPath: "/r", cardIds: [card.id], foldInCap: 1, planned: true });
    db.launchRun(lot.id);
    db.createRun({ repoPath: "/r", cardIds: [], foldInCap: 1, planned: true }); // planned, not spent
    const g = (await call(db, "GET", `/api/goals/${id}`)).body.goal;
    expect(g.spent).toMatchObject({ lots: 1, lotIds: [lot.id], cardIds: [card.id] });
  });
});

describe("goal budget and quota", () => {
  it("reads the week's all-models limit", () => {
    const limits = [
      { label: "Current session", percent: 90, resetsAt: null },
      { label: "Current week (Opus)", percent: 50, resetsAt: null },
      { label: "Current week (all models)", percent: 42, resetsAt: null },
    ];
    expect(weekPercent({ limits, checkedAt: 0 })).toBe(42);
    expect(weekPercent(null)).toBeNull();
  });

  it("rejects an out-of-range budget", () => {
    expect(parseBudget({ quotaPct: 0 }, DEFAULT_BUDGET)).toBeTypeOf("string");
    expect(parseBudget({ maxLots: 1.5 }, DEFAULT_BUDGET)).toBeTypeOf("string");
    expect(parseBudget({ deadline: "tomorrow" }, DEFAULT_BUDGET)).toBeTypeOf("string");
    expect(parseBudget({ maxLots: 2 }, DEFAULT_BUDGET)).toEqual({ ...DEFAULT_BUDGET, maxLots: 2 });
  });
});
