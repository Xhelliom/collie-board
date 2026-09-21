import { describe, expect, it } from "bun:test";

import { AutoHandoff } from "./auto-handoff.ts";
import { BoardDb, isAutoHandoffOffered, PROMPT_CACHE_TTL_MS } from "./db.ts";
import type { EngineSnapshot } from "./state-engine.ts";
import type { AgentStatus, AgentView } from "./types.ts";

const MIN = 60 * 1000;

function pane(status: AgentStatus, agent = "claude"): AgentView {
  return {
    paneId: "w1:p1",
    workspaceId: "w1",
    workspaceLabel: "demo",
    workspaceNumber: 1,
    tabId: "w1:t1",
    agent,
    status,
    cwd: "/repo",
    focused: false,
  };
}

const snap = (p: AgentView): EngineSnapshot => ({ agents: [p], shellPanes: [], workspaces: [], tabs: [], bridge: "connected" });

function setup(agent = "claude", boardOn = true) {
  const store = new BoardDb(":memory:");
  store.setAutoHandoff(boardOn);
  const card = store.createCard({ title: "x", status: "working", repoPath: "/repo" });
  const session = store.openSession({ cardId: card.id, paneId: "w1:p1" });
  let t = 1_000_000;
  const prompts: string[] = [];
  // The prompt never returns, so the test sees the marker exactly as the ask left it.
  const herdr = { promptAgent: () => (prompts.push("prompt"), new Promise(() => {})) };
  const auto = new AutoHandoff(store, herdr as never, () => t);
  const tick = (status: AgentStatus, advance = 0) => {
    t += advance;
    auto.update(snap(pane(status, agent)));
  };
  const marker = () => store.getSession(session.id)!.autoHandoffAt;
  const idleIntoWindow = () => {
    tick("working");
    tick("idle");
    tick("idle", 4.5 * MIN);
  };
  return { store, card, session, tick, prompts, marker, idleIntoWindow };
}

describe("AutoHandoff — asks for the note inside the cache window, and only there", () => {
  it("asks once the session has been quiet for four minutes", () => {
    const { tick, prompts, marker } = setup();
    tick("working");
    tick("idle");
    tick("idle", 3 * MIN);
    expect(prompts).toEqual([]);
    tick("idle", 1.5 * MIN);
    expect(prompts).toEqual(["prompt"]);
    expect(marker()).not.toBeNull();
  });

  it("never asks once the cache is gone — that prompt would pay for the reload it exists to avoid", () => {
    const { tick, prompts } = setup();
    tick("working");
    tick("idle");
    tick("idle", 6 * MIN);
    expect(prompts).toEqual([]);
  });

  it("never asks a pane it never saw working, nor a non-Claude agent", () => {
    const unseen = setup();
    unseen.tick("idle");
    unseen.tick("idle", 4.5 * MIN);
    expect(unseen.prompts).toEqual([]);

    const codex = setup("codex");
    codex.tick("working");
    codex.tick("idle");
    codex.tick("idle", 4.5 * MIN);
    expect(codex.prompts).toEqual([]);
  });

  it("is off by default, and a card's own choice wins over the board's either way", () => {
    expect(new BoardDb(":memory:").autoHandoff()).toBe(false);

    const forced = setup("claude", false);
    forced.store.patchCard(forced.card.id, { autoHandoff: "on" });
    forced.idleIntoWindow();
    expect(forced.prompts).toEqual(["prompt"]);

    const refused = setup("claude", true);
    refused.store.patchCard(refused.card.id, { autoHandoff: "off" });
    refused.idleIntoWindow();
    expect(refused.prompts).toEqual([]);

    const followsBoard = setup("claude", false);
    followsBoard.idleIntoWindow();
    expect(followsBoard.prompts).toEqual([]);
  });

  it("drops a standing offer when the conversation goes on without it", () => {
    const { store, session, tick, marker } = setup();
    store.patchSession(session.id, { handoffMd: "note", autoHandoffAt: 1_000_000 - 10 * MIN });
    tick("idle");
    expect(marker()).not.toBeNull();
    tick("working");
    expect(marker()).toBeNull();
    expect(store.getSession(session.id)!.handoffMd).toBe("note");
  });
});

describe("isAutoHandoffOffered", () => {
  it("offers a stored note only once the prompt cache has gone cold", () => {
    const s = { autoHandoffAt: 0, handoffMd: "note" } as Parameters<typeof isAutoHandoffOffered>[0];
    expect(isAutoHandoffOffered(s, PROMPT_CACHE_TTL_MS - 1)).toBe(false);
    expect(isAutoHandoffOffered(s, PROMPT_CACHE_TTL_MS)).toBe(true);
    expect(isAutoHandoffOffered({ ...s, handoffMd: null }, PROMPT_CACHE_TTL_MS)).toBe(false);
  });
});
