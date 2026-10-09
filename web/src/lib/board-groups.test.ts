import { describe, expect, it } from "vitest";

import { containerIds, dependencyMet, phaseProgress } from "./board-groups";
import type { CardStatus, CardView } from "./board";

function card(id: string, over: Partial<CardView> = {}): CardView {
  return {
    id,
    title: id,
    spec: null,
    rawInput: null,
    acceptance: [],
    status: "backlog",
    repoPath: null,
    baseRef: null,
    branch: null,
    workspaceId: null,
    agentKind: null,
    parentId: null,
    phaseId: null,
    duplicateOf: null,
    dependsOn: null,
    origin: null,
    originCardId: null,
    category: null,
    tag: null,
    position: 0,
    createdAt: 0,
    updatedAt: 0,
    session: null,
    runtime: null,
    sessionCount: 0,
    copilotBusy: false,
    wrapupPending: false,
    keepWorktree: false,
    autoHandoff: null,
    ...over,
  };
}

describe("containerIds (ADR 0022)", () => {
  const cards = [
    card("parent", { status: "working" }),
    card("kid-done", { parentId: "parent", status: "done" }),
    card("kid-todo", { parentId: "parent" }),
    card("orphan", { parentId: "gone" }),
    card("loose"),
  ];

  it("names the cards some other card is a sub-task of — and only those", () => {
    expect([...containerIds(cards)]).toEqual(["parent"]);
  });

  it("a sub-task whose container is missing stands alone rather than vanishing", () => {
    expect(containerIds(cards).has("orphan")).toBe(false);
  });

  it("is read off the FULL list: hiding every child by filter must not make the container a tile", () => {
    expect(containerIds(cards).has("parent")).toBe(true);
    expect(containerIds(cards.filter((c) => c.id === "parent")).has("parent")).toBe(false);
  });
});

describe("phaseProgress", () => {
  it("counts a phase's steps and the filed ones, skipping containers and archived cards", () => {
    const cards = [
      card("box"),
      card("a", { phaseId: "p1", status: "done" }),
      card("b", { phaseId: "p1", parentId: "box", status: "working" }),
      card("c", { phaseId: "p1", status: "archived" }),
      card("d", { phaseId: "p2" }),
      card("box-in-phase", { phaseId: "p1" }),
      card("kid-of-box", { parentId: "box-in-phase" }),
    ];
    const p = phaseProgress(cards, [{ id: "p1", name: "One" }, { id: "p2", name: "Two" }]);
    expect(p.get("p1")).toEqual({ name: "One", done: 1, total: 2 });
    expect(p.get("p2")).toEqual({ name: "Two", done: 0, total: 1 });
  });
});

describe("dependencyMet", () => {
  it("mirrors the bridge's gate exactly — done and archived release, everything else holds", () => {
    // A client that disagrees either greys out a button the server would honour, or offers one
    // that answers 409.
    expect(dependencyMet(card("x", { status: "done" }))).toBe(true);
    expect(dependencyMet(card("x", { status: "archived" }))).toBe(true);
    for (const s of ["backlog", "ready", "starting", "working", "blocked", "review", "orphaned"] as CardStatus[]) {
      expect(dependencyMet(card("x", { status: s }))).toBe(false);
    }
  });

  it("treats a predecessor that isn't on the board as no longer blocking", () => {
    // The bridge clears depends_on when a predecessor is deleted, so nothing waits on a ghost.
    expect(dependencyMet(undefined)).toBe(true);
  });
});
