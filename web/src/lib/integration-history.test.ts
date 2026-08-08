import { describe, expect, it } from "vitest";

import { integrationHistory, prLabel } from "./board-groups";
import type { BoardEvent } from "./board";

// The question this answers: "was this card's work ever actually merged?" Once the branch, the
// worktree and the pane are gone — which is what a successful cleanup means — git has nothing left
// to say, and `done` on its own never said it. The journal is the only thing that outlives all three.

let n = 0;
const ev = (type: string, payload: unknown = {}, ts = ++n): BoardEvent => ({
  id: n,
  cardId: "c1",
  type,
  payload,
  ts,
});

describe("integrationHistory", () => {
  it("is empty for a card nothing has happened to", () => {
    expect(integrationHistory([ev("card.created"), ev("card.status")])).toEqual({
      merged: null,
      pr: null,
      cleanedUp: null,
      discarded: null,
    });
  });

  it("remembers the merge and what it went into", () => {
    const got = integrationHistory([ev("card.merged", { base: "main", ahead: 3 }, 500)]);
    expect(got.merged).toEqual({ base: "main", ts: 500 });
  });

  it("keeps the PR's link but says nothing about its state", () => {
    // Deliberate: GitHub owns whether a PR is open, merged or closed. A copy here would be a second
    // truth, free to go stale the moment the bridge is not looking.
    const got = integrationHistory([ev("card.pr_opened", { url: "https://gh/o/r/pull/7" }, 900)]);
    expect(got.pr).toEqual({ url: "https://gh/o/r/pull/7", ts: 900 });
    expect(Object.keys(got.pr!)).not.toContain("state");
  });

  it("treats a cleanup as evidence the work landed, even with no merge event", () => {
    // The real case: merged by hand in a terminal, then cleaned up from the phone. Cleanup is
    // REFUSED unless nothing is left to integrate, so it happening at all proves the branch was in.
    const got = integrationHistory([ev("card.cleaned_up", { branch: "board/x" }, 700)]);
    expect(got.cleanedUp).toBe(700);
    expect(got.merged).toBeNull();
  });

  it("counts what a discard threw away", () => {
    const got = integrationHistory([ev("card.discarded", { branch: "board/x", commits: 4 }, 800)]);
    expect(got.discarded).toEqual({ commits: 4, ts: 800 });
  });

  it("keeps the LAST merge when a card was merged more than once", () => {
    const got = integrationHistory([
      ev("card.merged", { base: "main" }, 100),
      ev("card.merge_failed", { base: "main" }, 200),
      ev("card.merged", { base: "release" }, 300),
    ]);
    expect(got.merged).toEqual({ base: "release", ts: 300 });
  });
});

describe("prLabel", () => {
  it("names the PR by number", () => {
    expect(prLabel("https://github.com/o/r/pull/171")).toBe("View PR #171");
  });

  it("stays generic for anything else", () => {
    expect(prLabel("https://git.example/o/r/merge_requests/9")).toBe("View the PR");
  });
});
