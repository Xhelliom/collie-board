import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleBoardRoute } from "./board-routes.ts";
import { BoardDb } from "./db.ts";
import { orchestratorLabel } from "./orchestrator.ts";
import { OrchestratorNudger } from "./orchestrator-nudge.ts";
import { NotifyLog } from "./notify-log.ts";
import type { EngineSnapshot } from "./state-engine.ts";

const PANE = { "x-collie-pane": "o1" };
const repo = mkdtempSync(join(tmpdir(), "collie-auto-"));
mkdirSync(join(repo, ".git"));

const ctx = (db: BoardDb) =>
  ({
    db,
    herdr: {},
    engine: { current: () => ({ agents: [], shellPanes: [], workspaces: [], tabs: [], bridge: "connected" }) },
    cfg: {},
    audit: { record: (e: unknown) => audits.push(e) },
    session: "default",
    guard: () => null,
    device: null,
    json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
    text: (body: string, status: number) => new Response(body, { status }),
  }) as never;
const audits: unknown[] = [];

const call = async (db: BoardDb, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await handleBoardRoute(
    path.split("?")[0]!,
    new Request(`http://x${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    ctx(db),
  );
  return { status: res!.status, body: await res!.json().catch(() => null) };
};

const live = { bridge: "connected", shellPanes: [], agents: [{ paneId: "o1", workspaceLabel: orchestratorLabel(repo), cwd: repo, status: "idle" }] } as unknown as EngineSnapshot;
const flush = () => new Promise((r) => setTimeout(r, 0));

function world() {
  const db = new BoardDb(":memory:");
  const sent: string[] = [];
  const herdr = {
    getAgent: async () => ({ interactive_ready: true, agent_status: "idle" }),
    promptAgent: async (o: { text: string }) => void sent.push(o.text),
    sendPaneKeys: async () => {},
  } as never;
  const log = new NotifyLog();
  const nudger = new OrchestratorNudger(db, herdr, log);
  const card = db.createCard({ title: "a", repoPath: repo, status: "done" });
  const lot1 = db.createRun({ repoPath: repo, cardIds: [card.id], foldInCap: 0, name: "lot 1" });
  const c2 = db.createCard({ title: "b", repoPath: repo, status: "ready" });
  const lot2 = db.createRun({ repoPath: repo, cardIds: [c2.id], foldInCap: 0, name: "lot 2", planned: true });
  db.launchRun(lot1.id);
  return { db, sent, log, nudger, card, lot1, lot2 };
}
const finish = async (w: ReturnType<typeof world>) => {
  w.db.recordRunEvent(null, "run.finished", { runId: w.lot1.id });
  w.nudger.update(live);
  await flush();
};
const launch = (w: ReturnType<typeof world>, headers: Record<string, string> = PANE) => call(w.db, "POST", `/api/runs/${w.lot2.id}/launch`, undefined, headers);
const enable = (w: ReturnType<typeof world>, extra: object = {}) => call(w.db, "PUT", "/api/orchestrator/autonomy", { repoPath: repo, enabled: true, ...extra });

describe("orchestrator autonomy (ADR 0030)", () => {
  it("is off by default and the launch route refuses the orchestrator", async () => {
    const w = world();
    expect((await call(w.db, "GET", `/api/orchestrator/autonomy?repo=${repo}`)).body.autonomy).toEqual({ enabled: false, maxChain: 1, stopOnRed: true, chained: 0, armed: false });
    await finish(w);
    expect((await launch(w)).status).toBe(403);
    expect(w.db.getRun(w.lot2.id)!.launchedAt).toBeNull();
  });

  it("only the operator changes the setting: the write route refuses x-collie-pane", async () => {
    const w = world();
    expect((await call(w.db, "PUT", "/api/orchestrator/autonomy", { repoPath: repo, enabled: true }, PANE)).status).toBe(403);
    expect(w.db.autonomyOf(repo).enabled).toBe(false);
    expect((await enable(w)).status).toBe(200);
    expect((await enable(w, { maxChain: 0 })).status).toBe(400);
    expect((await enable(w, { maxChain: null })).body.autonomy.maxChain).toBeNull();
  });

  it("enabled: the end-of-lot wake lets it launch the next planned lot, once, journaled", async () => {
    const w = world();
    await enable(w);
    expect((await launch(w)).status).toBe(403); // no wake yet: never by a poll or on its own
    await finish(w);
    expect(w.sent[0]).toContain(`/api/runs/${w.lot2.id}/launch`);
    audits.length = 0;
    expect((await launch(w)).status).toBe(200);
    expect(w.db.getRun(w.lot2.id)!.launchedAt).not.toBeNull();
    expect(audits).toContainEqual(expect.objectContaining({ action: "run.launch", detail: expect.objectContaining({ autonomous: true, pane: "o1" }) }));
    expect(w.db.autonomyOf(repo)).toMatchObject({ chained: 1, armed: false });
  });

  it("validating a phase and the unplanned launch stay refused to it, enabled or not", async () => {
    const w = world();
    await enable(w);
    await finish(w);
    const phase = (await call(w.db, "POST", "/api/phases", { repoPath: repo, name: "p" })).body.phase;
    expect((await call(w.db, "POST", `/api/phases/${phase.id}/close`, {}, PANE)).status).toBe(403);
    expect((await call(w.db, "POST", "/api/runs", { cardIds: [w.card.id] }, PANE)).status).toBe(403);
  });

  it("the chain bound stops it and tells the operator; an operator launch starts the chain again", async () => {
    const w = world();
    await enable(w, { maxChain: 1 });
    w.db.spendAutonomy(repo); // no-op: not armed
    w.db.armAutonomy(repo, true);
    w.db.spendAutonomy(repo); // chained = 1
    await finish(w);
    expect(w.sent[0]).toContain("Autonomie arrêtée");
    expect(w.log.recent()[0]?.subtitle).toContain("borne est atteinte");
    expect((await launch(w)).status).toBe(403);
    expect((await launch(w, {})).status).toBe(200); // operator
    expect(w.db.autonomyOf(repo).chained).toBe(0);
  });

  it("a red gate stops it (default), unless the operator turned that bound off", async () => {
    const red = world();
    const c = red.db.runMembers(red.lot1.id)[0]!;
    red.db.setStatus(c.id, "review", "test");
    red.db.recordRunEvent(c.id, "run.gate", { runId: red.lot1.id, command: "t", ok: false });
    await enable(red);
    await finish(red);
    expect(red.sent[0]).toContain("gate ou une CI est rouge");
    expect((await launch(red)).status).toBe(403);

    await enable(red, { stopOnRed: false });
    await finish(red);
    expect(red.sent[1]).toContain("tu peux lancer UN lot");
    expect((await launch(red)).status).toBe(200);
  });

  it("turning it off disarms", async () => {
    const w = world();
    await enable(w);
    await finish(w);
    await call(w.db, "PUT", "/api/orchestrator/autonomy", { repoPath: repo, enabled: false });
    expect((await launch(w)).status).toBe(403);
  });
});
