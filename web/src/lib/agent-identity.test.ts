import { describe, expect, it } from "vitest";

import { agentIdentity } from "./agent-identity";
import type { AgentView } from "./types";

const pane = (p: Partial<AgentView> = {}): AgentView => ({
  paneId: "p", workspaceId: "w", workspaceLabel: "w", workspaceNumber: 1, tabId: "t", agent: "claude", status: "working", cwd: "/r/alpha", focused: false, ...p,
});
const id = (p: Partial<AgentView> = {}) => agentIdentity(pane(p), "Orchestrateur");

describe("agentIdentity", () => {
  it("a card's agent is named after its card and links to it", () => {
    expect(id({ cardId: "c1", cardTitle: "Fix login", said: "Je relance les tests." })).toMatchObject({
      name: "Fix login", role: "card", cardId: "c1", detail: "Je relance les tests.",
    });
  });

  it("a free agent says what it does; an orchestrator, its project; a terminal, nothing", () => {
    expect(id({ said: "Je lis le code." })).toMatchObject({ name: "claude", role: "free", detail: "Je lis le code." });
    expect(id()).toMatchObject({ role: "free", detail: null });
    expect(id({ workspaceLabel: "orchestrator-alpha" })).toMatchObject({ name: "Orchestrateur", role: "orch", detail: "alpha" });
    expect(id({ kind: "shell", agent: "shell", said: "x" })).toMatchObject({ role: "terminal", detail: null });
  });

  it("model and effort only when stated, effort only beside a model and only a known word", () => {
    expect(id({ model: "Opus 5.5", effort: "medium" })).toMatchObject({ model: "Opus 5.5", effort: "medium" });
    expect(id({ model: "Sonnet 5.5" })).toMatchObject({ model: "Sonnet 5.5", effort: null });
    expect(id({ model: "Opus 5.5", effort: "turbo" }).effort).toBeNull();
    expect(id({ effort: "low" })).toMatchObject({ model: null, effort: null });
  });

  it("state, its word and its age", () => {
    expect(id({ status: "blocked", statusSince: 5 })).toMatchObject({ state: "needs", word: "needs", since: 5 });
    expect(id({ status: "done" })).toMatchObject({ state: "idle", word: "done", since: null });
    expect(id({ status: "idle", peer: "dev" })).toMatchObject({ state: "idle", word: "idle", machine: "dev" });
  });
});
