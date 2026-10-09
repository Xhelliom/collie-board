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
  askOrchestratorNote,
  restartOrchestrator,
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
  const ctx = (db: BoardDb, o: { guard?: Response | null; agents?: ReturnType<typeof agent>[]; herdr?: unknown; ctx?: number } = {}) =>
    ({
      paneContext: () => o.ctx ?? null,
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
    expect((await call("GET", `/api/orchestrator?repo=${encodeURIComponent(repo)}`, ctx(db))).body).toEqual({ paneId: null, running: false, ctxPct: null, memoryUpdatedAt: null });
    expect((await call("GET", `/api/orchestrator?repo=${encodeURIComponent(tmpdir())}`, ctx(db))).status).toBe(400);
    expect((await call("GET", "/api/orchestrator", ctx(db))).status).toBe(400);
  });

  it("GET: a live one is reported with its pane", async () => {
    const db = new BoardDb(":memory:");
    const c = ctx(db, { agents: [agent("p1", orchestratorLabel(repo), repo)], ctx: 63 });
    db.putMemory(repo, "where we stand");
    const got = (await call("GET", `/api/orchestrator?repo=${encodeURIComponent(repo)}`, c)).body;
    expect(got).toMatchObject({ paneId: "p1", running: true, ctxPct: 63 });
    expect(typeof got.memoryUpdatedAt).toBe("number");
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

describe("the orchestrator's memory (ADR 0023)", () => {
  it("its start prompt carries the note, bounded, and says to write decisions as they are taken", () => {
    const p = orchestratorPrompt("/g/app", { note: "écarté : le mode coop\nprochaine question : le public", updatedAt: Date.UTC(2026, 9, 9, 12, 30) });
    expect(p).toContain("2026-10-09 12:30 UTC");
    expect(p).toContain("écarté : le mode coop");
    expect(p).toContain("POST /api/roadmap/decision");
    expect(p).toContain("UN thème à la fois");
    expect(orchestratorPrompt("/g/app", { note: "x".repeat(9000), updatedAt: 0 }).length).toBeLessThan(orchestratorPrompt("/g/app").length + 4_200);
    expect(orchestratorPrompt("/g/app")).not.toContain("<<<");
  });

  it("a fresh orchestrator is started with the note the last one left", async () => {
    const f = fakeHerdr();
    const prompts: string[] = [];
    (f.herdr as { promptAgent: (o: { text: string }) => Promise<void> }).promptAgent = async (o) => void prompts.push(o.text);
    await startOrchestrator({ herdr: f.herdr, cfg, snapshot: () => snap(), wait: noWait, memory: () => ({ note: "NOTE-DU-PRÉCÉDENT", updatedAt: 1 }) }, "/g/app");
    expect(prompts[0]).toContain("NOTE-DU-PRÉCÉDENT");
  });

  it("renew: ask prompts the running pane for its note; there is nothing to ask when none runs", async () => {
    const f = fakeHerdr();
    const deps = { herdr: f.herdr, cfg, snapshot: () => snap([agent("p1", "orchestrator-app", "/g/app")]), wait: noWait };
    expect(await askOrchestratorNote(deps, "/g/app")).toBe("p1");
    expect(f.calls).toContain("prompt p1");
    expect(await askOrchestratorNote({ ...deps, snapshot: () => snap() }, "/g/app")).toBeNull();
  });

  it("renew: restart closes the old pane, waits for it to leave the snapshot, and starts a fresh one", async () => {
    const f = fakeHerdr();
    let gone = false;
    const closed: string[] = [];
    (f.herdr as { closePane: (id: string) => Promise<void> }).closePane = async (id) => void closed.push(id);
    let polls = 0;
    const snapshot = () => {
      polls++;
      if (polls > 2) gone = true; // herdr's snapshot catches up a poll or two after the close
      return snap(gone ? [] : [agent("p1", "orchestrator-app", "/g/app")]);
    };
    const r = await restartOrchestrator({ herdr: f.herdr, cfg, snapshot, wait: noWait }, "/g/app");
    expect(closed).toEqual(["p1"]);
    expect(r).toEqual({ paneId: "w9:p1", started: true });
    expect(f.calls.indexOf("workspace orchestrator-app")).toBeGreaterThan(-1);
  });

  it("renew: never adopts the pane it just closed, even while the snapshot still lists it", async () => {
    const f = fakeHerdr();
    (f.herdr as { closePane: (id: string) => Promise<void> }).closePane = async () => {};
    const r = await restartOrchestrator({ herdr: f.herdr, cfg, snapshot: () => snap([agent("p1", "orchestrator-app", "/g/app")]), wait: noWait }, "/g/app");
    expect(r.started).toBe(true);
    expect(r.paneId).not.toBe("p1");
  });
});

describe("/api/orchestrator/memory and /renew", () => {
  const repo = mkdtempSync(join(tmpdir(), "collie-orch-mem-"));
  mkdirSync(join(repo, ".git"));
  const ctx = (db: BoardDb, agents: ReturnType<typeof agent>[] = []) =>
    ({
      db,
      herdr: fakeHerdr().herdr,
      engine: { current: () => snap(agents) },
      cfg,
      audit: { record: () => {} },
      session: "default",
      guard: () => null,
      device: null,
      json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
      text: (body: string, status: number) => new Response(body, { status }),
    }) as never;
  const call = async (method: string, path: string, c: never, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await handleBoardRoute(path.split("?")[0]!, new Request(`http://x${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), c);
    return { status: res!.status, body: (await res!.json().catch(() => null)) as never as Record<string, any> };
  };
  const q = `?repo=${encodeURIComponent(repo)}`;

  it("keeps one note per repo, last writer wins, bounded", async () => {
    const db = new BoardDb(":memory:");
    expect((await call("GET", `/api/orchestrator/memory${q}`, ctx(db))).body.memory).toBeNull();
    expect((await call("PUT", "/api/orchestrator/memory", ctx(db), { repoPath: repo, note: "first" })).status).toBe(200);
    await call("PUT", "/api/orchestrator/memory", ctx(db), { repoPath: repo, note: "second" });
    expect((await call("GET", `/api/orchestrator/memory${q}`, ctx(db))).body.memory.note).toBe("second");
    expect((await call("PUT", "/api/orchestrator/memory", ctx(db), { repoPath: repo, note: "x".repeat(4001) })).status).toBe(400);
    expect((await call("PUT", "/api/orchestrator/memory", ctx(db), { repoPath: tmpdir(), note: "x" })).status).toBe(400);
    // The agent itself writes its note: its pane header is fine here.
    expect((await call("PUT", "/api/orchestrator/memory", ctx(db), { repoPath: repo, note: "mine" }, { "x-collie-pane": "p1" })).status).toBe(200);
  });

  it("renew is the operator's gesture: ask needs a running orchestrator, a pane header is refused", async () => {
    const db = new BoardDb(":memory:");
    expect((await call("POST", "/api/orchestrator/renew", ctx(db), { repoPath: repo, step: "ask" })).status).toBe(409);
    const live = ctx(db, [agent("p1", orchestratorLabel(repo), repo)]);
    expect((await call("POST", "/api/orchestrator/renew", live, { repoPath: repo, step: "ask" })).body).toMatchObject({ ok: true, paneId: "p1" });
    expect((await call("POST", "/api/orchestrator/renew", live, { repoPath: repo, step: "ask" }, { "x-collie-pane": "p1" })).status).toBe(403);
    expect((await call("POST", "/api/orchestrator/renew", live, { repoPath: repo, step: "later" })).status).toBe(400);
    expect((await call("GET", "/api/orchestrator/renew", live)).status).toBe(405);
  });
});

describe("isBoardPath: what the server forwards to the board", () => {
  it("covers every route family, including the ones a prefix check used to drop", () => {
    for (const p of ["/api/cards", "/api/cards/x/start", "/api/repos/gate", "/api/board/prefs", "/api/backup", "/api/runs", "/api/runs/x/launch", "/api/phases", "/api/phases/x", "/api/roadmap", "/api/orchestrator"])
      expect(isBoardPath(p)).toBe(true);
    for (const p of ["/api/snapshot", "/api/pane/p1/reply", "/api/runsfoo", "/"]) expect(isBoardPath(p)).toBe(false);
  });
});
