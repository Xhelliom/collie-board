import { describe, expect, it } from "bun:test";

import { BoardDb, type BoardEvent } from "./db.ts";
import type { PrStatus } from "./git.ts";
import { notePrOutcome, openPrs, openPrsOf } from "./prs.ts";

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
    expect((await openPrs(db)).map((r) => r.card.id)).toEqual([id]);
    notePrOutcome(db, id, pr("closed"));
    expect(await openPrs(db)).toEqual([]);
  });
});
