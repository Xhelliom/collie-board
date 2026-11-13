import { describe, expect, it } from "bun:test";

import { BoardDb, type BoardEvent } from "./db.ts";
import type { GitRunner, PrStatus } from "./git.ts";
import { followsOf } from "./pr-follow.ts";
import { MIN_READ_MS, forgetPrRead, notePrOutcome, openPrs, openPrsOf, prGesture } from "./prs.ts";

let n = 0;
const ev = (cardId: string, type: string, payload: unknown = {}): BoardEvent => ({
  id: ++n,
  cardId,
  type,
  payload,
  ts: n,
});

const pr = (state: PrStatus["state"]): PrStatus => ({
  state,
  url: "https://gh/o/r/pull/1",
  mergedAt: state === "merged" ? 9 : null,
  conflicting: false,
  mergeable: false,
  createdAt: null,
});

describe("the open-PR list is the journal, folded", () => {
  it("keeps a card whose PR nobody has seen land, and drops the ones that are over", () => {
    const open = openPrsOf([
      ev("a", "card.pr_opened", { url: "https://gh/o/r/pull/1" }),
      ev("b", "card.pr_opened", { url: "https://gh/o/r/pull/2" }),
      ev("c", "card.pr_opened", { url: "https://gh/o/r/pull/3" }),
      ev("b", "card.pr_merged"),
      ev("c", "card.pr_closed"),
    ]);
    expect([...open.keys()]).toEqual(["a"]);
    expect(open.get("a")?.url).toBe("https://gh/o/r/pull/1");
  });

  it("puts a card back when it opens a PR again after its last one was over", () => {
    const open = openPrsOf([ev("a", "card.pr_opened"), ev("a", "card.pr_closed"), ev("a", "card.pr_opened")]);
    expect(open.has("a")).toBe(true);
  });

  it("lists a PR the agent opened itself (only `pr_updated`), and keeps the opening time of one the board opened", () => {
    const open = openPrsOf([ev("a", "card.pr_updated", { url: "u-a" }), ev("b", "card.pr_opened"), ev("b", "card.pr_updated")]);
    expect(open.get("a")?.url).toBe("u-a");
    expect(open.get("b")?.ts).toBe(n - 1);
  });
});

describe("listPrEvents reads each card's current PR only", () => {
  it("drops the earlier episodes, and folds exactly as the whole history would", () => {
    const db = new BoardDb(":memory:");
    for (const [card, type] of [
      ["a", "card.pr_opened"], ["a", "card.pr_follow"], ["a", "card.pr_closed"],
      ["a", "card.pr_opened"], ["a", "card.automerge_armed"],
      ["b", "card.pr_merged"], // no PR opened: nothing to fold
      ["c", "card.pr_opened"], ["c", "card.pr_merged"],
      ["a", "card.status"],
    ] as const) db.recordEvent(card, type);
    const read = db.listPrEvents();
    expect(read.map((e) => `${e.cardId}:${e.type}`)).toEqual(["a:card.pr_opened", "a:card.automerge_armed", "c:card.pr_opened", "c:card.pr_merged"]);
    const all = ["a", "b", "c"].flatMap((id) => db.listEvents(id, 1000)).sort((x, y) => x.id - y.id);
    expect(openPrsOf(read)).toEqual(openPrsOf(all));
    expect(followsOf(read)).toEqual(followsOf(all));
  });

  it("keeps a PR the agent opened itself, and a follow taken before a re-push", () => {
    const db = new BoardDb(":memory:");
    for (const [card, type] of [
      ["d", "card.pr_follow"], // before any PR: nothing to attach to
      ["d", "card.pr_updated"], ["d", "card.pr_follow"], ["d", "card.pr_updated"], // agent's own PR, re-pushed
      ["e", "card.pr_opened"], ["e", "card.pr_updated"], ["e", "card.pr_follow"], ["e", "card.pr_updated"],
      ["f", "card.pr_opened"], ["f", "card.pr_follow"], ["f", "card.pr_opened"], ["f", "card.automerge_armed"],
    ] as const) db.recordEvent(card, type);
    const read = db.listPrEvents();
    const all = ["d", "e", "f"].flatMap((id) => db.listEvents(id, 1000)).sort((x, y) => x.id - y.id);
    expect(read.map((e) => `${e.cardId}:${e.type}`)).toEqual([
      "d:card.pr_updated", "d:card.pr_follow", "d:card.pr_updated",
      "e:card.pr_opened", "e:card.pr_updated", "e:card.pr_follow", "e:card.pr_updated",
      "f:card.pr_opened", "f:card.automerge_armed",
    ]);
    expect(openPrsOf(read)).toEqual(openPrsOf(all));
    expect(followsOf(read)).toEqual(followsOf(all));
    expect([...followsOf(read).keys()].sort()).toEqual(["d", "e"]);
  });
});

describe("notePrOutcome", () => {
  const setup = () => {
    const db = new BoardDb(":memory:");
    const card = db.createCard({ title: "t", repoPath: "/repo", baseRef: "main" });
    db.recordEvent(card.id, "card.pr_opened", { url: "https://gh/o/r/pull/1" });
    return { db, id: card.id };
  };
  const outcomes = (db: BoardDb, id: string) =>
    db.listEvents(id).filter((e) => e.type === "card.pr_merged" || e.type === "card.pr_closed");

  it("journals a merge once, however often the card screen reads it afterwards", () => {
    const { db, id } = setup();
    notePrOutcome(db, id, pr("merged"));
    notePrOutcome(db, id, pr("merged"));
    expect(outcomes(db, id)).toHaveLength(1);
  });

  it("journals nothing for a PR still open, or one GitHub could not be asked about", () => {
    const { db, id } = setup();
    notePrOutcome(db, id, pr("open"));
    notePrOutcome(db, id, null);
    expect(outcomes(db, id)).toHaveLength(0);
  });

  it("takes the card off the list, without asking GitHub again", async () => {
    const { db, id } = setup();
    expect((await openPrs(db)).prs.map((r) => r.card.id)).toEqual([id]);
    notePrOutcome(db, id, pr("closed"));
    expect((await openPrs(db)).prs).toEqual([]);
  });
});

describe("auto-merge on the open PR list", () => {
  it("carries what GitHub said, and forgets it when the PR is reopened", () => {
    const ev = (id: number, type: string) => ({ id, cardId: "c", type, payload: { url: "u" }, ts: id });
    const m = openPrsOf([ev(1, "card.pr_opened"), ev(2, "card.automerge_refused")]);
    expect(m.get("c")!.autoMerge).toBe("refused");
    expect(openPrsOf([ev(1, "card.pr_opened"), ev(2, "card.automerge_refused"), ev(3, "card.pr_opened")]).get("c")!.autoMerge).toBeUndefined();
    expect(openPrsOf([ev(1, "card.pr_opened"), ev(2, "card.automerge_refused"), ev(3, "card.pr_merged")]).size).toBe(0);
  });
});

describe("the open-PR list read on GitHub (the screen's open, and its Re-read tap)", () => {
  const listed = (o: Record<string, unknown>) => ({ mergeable: "MERGEABLE", reviewDecision: "", isDraft: false, statusCheckRollup: [], createdAt: "2026-11-13T10:00:00Z", ...o });
  const setup = () => {
    forgetPrRead();
    const db = new BoardDb(":memory:");
    // A lot card: its PR is on the lot branch, found by the journaled url.
    const live = db.createCard({ title: "live", repoPath: "/repo", baseRef: "main", branch: "board/card-in-a-lot" });
    const gone = db.createCard({ title: "gone", repoPath: "/repo", baseRef: "main", branch: "board/gone" });
    db.recordEvent(live.id, "card.pr_opened", { url: "https://gh/o/r/pull/5" });
    db.recordEvent(gone.id, "card.pr_opened", { url: "https://gh/o/r/pull/3" });
    const calls: string[][] = [];
    const gh: GitRunner = async (args) => {
      calls.push(args);
      if (args[1] === "list" && args[3] === "open") {
        return { ok: true, stderr: "", stdout: JSON.stringify([
          listed({ number: 5, title: "live", url: "https://gh/o/r/pull/5", headRefName: "board/live" }),
          listed({ number: 9, title: "docs(plan): fin du lot « X »", url: "https://gh/o/r/pull/9", headRefName: "board/plan-lot-x-1", mergeable: "UNKNOWN" }),
        ]) };
      }
      if (args[1] === "list") return { ok: true, stderr: "", stdout: JSON.stringify([{ number: 3, title: "gone", url: "https://gh/o/r/pull/3", headRefName: "board/gone", mergedAt: "2026-11-13T11:00:00Z" }]) };
      // `gh pr view board/gone`: the journal row GitHub no longer lists open.
      return { ok: true, stderr: "", stdout: JSON.stringify({ state: "MERGED", url: "https://gh/o/r/pull/3", mergedAt: "2026-11-13T11:00:00Z" }) };
    };
    return { db, live, gone, gh, calls };
  };

  it("lists the board's off-card PRs, and drops — journaling it — a card's PR merged on GitHub", async () => {
    const { db, live, gone, gh } = setup();
    const r = await openPrs(db, true, gh);
    expect(r.prs.find((p) => p.card.id === live.id)?.github?.number).toBe(5);
    expect(r.prs.find((p) => p.card.id === gone.id)?.pr?.state).toBe("merged");
    expect(r.others?.map((p) => [p.number, p.origin])).toEqual([[9, "plan"]]);
    expect(r.merged?.map((p) => [p.number, p.cardId])).toEqual([[3, gone.id]]);
    expect((await openPrs(db)).prs.map((p) => p.card.id)).toEqual([live.id]);
  });

  it("shares a read with the next one inside the floor, and reads again past it", async () => {
    const { db, gh, calls } = setup();
    let t = 1_000_000;
    await openPrs(db, true, gh, () => t);
    const n = calls.length;
    t += MIN_READ_MS - 1;
    await openPrs(db, true, gh, () => t);
    expect(calls.length).toBe(n);
    t += 2;
    await openPrs(db, true, gh, () => t);
    expect(calls.length).toBeGreaterThan(n);
  });

  it("merges or closes a PR by number only in a repo the board reads", async () => {
    const { db, gh, calls } = setup();
    expect(await prGesture(db, "/elsewhere", 9, "merge", gh)).toMatchObject({ ok: false, status: 404 });
    expect(await prGesture(db, "/repo", -1, "close", gh)).toMatchObject({ ok: false, status: 400 });
    expect(await prGesture(db, "/repo", 9, "close", gh)).toEqual({ ok: true });
    expect(calls.at(-1)).toEqual(["pr", "close", "9"]);
  });
});
