import { describe, expect, it } from "bun:test";

import { handleBoardRoute } from "./board-routes.ts";
import { BoardDb } from "./db.ts";
import { nextStepOf } from "./pipeline.ts";

const pane = (paneId: string, status: string) => ({ paneId, status, agent: "claude", cwd: "/r", workspaceId: "w", workspaceLabel: "w" });
const snap = (agents: unknown[]) => ({ agents, shellPanes: [], workspaces: [], tabs: [], bridge: "connected" }) as never;

describe("nextStepOf (ADR 0031)", () => {
  const db = new BoardDb(":memory:");
  const roles = db.listTemplates().filter((t) => t.key === "implementer" || t.key === "reviewer");
  const events = (n: number) => Array.from({ length: n }, () => ({ type: "card.pipeline_step", payload: { index: n } }) as never);
  it("offers the next role only to a landed card with a session, outside a run", () => {
    expect(nextStepOf({ runId: null, status: "review" }, true, roles, [])).toEqual({ templateId: roles[1]!.id, name: roles[1]!.name });
    expect(nextStepOf({ runId: "r", status: "review" }, true, roles, [])).toBeNull(); // a run chains by itself
    expect(nextStepOf({ runId: null, status: "working" }, true, roles, [])).toBeNull();
    expect(nextStepOf({ runId: null, status: "review" }, false, roles, [])).toBeNull();
    expect(nextStepOf({ runId: null, status: "review" }, true, roles, events(1))).toBeNull(); // last role done
    expect(nextStepOf({ runId: null, status: "review" }, true, [], [])).toBeNull(); // no pipeline
  });
});

describe("POST /api/cards/<id>/next-step", () => {
  function setup(o: { status?: string; paneStatus?: string; session?: boolean; run?: boolean; pipeline?: boolean } = {}) {
    const db = new BoardDb(":memory:");
    const t = (k: string) => db.listTemplates().find((x) => x.key === k)!.id;
    const card = db.createCard({ title: "a", repoPath: "/r", status: "ready" });
    if (o.pipeline !== false) db.patchCard(card.id, { pipelineId: db.createFlow({ name: "F", steps: [t("implementer"), t("reviewer")] }).id });
    if (o.session !== false) db.openSession({ cardId: card.id, paneId: "w1:p1" });
    db.setStatus(card.id, (o.status ?? "review") as never, "test");
    if (o.run) db.createRun({ repoPath: "/r", cardIds: [card.id], foldInCap: 0 });
    const tabs: string[] = [];
    const herdr = { createTab: async () => (tabs.push("tab"), { paneId: "w1:p2" }), closePane: async () => {} };
    const ctx = {
      db,
      herdr,
      engine: { current: () => snap([pane("w1:p1", o.paneStatus ?? "idle")]) },
      copilot: { busy: () => new Set<string>() },
      cfg: {} as never,
      audit: { record: () => {} },
      session: "default",
      guard: () => null,
      device: null,
      json: (d: unknown, status = 200) => new Response(JSON.stringify(d), { status }),
      text: (b: string, status: number) => new Response(b, { status }),
    } as never;
    const post = async () => {
      const res = await handleBoardRoute(`/api/cards/${card.id}/next-step`, new Request("http://x", { method: "POST" }), ctx);
      return { status: res!.status, body: (await res!.json()) as { kind?: string } };
    };
    return { db, card, post, tabs };
  }

  it("refuses what a run, a working agent, a missing session or an end of pipeline should not take", async () => {
    expect((await setup({ session: false }).post()).body.kind).toBe("no-session");
    expect((await setup({ run: true }).post()).body.kind).toBe("in-run");
    expect((await setup({ paneStatus: "working" }).post()).body.kind).toBe("not-landed");
    expect((await setup({ status: "working" }).post()).body.kind).toBe("not-landed");
    const none = await setup({ pipeline: false }).post();
    expect([none.status, none.body.kind]).toEqual([409, "no-next-step"]);
  });

  it("the card view says what the tap would do", async () => {
    const { db, card } = setup();
    const res = await handleBoardRoute(`/api/cards/${card.id}`, new Request("http://x"), {
      db,
      engine: { current: () => snap([pane("w1:p1", "idle")]) },
      copilot: { busy: () => new Set<string>() },
      guard: () => null,
      json: (d: unknown) => new Response(JSON.stringify(d)),
      text: (b: string, status: number) => new Response(b, { status }),
    } as never);
    const body = (await res!.json()) as { card: { nextStep: { name: string } | null } };
    expect(body.card.nextStep?.name).toBeTruthy();
  });
});
