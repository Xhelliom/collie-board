import { describe, expect, it } from "vitest";

import { boardEntries, dependencyMet, entryStatus, groupOpenByDefault } from "./board-groups";
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
    duplicateOf: null,
    dependsOn: null,
    position: 0,
    createdAt: 0,
    updatedAt: 0,
    session: null,
    runtime: null,
    sessionCount: 0,
    copilotBusy: false,
    ...over,
  };
}

describe("boardEntries", () => {
  it("leaves an ordinary card alone — grouping is the exception, not the new default", () => {
    const entries = boardEntries([card("a"), card("b")]);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.kind === "card")).toBe(true);
  });

  it("folds sub-tasks into their container and does not render them twice", () => {
    const entries = boardEntries([
      card("parent"),
      card("kid1", { parentId: "parent" }),
      card("kid2", { parentId: "parent" }),
      card("loose"),
    ]);

    expect(entries.map((e) => (e.kind === "group" ? e.container.id : e.card.id))).toEqual([
      "parent",
      "loose",
    ]);
    const group = entries[0]!;
    expect(group.kind === "group" && group.children.map((c) => c.id)).toEqual(["kid1", "kid2"]);
  });

  it("keeps the server's order inside a group — a chain read backwards is worse than useless", () => {
    const entries = boardEntries([
      card("p"),
      card("first", { parentId: "p" }),
      card("second", { parentId: "p", dependsOn: "first" }),
      card("third", { parentId: "p", dependsOn: "second" }),
    ]);
    const group = entries[0]!;
    expect(group.kind === "group" && group.children.map((c) => c.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("stands an orphaned sub-task alone rather than losing it", () => {
    // Its container was archived, so it is absent from the list the board renders.
    const entries = boardEntries([card("kid", { parentId: "gone" })]);
    expect(entries).toEqual([{ kind: "card", card: expect.objectContaining({ id: "kid" }) }]);
  });

  it("places a group by its CONTAINER's column, not by its children's", () => {
    // This is what the derived status is for: the group lands where attention is needed.
    const entries = boardEntries([
      card("p", { status: "blocked" }),
      card("kid", { parentId: "p", status: "done" }),
    ]);
    expect(entryStatus(entries[0]!)).toBe("blocked");
  });
});

describe("groupOpenByDefault", () => {
  it("opens in the columns where you act, closes in the ones where you triage", () => {
    // Hiding a blocked sub-task behind a chevron puts a tap on the most urgent thing on the board.
    for (const s of ["blocked", "review", "working", "starting", "orphaned"] as CardStatus[]) {
      expect(groupOpenByDefault(s)).toBe(true);
    }
    // Five rows for one dictation is the mess this feature exists to clean up.
    for (const s of ["backlog", "ready", "done"] as CardStatus[]) {
      expect(groupOpenByDefault(s)).toBe(false);
    }
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
