import { describe, expect, it } from "bun:test";

import type { CardView } from "./cards.ts";
import { cardsSummary } from "./cards-summary.ts";

const NOW = 100 * 24 * 3600 * 1000;
const card = (id: string, extra: Partial<CardView> = {}): CardView =>
  ({ id, title: id, status: "done", spec: null, acceptance: [], rawInput: null, repoPath: "/r", parentId: null, dependsOn: null, phaseId: null, updatedAt: NOW - 1000, ...extra }) as CardView;
const ids = (cards: { id: string }[]) => cards.map((c) => c.id).sort();

describe("cardsSummary", () => {
  it("keeps the finished cards open work still needs, and only those", () => {
    // Ten old done steps crowd the newest-five slot, so every other one is kept for a reason of its own.
    const filler = Array.from({ length: 10 }, (_, i) => card(`f${i}`, { updatedAt: NOW - i }));
    const old = { updatedAt: 0 };
    const cards = [
      ...filler,
      card("dep", old), // what an unfinished card waits on
      card("box", old), // a finished container with an unfinished step
      card("sib", { ...old, parentId: "box" }), // that step's finished sibling
      card("live", { status: "ready", parentId: "box", dependsOn: "dep" }),
      card("open", { ...old, phaseId: "p-open" }), // a step of an open phase
      card("shut", { ...old, phaseId: "p-shut" }), // a step of a validated phase: gone
      card("lonebox", old), // a finished container whose steps are all gone: gone with them
      card("lonestep", { ...old, parentId: "lonebox" }),
      card("openbox", { status: "backlog" }), // an unfinished container whose steps are all done
      card("kid", { ...old, parentId: "openbox" }),
    ];
    const { cards: kept, counts } = cardsSummary(cards, new Set(["p-open"]), NOW);
    expect(ids(kept)).toEqual(["box", "dep", "f0", "f1", "f2", "f3", "f4", "kid", "live", "open", "openbox", "sib"]);
    expect(counts.delivered).toBe(10); // the filler: the rest is older than a week
    // Containers are not steps — "box" and "lonebox" are counted by nothing per repo.
    expect(counts.doneByRepo).toEqual({ "/r": 16 });
    expect(counts.doneByPhase).toEqual({ "p-open": 1, "p-shut": 1 });
  });

  it("keeps the newest five per repo, not five overall", () => {
    const cards = ["/a", "/b"].flatMap((r) => Array.from({ length: 6 }, (_, i) => card(`${r}${i}`, { repoPath: r })));
    expect(cardsSummary(cards, new Set(), NOW).cards).toHaveLength(10);
  });
});
