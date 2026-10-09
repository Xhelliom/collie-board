import { describe, expect, it } from "vitest";

import type { CardView } from "@/lib/board";
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
