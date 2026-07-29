import { describe, expect, it } from "bun:test";

import { BoardDb } from "./db.ts";
import type { EngineSnapshot } from "./state-engine.ts";
import type { AgentStatus, AgentView } from "./types.ts";
import { WrapupCoordinator, isPendingWrapup, wrapupPrompt } from "./wrapup.ts";

// The wrapup is the last thing an agent is asked before its card is filed. It runs on a card that has
// ALREADY stopped moving, so nothing here may resurrect it — and it must give up rather than sit on a
// marker forever, because the marker is what holds the copilot's review back.

function db(): BoardDb {
  return new BoardDb(":memory:");
}

function pane(paneId: string, status: AgentStatus): AgentView {
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
  };
}

function snapshot(panes: AgentView[], bridge: EngineSnapshot["bridge"] = "connected"): EngineSnapshot {
  return { agents: panes, shellPanes: [], workspaces: [], tabs: [], bridge };
}

/** A card filed as done, its session closed, with a wrapup requested `ago` ms ago. */
function pending(store: BoardDb, ago: number, now: number) {
  const card = store.createCard({ title: "x", status: "done" });
  const session = store.openSession({ cardId: card.id, paneId: "w1:p1" });
  store.closeSession(session.id, "done");
  store.patchSession(session.id, { handoffRequestedAt: now - ago });
  return { card, sessionId: session.id };
}

describe("wrapupPrompt", () => {
  it("asks for a verdict on each acceptance criterion — the part a diff cannot show", () => {
    const prompt = wrapupPrompt({
      title: "add the diff view",
      spec: "render --stat on the card",
      acceptance: ["renders --stat", "taps into a file diff"],
    } as never);
    expect(prompt).toContain("render --stat on the card");
    expect(prompt).toContain("- renders --stat");
    expect(prompt).toContain("- taps into a file diff");
    expect(prompt).toContain("met, partly met, or not met");
    expect(prompt).toContain("What you did NOT do");
  });

  it("falls back to the title, and drops the per-criterion question when there are none", () => {
    const prompt = wrapupPrompt({ title: "fix the drawer", spec: null, acceptance: [] } as never);
    expect(prompt).toContain("fix the drawer");
    expect(prompt).not.toContain("met, partly met, or not met");
  });
});

describe("isPendingWrapup", () => {
  const base = { id: "s1", cardId: "c1", paneId: "w1:p1" } as never;

  it("is a CLOSED session that still asks for a note — nothing else can produce that", () => {
    expect(isPendingWrapup({ ...(base as object), endedAt: 5, handoffRequestedAt: 1 } as never)).toBe(true);
  });

  it("is not an open session mid-handoff, nor a closed one that has been collected", () => {
    // An open session with the marker set is a HANDOFF in flight — a different sequence entirely.
    expect(isPendingWrapup({ ...(base as object), endedAt: null, handoffRequestedAt: 1 } as never)).toBe(false);
    expect(isPendingWrapup({ ...(base as object), endedAt: 5, handoffRequestedAt: null } as never)).toBe(false);
  });
});

describe("WrapupCoordinator", () => {
  it("gives up on a note that never came, rather than holding the review back forever", () => {
    const now = 10_000_000;
    const store = db();
    const { card, sessionId } = pending(store, 31 * 60 * 1000, now);

    new WrapupCoordinator(store, () => now).update(snapshot([pane("w1:p1", "idle")]));

    expect(store.getSession(sessionId)!.handoffRequestedAt).toBeNull();
    expect(store.listEvents(card.id).some((e) => e.type === "wrapup.expired")).toBe(true);
  });

  it("does not act on the idle the agent was in when we prompted it", () => {
    const now = 10_000_000;
    const store = db();
    const { sessionId } = pending(store, 1_000, now);

    new WrapupCoordinator(store, () => now).update(snapshot([pane("w1:p1", "idle")]));

    expect(store.getSession(sessionId)!.handoffRequestedAt).toBe(now - 1_000);
  });

  it("waits while the agent is BLOCKED — a question is not a finished note", () => {
    const now = 10_000_000;
    const store = db();
    const { sessionId } = pending(store, 60_000, now);

    new WrapupCoordinator(store, () => now).update(snapshot([pane("w1:p1", "blocked")]));

    expect(store.getSession(sessionId)!.handoffRequestedAt).toBe(now - 60_000);
  });

  it("IGNORES a disconnected snapshot — a socket blip must not expire a pending wrapup", () => {
    const now = 10_000_000;
    const store = db();
    const { sessionId } = pending(store, 31 * 60 * 1000, now);

    new WrapupCoordinator(store, () => now).update(snapshot([], "disconnected"));

    expect(store.getSession(sessionId)!.handoffRequestedAt).toBe(now - 31 * 60 * 1000);
  });

  it("never reopens the card it is reporting on", () => {
    const now = 10_000_000;
    const store = db();
    const { card } = pending(store, 31 * 60 * 1000, now);

    new WrapupCoordinator(store, () => now).update(snapshot([pane("w1:p1", "idle")]));

    expect(store.getCard(card.id)!.status).toBe("done");
    expect(store.openSessionFor(card.id)).toBeNull();
  });
});
