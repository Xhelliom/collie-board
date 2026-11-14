import { describe, expect, it } from "bun:test";

import { BoardDb } from "./db.ts";
import { handleBoardRoute, PANE_HEADER } from "./board-routes.ts";
import { resolvePrConflict, type PrResolveDeps } from "./pr-resolve.ts";
import type { PrDetail } from "./pr-detail.ts";

const detail = (over: Partial<PrDetail> = {}): PrDetail =>
  ({ number: 7, title: "docs(plan)", state: "open", conflicting: true, head: "docs/plan", base: "main", url: "https://github.com/o/r/pull/7", card: null, ...over }) as PrDetail;

function setup(over: Partial<PrResolveDeps> & { d?: Partial<PrDetail> } = {}) {
  const db = new BoardDb(":memory:");
  db.setRepoListed("/repo", true);
  const calls: string[] = [];
  const deps: PrResolveDeps = {
    detail: async () => ({ ok: true, detail: detail(over.d) }),
    restore: async (_p, b) => (calls.push(`restore ${b}`), { ok: true }),
    start: async (id, prompt) => (calls.push(`start ${id} ${prompt}`), { ok: true, paneId: "p1" }),
    resolve: async (c) => (calls.push(`resolve ${c.id}`), { ok: true, paneId: "p2" }),
    reopen: async (c) => (calls.push(`reopen ${c.id}`), { ok: true, paneId: "p3" }),
    ...over,
  };
  return { db, calls, deps };
}

describe("resolvePrConflict", () => {
  it("a PR with no card: files a card on the PR's own branch and starts it", async () => {
    const { db, calls, deps } = setup();
    const r = await resolvePrConflict(db, "/repo", "7", deps);
    expect(r).toMatchObject({ ok: true, card: { title: "Résoudre le conflit de la PR #7" } });
    const card = db.listCards({}).find((c) => c.title.includes("#7"))!;
    expect(card).toMatchObject({ repoPath: "/repo", branch: "docs/plan", baseRef: "main" });
    expect(calls[0]).toBe("restore docs/plan");
    expect(calls[1]).toContain(`start ${card.id}`);
    expect(calls[1]).toContain("origin/main");
  });
  it("a PR carried by a card with a live agent: hands it the conflict", async () => {
    const { db, calls, deps } = setup();
    const card = db.createCard({ title: "x", repoPath: "/repo", branch: "docs/plan" });
    db.openSession({ cardId: card.id, paneId: "pane", agentKind: "claude" });
    deps.detail = async () => ({ ok: true, detail: detail({ card: { id: card.id, title: "x", status: "todo" } }) });
    expect(await resolvePrConflict(db, "/repo", "7", deps)).toMatchObject({ ok: true, card: { id: card.id } });
    expect(calls).toEqual([`resolve ${card.id}`]);
  });
  it("a PR carried by a card with no agent: relaunches it on its branch", async () => {
    const { db, calls, deps } = setup();
    const card = db.createCard({ title: "x", repoPath: "/repo", branch: "docs/plan" });
    deps.detail = async () => ({ ok: true, detail: detail({ card: { id: card.id, title: "x", status: "todo" } }) });
    await resolvePrConflict(db, "/repo", "7", deps);
    expect(calls).toEqual([`reopen ${card.id}`]);
  });
  it("refuses a PR that is not open or not in conflict, creating nothing", async () => {
    for (const d of [{ state: "merged" as const }, { conflicting: false }]) {
      const { db, calls, deps } = setup({ d });
      expect(await resolvePrConflict(db, "/repo", "7", deps)).toMatchObject({ ok: false, status: 409 });
      expect(calls).toEqual([]);
      expect(db.listCards({}).length).toBe(0);
    }
  });
  it("refuses an unknown repo and a bad number", async () => {
    const { db, deps } = setup();
    expect(await resolvePrConflict(db, "/else", "7", deps)).toMatchObject({ ok: false, status: 403 });
    expect(await resolvePrConflict(db, "/repo", "--x", deps)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("POST /api/board/prs/<n>/resolve", () => {
  it("is the operator's tap: a pane gets 403", async () => {
    const db = new BoardDb(":memory:");
    const req = new Request("http://x/api/board/prs/7/resolve", { method: "POST", headers: { [PANE_HEADER]: "p9" }, body: JSON.stringify({ repo: "/repo" }) });
    const ctx = { guard: () => null, text: (m: string, s: number) => new Response(m, { status: s }), json: (b: unknown, s = 200) => Response.json(b, { status: s }), db } as never;
    const res = await handleBoardRoute("/api/board/prs/7/resolve", req, ctx);
    expect(res?.status).toBe(403);
  });
});
