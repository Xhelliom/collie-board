import { describe, expect, it } from "bun:test";

import { cardViews, reconcile, reconcileOne } from "./cards.ts";
import { parseCardBody } from "./board-routes.ts";
import { BoardDb, type Card, type CardSession } from "./db.ts";
import type { EngineSnapshot } from "./state-engine.ts";
import type { AgentStatus, AgentView } from "./types.ts";

// The board's whole point is that a card outlives the pane that worked on it, so these tests are
// mostly about the two directions of that: a pane that disappears must orphan (not lose) its card,
// and a live pane must drive its card's column without any extra plumbing.

function db(): BoardDb {
  return new BoardDb(":memory:");
}

function pane(paneId: string, status: AgentStatus, extra: Partial<AgentView> = {}): AgentView {
  return {
    paneId,
    workspaceId: "w1",
    workspaceLabel: "demo",
    workspaceNumber: 1,
    tabId: "w1:t1",
    agent: "claude",
    status,
    cwd: "/repo",
    focused: false,
    kind: "agent",
    ...extra,
  };
}

function snapshot(panes: AgentView[], bridge: EngineSnapshot["bridge"] = "connected"): EngineSnapshot {
  return { agents: panes, shellPanes: [], workspaces: [], tabs: [], bridge };
}

describe("BoardDb", () => {
  it("round-trips a card, including its JSON acceptance list", () => {
    const store = db();
    const card = store.createCard({
      title: "add the diff view",
      spec: "# spec",
      acceptance: ["renders --stat", "taps into a file diff"],
      repoPath: "/repo",
      baseRef: "main",
    });
    const back = store.getCard(card.id)!;
    expect(back.title).toBe("add the diff view");
    expect(back.acceptance).toEqual(["renders --stat", "taps into a file diff"]);
    expect(back.status).toBe("backlog");
    expect(back.repoPath).toBe("/repo");
  });

  it("keeps archived cards out of the board list but not out of the database", () => {
    const store = db();
    const a = store.createCard({ title: "live" });
    const b = store.createCard({ title: "gone", status: "archived" });
    expect(store.listCards().map((c) => c.id)).toEqual([a.id]);
    expect(store.listCards({ includeArchived: true }).length).toBe(2);
    expect(store.getCard(b.id)).not.toBeNull();
  });

  it("journals every status change with its reason", () => {
    const store = db();
    const card = store.createCard({ title: "x" });
    store.setStatus(card.id, "working", "agent working");
    const types = store.listEvents(card.id).map((e) => e.type);
    expect(types).toContain("card.status");
    const evt = store.listEvents(card.id).find((e) => e.type === "card.status")!;
    expect(evt.payload).toEqual({ from: "backlog", to: "working", reason: "agent working" });
  });

  it("setStatus to the current status is a no-op — no duplicate journal entries", () => {
    const store = db();
    const card = store.createCard({ title: "x", status: "working" });
    store.setStatus(card.id, "working", "agent working");
    expect(store.listEvents(card.id).filter((e) => e.type === "card.status")).toHaveLength(0);
  });

  it("keeps at most one open session per card and chains them oldest-first", () => {
    const store = db();
    const card = store.createCard({ title: "x" });
    const first = store.openSession({ cardId: card.id, paneId: "w1:p1" });
    store.closeSession(first.id, "handoff");
    const second = store.openSession({ cardId: card.id, paneId: "w1:p2" });
    expect(store.openSessionFor(card.id)!.id).toBe(second.id);
    expect(store.listSessions(card.id).map((s) => s.paneId)).toEqual(["w1:p1", "w1:p2"]);
    expect(store.listOpenSessions().map((s) => s.id)).toEqual([second.id]);
  });

  it("closing an already-closed session does not rewrite its outcome", () => {
    const store = db();
    const card = store.createCard({ title: "x" });
    const s = store.openSession({ cardId: card.id, paneId: "w1:p1" });
    store.closeSession(s.id, "handoff");
    store.closeSession(s.id, "lost");
    expect(store.getSession(s.id)!.outcome).toBe("handoff");
  });

  it("deleteCard takes its sessions, reviews and journal with it", () => {
    const store = db();
    const card = store.createCard({ title: "x" });
    const s = store.openSession({ cardId: card.id, paneId: "w1:p1" });
    store.createReview({ cardId: card.id, sessionId: s.id, verdict: "complete" });
    store.deleteCard(card.id);
    expect(store.getCard(card.id)).toBeNull();
    expect(store.listSessions(card.id)).toEqual([]);
    expect(store.listReviews(card.id)).toEqual([]);
    expect(store.listEvents(card.id)).toEqual([]);
  });

});

describe("reconcileOne", () => {
  const card = (status: Card["status"]): Card => ({
    id: "c1",
    title: "x",
    spec: null,
    rawInput: null,
    acceptance: [],
    status,
    repoPath: null,
    baseRef: null,
    branch: null,
    workspaceId: null,
    agentKind: null,
    position: 0,
    createdAt: 0,
    updatedAt: 0,
  });
  const session = (startedAt: number, paneId: string | null = "w1:p1"): CardSession => ({
    id: "s1",
    cardId: "c1",
    paneId,
    agentSessionId: null,
    agentKind: null,
    ctxTokens: null,
    ctxPct: null,
    handoffMd: null,
    outcome: null,
    startedAt,
    endedAt: null,
  });

  it("holds off orphaning inside the grace window — the pane may just not be in the snapshot yet", () => {
    expect(reconcileOne(card("starting"), session(1_000), undefined, 5_000)).toBeNull();
  });

  it("orphans once the grace window has passed", () => {
    expect(reconcileOne(card("working"), session(0), undefined, 60_000)).toEqual({ kind: "orphan" });
  });

  it("never re-orphans an already-orphaned card", () => {
    expect(reconcileOne(card("orphaned"), session(0), undefined, 60_000)).toBeNull();
  });

  it("never orphans a session that has no pane id yet", () => {
    expect(reconcileOne(card("starting"), session(0, null), undefined, 60_000)).toBeNull();
  });

  it("maps agent status onto the column: working/idle → working, blocked → blocked, done → review", () => {
    expect(reconcileOne(card("starting"), session(0), pane("w1:p1", "working"), 60_000))
      .toEqual({ kind: "column", status: "working" });
    expect(reconcileOne(card("blocked"), session(0), pane("w1:p1", "idle"), 60_000))
      .toEqual({ kind: "column", status: "working" });
    expect(reconcileOne(card("working"), session(0), pane("w1:p1", "blocked"), 60_000))
      .toEqual({ kind: "column", status: "blocked" });
    expect(reconcileOne(card("working"), session(0), pane("w1:p1", "done"), 60_000))
      .toEqual({ kind: "column", status: "review" });
  });

  it("leaves the column alone on an unknown agent status", () => {
    expect(reconcileOne(card("working"), session(0), pane("w1:p1", "unknown"), 60_000)).toBeNull();
  });
});

describe("reconcile", () => {
  it("orphans a card whose pane vanished, and marks its session lost", () => {
    const store = db();
    const card = store.createCard({ title: "x", status: "working" });
    const s = store.openSession({ cardId: card.id, paneId: "w1:p1" });
    reconcile(store, snapshot([]), s.startedAt + 60_000);
    expect(store.getCard(card.id)!.status).toBe("orphaned");
    expect(store.getSession(s.id)!.outcome).toBe("lost");
    expect(store.openSessionFor(card.id)).toBeNull();
  });

  it("IGNORES a disconnected snapshot — a socket blip must not orphan the whole board", () => {
    const store = db();
    const card = store.createCard({ title: "x", status: "working" });
    const s = store.openSession({ cardId: card.id, paneId: "w1:p1" });
    reconcile(store, snapshot([], "disconnected"), s.startedAt + 60_000);
    expect(store.getCard(card.id)!.status).toBe("working");
    expect(store.getSession(s.id)!.outcome).toBeNull();
  });

  it("moves a card into its pane's column without being asked", () => {
    const store = db();
    const card = store.createCard({ title: "x", status: "starting" });
    store.openSession({ cardId: card.id, paneId: "w1:p1" });
    reconcile(store, snapshot([pane("w1:p1", "blocked")]));
    expect(store.getCard(card.id)!.status).toBe("blocked");
  });

  it("copies the agent's own session id onto the card session so the transcript stays findable", () => {
    const store = db();
    const card = store.createCard({ title: "x", status: "working" });
    const s = store.openSession({ cardId: card.id, paneId: "w1:p1" });
    reconcile(store, snapshot([pane("w1:p1", "working", { agentSessionId: "uuid-1" })]));
    expect(store.getSession(s.id)!.agentSessionId).toBe("uuid-1");
  });
});

describe("cardViews", () => {
  it("merges live pane state into the card, and reports null runtime when there is no pane", () => {
    const store = db();
    const live = store.createCard({ title: "live", status: "working" });
    store.openSession({ cardId: live.id, paneId: "w1:p1" });
    const idle = store.createCard({ title: "backlog" });

    const views = cardViews(store, snapshot([pane("w1:p1", "blocked")]));
    const liveView = views.find((v) => v.id === live.id)!;
    const idleView = views.find((v) => v.id === idle.id)!;

    expect(liveView.runtime).toEqual({
      paneId: "w1:p1",
      agent: "claude",
      agentStatus: "blocked",
      cwd: "/repo",
      workspaceId: "w1",
      workspaceLabel: "demo",
    });
    expect(liveView.sessionCount).toBe(1);
    expect(idleView.runtime).toBeNull();
    expect(idleView.session).toBeNull();
  });
});

describe("parseCardBody", () => {
  it("requires a non-blank title on create", () => {
    expect(parseCardBody({}, { requireTitle: true })).toEqual({ ok: false, error: "title required" });
    expect(parseCardBody({ title: "   " }, { requireTitle: true })).toEqual({
      ok: false,
      error: "title required",
    });
  });

  it("accepts an empty patch", () => {
    expect(parseCardBody({}, { requireTitle: false })).toEqual({ ok: true, value: {} });
  });

  it("rejects an unknown status rather than writing it", () => {
    expect(parseCardBody({ status: "in-progress" }, { requireTitle: false })).toEqual({
      ok: false,
      error: "bad status",
    });
  });

  it("rejects a non-string acceptance entry", () => {
    expect(parseCardBody({ acceptance: ["ok", 3] }, { requireTitle: false })).toEqual({
      ok: false,
      error: "bad acceptance",
    });
  });

  it("normalises blank optional strings to null and trims the rest", () => {
    const parsed = parseCardBody({ title: " ship ", spec: "  ", repoPath: " /repo " }, { requireTitle: true });
    expect(parsed).toEqual({ ok: true, value: { title: "ship", spec: null, repoPath: "/repo" } });
  });

  it("ignores unknown keys instead of writing them", () => {
    expect(parseCardBody({ title: "x", paneId: "w1:p1" }, { requireTitle: true })).toEqual({
      ok: true,
      value: { title: "x" },
    });
  });
});
