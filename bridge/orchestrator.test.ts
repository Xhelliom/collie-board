import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleBoardRoute, isBoardPath } from "./board-routes.ts";
import { BoardDb } from "./db.ts";
import {
  findOrchestrator,
  isOrchestratorAgent,
  orchestratorLabel,
  orchestratorName,
  orchestratorPrompt,
  startOrchestrator,
} from "./orchestrator.ts";
import type { EngineSnapshot } from "./state-engine.ts";

const agent = (paneId: string, workspaceLabel: string, cwd: string) => ({ paneId, workspaceLabel, cwd, status: "idle" });
const snap = (agents: ReturnType<typeof agent>[] = [], shellPanes: ReturnType<typeof agent>[] = []) =>
  ({ agents, shellPanes, workspaces: [], tabs: [], bridge: "connected" }) as unknown as EngineSnapshot;

/** A herdr that records what it was asked to do and takes every prompt at once. */
function fakeHerdr() {
  const calls: string[] = [];
  return {
    calls,
    herdr: {
      createWorkspace: async (o: { cwd: string; label?: string }) => (calls.push(`workspace ${o.label}`), { paneId: "w9:p1" }),
      startAgent: async (o: { paneId: string; kind: string; name: string }) => void calls.push(`start ${o.kind} ${o.name}`),
      getAgent: async () => ({ interactive_ready: true, agent_status: "working" }),
      promptAgent: async (o: { target: string; text: string }) => void calls.push(`prompt ${o.target}`),
      sendPaneKeys: async () => {},
    } as never,
  };
}
const cfg = { boardAgentKind: "claude", boardCopilotKind: "" } as never;
const noWait = async () => {};

describe("the orchestrator's identity", () => {
  it("is labelled per repo, and its agent name is valid and unique across two repos named alike", () => {
    expect(orchestratorLabel("/g/app")).toBe("orchestrator-app");
    const a = orchestratorName("/g/one/app");
    const b = orchestratorName("/g/two/app");
    expect(a).not.toBe(b);
    for (const n of [a, b, orchestratorName("/g/" + "x".repeat(80))]) {
      expect(n).toMatch(/^[a-z][a-z0-9_-]{0,31}$/);
    }
  });

  it("is found by label AND directory, never an operator's own session in the repo", () => {
    const s = snap([agent("p1", "orchestrator-app", "/g/app"), agent("p2", "mine", "/g/app"), agent("p3", "orchestrator-app", "/g/other")]);
    expect(findOrchestrator(s, "/g/app")).toBe("p1");
    expect(findOrchestrator(s, "/g/none")).toBeNull();
    expect(findOrchestrator(snap([agent("p2", "mine", "/g/app")]), "/g/app")).toBeNull();
  });

  it("is recognised by its label alone, so a restarted bridge keeps it silent", () => {
    expect(isOrchestratorAgent({ workspaceLabel: "orchestrator-app" })).toBe(true);
    expect(isOrchestratorAgent({ workspaceLabel: "lead" })).toBe(false);
    expect(isOrchestratorAgent({})).toBe(false);
  });

  it("is told to plan from the board and never to launch", () => {
    const p = orchestratorPrompt("/g/app");
    expect(p).toContain("/g/app");
    expect(p).toContain("JAMAIS");
    expect(p).toContain("x-collie-pane");
  });
});

describe("startOrchestrator", () => {
  it("adopts a live one without touching herdr", async () => {
    const f = fakeHerdr();
    const r = await startOrchestrator({ herdr: f.herdr, cfg, snapshot: () => snap([agent("p1", "orchestrator-app", "/g/app")]), wait: noWait }, "/g/app");
    expect(r).toEqual({ paneId: "p1", started: false });
    expect(f.calls).toEqual([]);
  });

  it("creates a workspace, launches the board's agent kind and prompts it once", async () => {
    const f = fakeHerdr();
    const r = await startOrchestrator({ herdr: f.herdr, cfg, snapshot: () => snap(), wait: noWait }, "/g/app");
    expect(r).toEqual({ paneId: "w9:p1", started: true });
    expect(f.calls[0]).toBe("workspace orchestrator-app");
    expect(f.calls[1]).toMatch(/^start claude orch-app-/);
    expect(f.calls.filter((c) => c.startsWith("prompt"))).toEqual(["prompt w9:p1"]);
  });

  it("reuses the shell a failed launch left behind instead of stacking a workspace", async () => {
    const f = fakeHerdr();
    await startOrchestrator({ herdr: f.herdr, cfg, snapshot: () => snap([], [agent("s1", "orchestrator-app", "/g/app")]), wait: noWait }, "/g/app");
    expect(f.calls.some((c) => c.startsWith("workspace"))).toBe(false);
    expect(f.calls[0]).toMatch(/^start /);
  });

  it("two taps at once make one agent", async () => {
    const f = fakeHerdr();
    const deps = { herdr: f.herdr, cfg, snapshot: () => snap(), wait: noWait };
    const [a, b] = await Promise.all([startOrchestrator(deps, "/g/app"), startOrchestrator(deps, "/g/app")]);
    expect(a).toEqual(b);
    expect(f.calls.filter((c) => c.startsWith("workspace"))).toHaveLength(1);
  });
});

describe("/api/orchestrator", () => {
  const repo = mkdtempSync(join(tmpdir(), "collie-orch-"));
  mkdirSync(join(repo, ".git"));
  const ctx = (db: BoardDb, o: { guard?: Response | null; agents?: ReturnType<typeof agent>[]; herdr?: unknown } = {}) =>
    ({
      db,
      herdr: o.herdr ?? fakeHerdr().herdr,
      engine: { current: () => snap(o.agents ?? []) },
      copilot: {},
      cfg,
      audit: { record: () => {} },
      session: "default",
      guard: () => o.guard ?? null,
      device: null,
      json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
      text: (body: string, status: number) => new Response(body, { status }),
    }) as never;
  const call = async (method: string, path: string, c: never, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await handleBoardRoute(path.split("?")[0]!, new Request(`http://x${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), c);
    return { status: res!.status, body: (await res!.json().catch(() => null)) as never as Record<string, unknown> };
  };

  it("GET: no orchestrator yet → paneId null, not running; refuses a path that is not a repo root", async () => {
    const db = new BoardDb(":memory:");
    expect((await call("GET", `/api/orchestrator?repo=${encodeURIComponent(repo)}`, ctx(db))).body).toEqual({ paneId: null, running: false });
    expect((await call("GET", `/api/orchestrator?repo=${encodeURIComponent(tmpdir())}`, ctx(db))).status).toBe(400);
    expect((await call("GET", "/api/orchestrator", ctx(db))).status).toBe(400);
  });

  it("GET: a live one is reported with its pane", async () => {
    const db = new BoardDb(":memory:");
    const c = ctx(db, { agents: [agent("p1", orchestratorLabel(repo), repo)] });
    expect((await call("GET", `/api/orchestrator?repo=${encodeURIComponent(repo)}`, c)).body).toEqual({ paneId: "p1", running: true });
  });

  it("POST: write-gated, validates the path, then starts", async () => {
    const db = new BoardDb(":memory:");
    expect((await call("POST", "/api/orchestrator", ctx(db, { guard: new Response("no", { status: 403 }) }), { repoPath: repo })).status).toBe(403);
    expect((await call("POST", "/api/orchestrator", ctx(db), { repoPath: tmpdir() })).status).toBe(400);
    expect((await call("POST", "/api/orchestrator", ctx(db), { repoPath: "relative" })).status).toBe(400);
    expect((await call("DELETE", "/api/orchestrator", ctx(db))).status).toBe(405);
    const ok = await call("POST", "/api/orchestrator", ctx(db), { repoPath: repo });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, paneId: "w9:p1", started: true });
  });

  it("POST: a herdr failure is a 502 with its message, not a crash", async () => {
    const db = new BoardDb(":memory:");
    const broken = { createWorkspace: async () => { throw new Error("herdr is down"); } };
    const repo2 = mkdtempSync(join(tmpdir(), "collie-orch3-"));
    mkdirSync(join(repo2, ".git"));
    const bad = await call("POST", "/api/orchestrator", ctx(db, { herdr: broken }), { repoPath: repo2 });
    expect(bad.status).toBe(502);
    expect(bad.body).toMatchObject({ ok: false, error: "herdr is down" });
  });

  it("cannot launch what it planned: the launch routes refuse its pane", async () => {
    const db = new BoardDb(":memory:");
    const a = db.createCard({ title: "a", repoPath: "/r", status: "ready" });
    const lot = db.createRun({ repoPath: "/r", cardIds: [a.id], foldInCap: 0, planned: true });
    const h = { "x-collie-pane": "w9:p1" };
    expect((await call("POST", `/api/runs/${lot.id}/launch`, ctx(db), undefined, h)).status).toBe(403);
    expect((await call("POST", "/api/runs", ctx(db), { cardIds: [a.id], foldInCap: 0 }, h)).status).toBe(403);
    expect(db.getRun(lot.id)!.launchedAt).toBeNull();
  });
});

describe("isBoardPath: what the server forwards to the board", () => {
  it("covers every route family, including the ones a prefix check used to drop", () => {
    for (const p of ["/api/cards", "/api/cards/x/start", "/api/repos/gate", "/api/board/prefs", "/api/backup", "/api/runs", "/api/runs/x/launch", "/api/phases", "/api/phases/x", "/api/roadmap", "/api/orchestrator"])
      expect(isBoardPath(p)).toBe(true);
    for (const p of ["/api/snapshot", "/api/pane/p1/reply", "/api/runsfoo", "/"]) expect(isBoardPath(p)).toBe(false);
  });
});
