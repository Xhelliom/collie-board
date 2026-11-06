import { describe, expect, it } from "bun:test";

import { BUILTIN_ADAPTERS } from "./adapters.ts";
import { outOfSight, reconcile } from "./cards.ts";
import { BoardDb } from "./db.ts";
import { migrateBlock, migrateToHc } from "./migrate-hc.ts";
import type { EngineSnapshot } from "./state-engine.ts";
import type { AgentStatus, AgentView } from "./types.ts";

const pane = (status: AgentStatus = "idle", extra: Partial<AgentView> = {}): AgentView => ({
  paneId: "w1:p1",
  workspaceId: "w1",
  workspaceLabel: "demo",
  workspaceNumber: 1,
  tabId: "w1:t1",
  agent: "claude",
  status,
  cwd: "/wt/carte",
  focused: false,
  kind: "agent",
  agentSessionId: "uuid-1",
  ...extra,
});

const ok = { mux: "herdr09" as const, pane: pane(), adapter: BUILTIN_ADAPTERS.claude, hcUp: true };

describe("migrateBlock — when « Migrer vers herdr-core » is offered", () => {
  it("offers it for a Claude agent at rest under 0.9 with hc up", () => {
    expect(migrateBlock(ok)).toBeNull();
    expect(migrateBlock({ ...ok, pane: pane("done") })).toBeNull();
  });

  it("says why not, one case at a time", () => {
    expect(migrateBlock({ ...ok, mux: "hc" })).toBe("not-herdr09");
    expect(migrateBlock({ ...ok, pane: undefined })).toBe("no-pane");
    expect(migrateBlock({ ...ok, adapter: BUILTIN_ADAPTERS.codex })).toBe("not-claude");
    expect(migrateBlock({ ...ok, adapter: undefined })).toBe("not-claude");
    expect(migrateBlock({ ...ok, pane: pane("idle", { agentSessionId: undefined }) })).toBe("no-session-id");
    expect(migrateBlock({ ...ok, pane: pane("working") })).toBe("busy");
    expect(migrateBlock({ ...ok, pane: pane("blocked") })).toBe("busy");
    expect(migrateBlock({ ...ok, hcUp: false })).toBe("hc-down");
  });
});

/** A Mux that records calls; `failStart` makes its agent launch throw. */
function fakeMux(tag: string, calls: string[], failStart = false) {
  let n = 0;
  return {
    async closePane(id: string) { calls.push(`${tag}.close ${id}`); },
    async createWorkspace(o: { cwd: string }) { calls.push(`${tag}.shell ${o.cwd}`); return { paneId: `${tag}-${++n}` }; },
    async createTab(ws: string, o: { cwd: string }) { calls.push(`${tag}.tab ${ws} ${o.cwd}`); return { paneId: `${tag}-${++n}` }; },
    async startAgent(o: { paneId: string; kind: string; args?: string[] }) {
      calls.push(`${tag}.start ${o.paneId} ${o.kind} ${(o.args ?? []).join(" ")}`);
      if (failStart) throw new Error("refusé");
    },
    async getAgent() { return { interactive_ready: true }; },
  } as never;
}

function setup() {
  const db = new BoardDb(":memory:");
  const card = db.createCard({ title: "carte", repoPath: "/repo", baseRef: "main", status: "ready" });
  const session = db.openSession({ cardId: card.id, paneId: "w1:p1", agentSessionId: "uuid-1", agentKind: "claude" });
  db.setStatus(card.id, "review", "test");
  return { db, card, session };
}

const snap = (agents: AgentView[]): EngineSnapshot => ({ agents, shellPanes: [], workspaces: [], tabs: [], bridge: "connected" });
const noSleep = async () => {};

describe("migrateToHc", () => {
  it("closes the 0.9 pane first, resumes the same conversation under hc, reattaches the card's session", async () => {
    const { db, card, session } = setup();
    const calls: string[] = [];
    const res = await migrateToHc({ db, herdr: fakeMux("h9", calls), hc: fakeMux("hc", calls), sessionId: session.id, pane: pane(), name: "carte", sleep: noSleep });

    expect(res).toEqual({ ok: true, paneId: "hc-1" });
    expect(calls).toEqual([
      "h9.tab w1 /wt/carte",
      "h9.close w1:p1",
      "hc.shell /wt/carte",
      "hc.start hc-1 claude --resume uuid-1",
      "h9.close h9-1",
    ]);
    const after = db.getSession(session.id)!;
    expect(after.paneId).toBe("hc-1");
    expect(after.endedAt).toBeNull();
    expect(after.agentSessionId).toBe("uuid-1");
    expect(db.listEvents(card.id).some((e) => e.type === "session.migrated")).toBe(true);

    // A herdr09 snapshot cannot show the hc terminal: the card is not orphaned for it.
    reconcile(db, snap([]), Date.now() + 3_600_000);
    expect(db.getCard(card.id)!.status).toBe("review");
    expect(db.openSessionFor(card.id)?.id).toBe(session.id);
    outOfSight.delete(session.id);
  });

  it("brings the agent back under 0.9 on the same resume when hc refuses, and says so", async () => {
    const { db, card, session } = setup();
    const calls: string[] = [];
    const res = await migrateToHc({ db, herdr: fakeMux("h9", calls), hc: fakeMux("hc", calls, true), sessionId: session.id, pane: pane(), name: "carte", sleep: noSleep });

    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ kind: "fell-back", paneId: "h9-1" });
    expect(calls).toEqual([
      "h9.tab w1 /wt/carte",
      "h9.close w1:p1",
      "hc.shell /wt/carte",
      "hc.start hc-1 claude --resume uuid-1",
      "hc.close hc-1",
      "h9.start h9-1 claude --resume uuid-1",
    ]);
    expect(db.getSession(session.id)!.paneId).toBe("h9-1");
    // Back in reconcile's sight: the 0.9 pane drives the card again.
    expect(outOfSight.has(session.id)).toBe(false);
    reconcile(db, snap([pane("working", { paneId: "h9-1" })]));
    expect(db.getCard(card.id)!.status).toBe("working");
  });

  it("touches nothing when 0.9 cannot open the spare shell the fallback needs", async () => {
    const { db, card, session } = setup();
    const calls: string[] = [];
    const herdr = { ...(fakeMux("h9", calls) as object), async createTab() { throw new Error("workspace_not_found"); } } as never;
    const res = await migrateToHc({ db, herdr, hc: fakeMux("hc", calls), sessionId: session.id, pane: pane(), name: "carte", sleep: noSleep });

    expect(res).toMatchObject({ ok: false, kind: "untouched" });
    expect(calls).toEqual([]);
    expect(db.getSession(session.id)!.paneId).toBe("w1:p1");
    expect(db.getCard(card.id)!.status).toBe("review");
  });

  it("when both engines refuse, gives the resume command and lets reconcile orphan the card", async () => {
    const { db, card, session } = setup();
    const calls: string[] = [];
    const res = await migrateToHc({ db, herdr: fakeMux("h9", calls, true), hc: fakeMux("hc", calls, true), sessionId: session.id, pane: pane(), name: "carte", sleep: noSleep });

    expect(res).toMatchObject({ ok: false, kind: "lost" });
    expect((res as { message: string }).message).toContain("claude --resume uuid-1");
    reconcile(db, snap([]), Date.now() + 3_600_000);
    expect(db.getCard(card.id)!.status).toBe("orphaned");
  });
});
