import { describe, expect, it } from "vitest";

import type { CardView, Lot } from "@/lib/board";
import type { CardFacts } from "@/lib/project-facts";
import { liveLots, liveState } from "./lot-live";

const card = (over: Partial<CardView> = {}) => ({ id: "c1", status: "working", runtime: null, ...over }) as CardView;
const lot = (over: Partial<Lot> = {}): Lot => ({
  id: "l1", repoPath: "/r", phaseId: null, name: "Auth", position: 0, launchedAt: 1, cardIds: ["c1", "c2"], finished: false, ...over,
});
const pr = (state: "open" | "merged", url = "https://github.com/o/r/pull/1") => ({ pr: { url, state } }) as CardFacts;

describe("liveState", () => {
  it("reads each state from the card and its facts", () => {
    expect(liveState(card({ status: "ready" }), lot())).toBe("queued");
    expect(liveState(card({ status: "working" }), lot())).toBe("working");
    expect(liveState(card({ status: "review" }), lot())).toBe("review");
    expect(liveState(card({ status: "review" }), lot(), pr("open"))).toBe("pr");
    expect(liveState(card({ status: "done" }), lot())).toBe("merged");
    expect(liveState(card({ status: "review" }), lot(), pr("merged"))).toBe("merged");
    expect(liveState(card({ status: "blocked" }), lot(), pr("open"))).toBe("blocked");
    expect(liveState(card({ status: "orphaned" }), lot())).toBe("blocked");
  });

  it("a one-PR lot: a finished card waits for THE PR", () => {
    expect(liveState(card({ status: "done" }), lot({ integration: "lot" }))).toBe("review");
    expect(liveState(card({ status: "done" }), lot({ integration: "lot", prUrl: "u" }))).toBe("pr");
  });
});

describe("liveLots", () => {
  const byId = new Map([card({ id: "c1", status: "done" }), card({ id: "c2", runtime: { paneId: "w:p1" } as CardView["runtime"] })].map((c) => [c.id, c]));

  it("keeps only the launched lots not over, with progress, panes and PRs", () => {
    const lots = [lot(), lot({ id: "planned", launchedAt: null }), lot({ id: "over", finished: true })];
    const [l, ...rest] = liveLots(lots, byId, { c2: pr("open") });
    expect(rest).toEqual([]);
    expect(l!.merged).toBe(1);
    expect(l!.cards.map((c) => [c.state, c.paneId, c.prUrl])).toEqual([
      ["merged", null, null],
      ["pr", "w:p1", "https://github.com/o/r/pull/1"],
    ]);
  });

  it("drops a lot whose cards are all merged (older bridge, no `finished`)", () => {
    expect(liveLots([lot({ cardIds: ["c1"], finished: undefined })], byId)).toEqual([]);
  });
});
