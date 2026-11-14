import { describe, expect, it } from "bun:test";

import { BUILTIN_ADAPTERS } from "./adapters.ts";
import { BoardDb } from "./db.ts";
import { CostTracker } from "./cost.ts";
import { handleCostSumRoute } from "./cost-routes.ts";

const LOG = JSON.stringify({ type: "assistant", message: { id: "m", model: "claude-opus-5-5", usage: { input_tokens: 1, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });

describe("GET /api/cost", () => {
  it("sums a lot, a phase and the project; a non-Claude card is « unknown », not 0", async () => {
    const db = new BoardDb(":memory:");
    const source = { resolve: async (id: string) => id, load: async () => ({ text: LOG, complete: true, size: 0, mtimeMs: 0 }) } as never;
    const t = new CostTracker(db, source, BUILTIN_ADAPTERS, () => 0);
    const mk = (title: string, extra: object) => db.createCard({ title, repoPath: "/r", ...extra } as never);
    const a = mk("a", {});
    const b = mk("b", {});
    db.openSession({ cardId: a.id, paneId: "p1", agentSessionId: "s", agentKind: "claude" });
    db.openSession({ cardId: b.id, paneId: "p2", agentSessionId: "s", agentKind: "codex" });
    await t.update({ agents: [], shellPanes: [], workspaces: [], tabs: [], bridge: "connected" } as never);
    db.patchCard(a.id, { phaseId: "ph1" } as never);
    const ctx = { db, guard: () => null, json: (d: unknown) => Response.json(d), text: (b: string, s: number) => new Response(b, { status: s }), cost: t } as never;
    const get = async (qs: string) => (await handleCostSumRoute("/api/cost", new Request(`http://x/api/cost?${qs}`), ctx)!.json()) as any;
    const project = await get("repo=%2Fr");
    expect(project).toMatchObject({ known: true, cards: 2, unknownCards: 1, tokens: { output: 10 } });
    expect(await get("repo=%2Fr&period=week")).toMatchObject({ known: true, unknownCards: 1 });
    expect(await get("repo=%2Fr&phaseId=ph1")).toMatchObject({ known: true, cards: 1, unknownCards: 0 });
    expect(await get("repo=%2Fnone")).toMatchObject({ known: false, cards: 0 });
    expect(handleCostSumRoute("/api/cost", new Request("http://x/api/cost"), ctx)!.status).toBe(400);
  });
});
