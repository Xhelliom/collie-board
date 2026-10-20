import { describe, expect, it } from "bun:test";

import { handleBoardRoute } from "./board-routes.ts";
import { BoardDb } from "./db.ts";
import type { EngineSnapshot } from "./state-engine.ts";
import { tidyCandidates, type TidyDeps } from "./tidy.ts";
import type { AgentView } from "./types.ts";

const H = 3600_000;
const NOW = 100 * H;
const pane = (paneId: string, o: Partial<AgentView> = {}): AgentView =>
  ({ paneId, workspaceId: "w", workspaceLabel: "ws", workspaceNumber: 1, tabId: "t", agent: "claude", status: "idle", cwd: "/r", focused: false, ...o }) as AgentView;
const snap = (agents: AgentView[], shellPanes: AgentView[] = []): EngineSnapshot =>
  ({ agents, shellPanes, workspaces: [], tabs: [], bridge: "connected" }) as EngineSnapshot;

function world() {
  const db = new BoardDb(":memory:");
  const deps: TidyDeps = {
    sessionOfPane: (id) => db.openSessionByPane(id) ?? db.lastSessionByPane(id),
    getCard: (id) => db.getCard(id),
    getRun: (id) => db.getRun(id),
    runFinished: (id) => db.runFinished(id),
    isBoardPane: (id) => id === "lead",
  };
  return { db, deps };
}

describe("tidy candidates", () => {
  it("classes each pane by its first reason, and never proposes what must stay", () => {
    const { db, deps } = world();
    const filedCard = db.createCard({ title: "filed", repoPath: "/r", status: "done" });
    db.closeSession(db.openSession({ cardId: filedCard.id, paneId: "c" }).id, "done");
    const liveCard = db.createCard({ title: "live", repoPath: "/r", status: "review" });
    db.openSession({ cardId: liveCard.id, paneId: "live" });
    const lotCard = db.createCard({ title: "lot", repoPath: "/r", status: "done" });
    const lot = db.createRun({ repoPath: "/r", cardIds: [lotCard.id], foldInCap: 0 });
    db.launchRun(lot.id);
    db.openSession({ cardId: lotCard.id, paneId: "inlot" });

    const out = tidyCandidates(
      snap(
        [
          pane("c"),
          pane("d", { status: "done", statusSince: NOW - H }),
          pane("old", { statusSince: NOW - 3 * H }),
          pane("fresh", { statusSince: NOW - H }),
          pane("unseen"),
          pane("busy", { status: "working" }),
          pane("ask", { status: "blocked" }),
          pane("orch", { workspaceLabel: "orchestrator-r" }),
          pane("lead"),
          pane("live", { statusSince: NOW - 9 * H }),
          pane("inlot", { status: "done" }),
        ],
        [pane("sh", { kind: "shell", status: "unknown" })],
      ),
      deps,
      2 * H,
      NOW,
    );
    expect(out.map((c) => [c.paneId, c.reason])).toEqual([
      ["c", "card-done"],
      ["d", "agent-done"],
      ["old", "idle"],
      ["sh", "shell"],
    ]);
    expect(out[0]!.cardTitle).toBe("filed");
    expect(out[2]!.since).toBe(NOW - 3 * H);
  });

  it("proposes nothing off a disconnected snapshot", () => {
    const { deps } = world();
    expect(tidyCandidates({ ...snap([pane("d", { status: "done" })]), bridge: "disconnected" }, deps, H, NOW)).toEqual([]);
  });
});

describe("POST /api/tidy/close", () => {
  const setup = (agents: AgentView[]) => {
    const closed: string[] = [];
    const audits: { action: string; paneId?: string }[] = [];
    const ctx = {
      db: new BoardDb(":memory:"),
      copilot: { paneId: null },
      herdr: { closePane: async (id: string) => void closed.push(id) },
      engine: { current: () => snap(agents) },
      cfg: { boardCopilotWorkspace: "board" },
      audit: { record: (e: never) => audits.push(e) },
      session: "default",
      guard: () => null,
      device: null,
      json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
      text: (body: string, status: number) => new Response(body, { status }),
    } as never;
    const post = async (body: unknown, headers: Record<string, string> = {}) => {
      const res = await handleBoardRoute("/api/tidy/close", new Request("http://x/api/tidy/close", { method: "POST", headers, body: JSON.stringify(body) }), ctx);
      return { status: res!.status, body: await res!.json().catch(() => null) };
    };
    return { closed, audits, post };
  };

  it("closes only what is still a candidate, and audits each close", async () => {
    const w = setup([pane("d", { status: "done" }), pane("busy", { status: "working" })]);
    const r = await w.post({ paneIds: ["d", "busy"] });
    expect(r.body).toMatchObject({ ok: true, closed: ["d"], skipped: ["busy"] });
    expect(w.closed).toEqual(["d"]);
    expect(w.audits).toMatchObject([{ action: "pane.close", paneId: "d" }]);
  });

  it("refuses an agent pane: tidying is the operator's gesture", async () => {
    const w = setup([pane("d", { status: "done" })]);
    expect((await w.post({ paneIds: ["d"] }, { "x-collie-pane": "w1:p1" })).status).toBe(403);
    expect(w.closed).toEqual([]);
  });
});
