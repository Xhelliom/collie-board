import { describe, expect, it } from "vitest";

import { integrationHistory, prLabel, prSentence } from "./board-groups";
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
      wrapupUnasked: null,
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

  it("remembers a closing report that was never even asked for", () => {
    // The real case: the card was filed after a restart, its agent long dead. Nothing was asked of
    // it, so the coordinator never waited on this card and never cleaned its worktree up either —
    // which is exactly what the card screen needs to say before offering the tap that does.
    const got = integrationHistory([ev("card.merged", { base: "main" }, 100), ev("wrapup.unasked", {}, 200)]);
    expect(got.wrapupUnasked).toBe(200);
  });

  it("does not confuse a report that could not be READ with one that was never asked for", () => {
    // `wrapup.failed` is the other failure: the request landed, the marker cleared, and the automatic
    // cleanup ran. Nothing is left over, so there is nothing for the operator to finish.
    const got = integrationHistory([ev("wrapup.requested", {}, 100), ev("wrapup.failed", {}, 200)]);
    expect(got.wrapupUnasked).toBeNull();
  });

  it("clears the flag once a later wrapup does get through", () => {
    const got = integrationHistory([ev("wrapup.unasked", {}, 100), ev("wrapup.requested", {}, 200)]);
    expect(got.wrapupUnasked).toBeNull();
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

describe("prSentence", () => {
  const opened = Date.parse("2026-08-24T15:00:00Z");
  const merged = Date.parse("2026-08-24T15:37:36Z");

  it("says a merged PR is merged, not that it was opened minutes ago", () => {
    // The bug this exists for: a card showed "PR opened 4m ago" about a PR merged hours earlier.
    const out = prSentence({ state: "merged", url: "https://gh/o/r/pull/1", mergedAt: merged }, opened);
    expect(out).toContain("merged");
    expect(out).not.toContain("opened");
  });

  it("distinguishes a PR closed without merging from one still open", () => {
    const closed = prSentence({ state: "closed", url: "https://gh/o/r/pull/2", mergedAt: null }, opened);
    const open = prSentence({ state: "open", url: "https://gh/o/r/pull/3", mergedAt: null }, opened);
    expect(closed).toContain("closed without merging");
    expect(closed).not.toBe(open);
    expect(open).toContain("PR opened");
  });

  it("falls back to the journal's wording when GitHub cannot be asked", () => {
    // No `gh`, no auth, no GitHub remote, offline — the honest answer is the one thing we can prove.
    expect(prSentence(null, opened)).toBe(prSentence({ state: "open", url: "u", mergedAt: null }, opened));
    expect(prSentence(null, opened)).toContain("PR opened");
  });
});
