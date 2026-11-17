// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { CardView, Lot, Phase } from "@/lib/board";
import { currentPhases, type ProjectPhase } from "@/lib/project";

const step = (status: string) => ({ id: status, status }) as CardView;
const phase = (key: string, statuses: string[], lotIds: string[] = []): ProjectPhase => ({
  key,
  title: key,
  goal: "",
  phase: { id: key } as Phase,
  container: null,
  steps: statuses.map(step),
  done: statuses.filter((s) => s === "done").length,
  lots: lotIds.map((id) => ({ lot: { id } as Lot, cards: [], done: 0 })),
});
const keys = (ps: ProjectPhase[]) => ps.map((p) => p.key);

describe("currentPhases", () => {
  const a = phase("a", ["done", "ready"], ["la"]);
  const b = phase("b", ["ready"], ["lb"]);
  const c = phase("c", ["ready"], ["lc"]);

  it("details every phase a lot runs in, in the roadmap's order", () => {
    expect(keys(currentPhases([a, b, c], new Set(["lc", "la"])))).toEqual(["a", "c"]);
  });

  it("a card at work brings its phase up too", () => {
    expect(keys(currentPhases([a, phase("w", ["working"]), c], new Set(["lc"])))).toEqual(["w", "c"]);
  });

  it("one running lot: that phase alone", () => {
    expect(keys(currentPhases([a, b, c], new Set(["lb"])))).toEqual(["b"]);
  });

  it("nothing running: the first with work left, else the first to validate, else none", () => {
    expect(keys(currentPhases([phase("v", ["done"]), b], new Set()))).toEqual(["b"]);
    expect(keys(currentPhases([phase("v", ["done"])], new Set()))).toEqual(["v"]);
    expect(currentPhases([], new Set())).toEqual([]);
  });
});
