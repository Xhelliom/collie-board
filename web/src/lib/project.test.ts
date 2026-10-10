import { describe, expect, it } from "vitest";

import type { CardView, Phase } from "@/lib/board";
import { projectOf } from "@/lib/project";

let n = 0;
const card = (o: Partial<CardView> & { id: string }): CardView =>
  ({ title: o.id, status: "backlog", parentId: null, dependsOn: null, position: n++, createdAt: n, ...o }) as CardView;

describe("projectOf", () => {
  it("counts steps, not containers, and groups steps under their phase", () => {
    const v = projectOf([
      card({ id: "p1" }),
      card({ id: "a", parentId: "p1", status: "done" }),
      card({ id: "b", parentId: "p1", status: "working" }),
      card({ id: "p2" }),
      card({ id: "c", parentId: "p2", status: "ready" }),
      card({ id: "loose", status: "backlog" }),
      card({ id: "gone", status: "archived" }),
    ]);
    expect(v.total).toBe(4);
    expect(v.done).toBe(1);
    expect(v.active).toBe(1);
    expect(v.todo).toBe(2);
    expect(v.waiting).toBe(0);
    expect(v.phases.map((p) => [p.container?.id ?? null, p.done, p.steps.length])).toEqual([
      ["p1", 1, 2],
      ["p2", 0, 1],
      [null, 0, 1],
    ]);
  });

  it("puts what needs the operator first, blocked before review", () => {
    const v = projectOf([card({ id: "o", status: "orphaned" }), card({ id: "r", status: "review" }), card({ id: "b", status: "blocked" }), card({ id: "w", status: "working" })]);
    expect(v.awaiting.map((c) => c.id)).toEqual(["b", "r", "o"]);
    expect(v.waiting).toBe(3);
  });

  it("the next step is the first ready one whose predecessor is filed", () => {
    const v = projectOf([
      card({ id: "a", status: "working" }),
      card({ id: "b", status: "ready", dependsOn: "a" }),
      card({ id: "c", status: "ready" }),
    ]);
    expect(v.next?.id).toBe("c");
    expect(projectOf([card({ id: "a", status: "done" }), card({ id: "b", status: "ready", dependsOn: "a" })]).next?.id).toBe("b");
    expect(projectOf([]).next).toBeNull();
  });

  it("a card whose container is missing stands alone", () => {
    expect(projectOf([card({ id: "x", parentId: "ghost" })]).phases[0]!.container).toBeNull();
  });
});

describe("projectOf with the phase table (ADR 0021)", () => {
  const ph = (id: string, position: number) => ({ id, repoPath: "/r", name: id, goal: "", position, roadmapItemId: null });
  const lt = (id: string, phaseId: string | null, cardIds: string[], position = 0) => ({
    id,
    repoPath: "/r",
    phaseId,
    name: id,
    position,
    launchedAt: null,
    cardIds,
  });

  it("orders phases by position, files cards by phaseId and keeps the rest under 'No phase'", () => {
    const v = projectOf(
      [card({ id: "a", phaseId: "p2" }), card({ id: "b", phaseId: "p1", status: "done" }), card({ id: "c" }), card({ id: "d", phaseId: "ghost" })],
      [ph("p2", 1), ph("p1", 0)],
    );
    expect(v.phases.map((p) => [p.key, p.steps.map((s) => s.id), p.done])).toEqual([
      ["p1", ["b"], 1],
      ["p2", ["a"], 0],
      ["loose", ["c", "d"], 0],
    ]);
  });

  it("a container is no phase once the table has rows, and is never a step", () => {
    const v = projectOf([card({ id: "box" }), card({ id: "kid", parentId: "box", phaseId: "p1" })], [ph("p1", 0)]);
    expect(v.total).toBe(1);
    expect(v.phases.map((p) => p.key)).toEqual(["p1"]);
  });

  it("puts each lot in its phase with its cards and their progress; a stray lot falls to 'No phase'", () => {
    const v = projectOf(
      [card({ id: "a", phaseId: "p1", status: "done" }), card({ id: "b", phaseId: "p1" })],
      [ph("p1", 0)],
      [lt("L1", "p1", ["a", "b", "gone"]), lt("L2", null, [])],
    );
    expect(v.phases[0]!.lots.map((l) => [l.lot.id, l.cards.length, l.done])).toEqual([["L1", 2, 1]]);
    expect(v.phases.at(-1)!.key).toBe("loose");
    expect(v.phases.at(-1)!.lots.map((l) => l.lot.id)).toEqual(["L2"]);
  });
});

describe("projectOf: milestones (ADR 0025)", () => {
  const ph = (id: string, position: number, closedAt: number | null = null): Phase => ({ id, repoPath: "/r", name: id, goal: "", position, roadmapItemId: null, closedAt });

  it("reads the headline off the open scope only: a validated phase no longer counts", () => {
    const v = projectOf(
      [
        card({ id: "d1", phaseId: "v1", status: "done" }),
        card({ id: "d2", phaseId: "v1", status: "done" }),
        card({ id: "a", phaseId: "p2", status: "done" }),
        card({ id: "b", phaseId: "p2", status: "ready" }),
      ],
      [ph("v1", 0, 1000), ph("p2", 1)],
    );
    expect([v.total, v.done, v.todo]).toEqual([2, 1, 1]);
    expect(v.phases.map((p) => p.key)).toEqual(["p2"]);
    expect(v.closed.map((p) => p.key)).toEqual(["v1"]);
    expect([v.deliveredSteps, v.closedCount]).toEqual([2, 1]);
  });

  it("lists the validated phases oldest first", () => {
    const v = projectOf([], [ph("late", 0, 3000), ph("early", 1, 1000)]);
    expect(v.closed.map((p) => p.key)).toEqual(["early", "late"]);
  });

  it("an open step filed in a validated phase is still work: counted, shown, and waiting for you", () => {
    const v = projectOf(
      [card({ id: "d", phaseId: "v1", status: "done" }), card({ id: "stray", phaseId: "v1", status: "blocked" })],
      [ph("v1", 0, 1000)],
    );
    expect(v.closed[0]!.steps.map((s) => s.id)).toEqual(["d"]);
    expect(v.total).toBe(1);
    expect(v.awaiting.map((s) => s.id)).toEqual(["stray"]);
    expect(v.phases.at(-1)!.steps.map((s) => s.id)).toEqual(["stray"]);
  });

  it("everything validated: nothing in progress, but what was delivered is kept", () => {
    const v = projectOf([card({ id: "d", phaseId: "v1", status: "done" })], [ph("v1", 0, 1000)]);
    expect([v.total, v.done, v.deliveredSteps]).toEqual([0, 0, 1]);
  });

  it("keeps an old dictation as a section of its own once a phase exists, so it can be validated alone", () => {
    const v = projectOf(
      [
        card({ id: "Dictation" }),
        card({ id: "a", parentId: "Dictation", status: "done" }),
        card({ id: "free", status: "done" }),
      ],
      [{ id: "P1", repoPath: "/r", name: "P1", goal: "", position: 0, roadmapItemId: null, closedAt: null } as never],
    );
    expect(v.phases.map((p) => [p.key, p.container?.id ?? null, p.steps.map((s) => s.id)])).toEqual([
      ["P1", null, []],
      ["Dictation", "Dictation", ["a"]],
      ["loose", null, ["free"]],
    ]);
  });
});

