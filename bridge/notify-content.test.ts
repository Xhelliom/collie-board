import { describe, expect, test } from "bun:test";

import { notifyCardId, notifyContent, notifyMarker, repoOf } from "./notify-content.ts";

// The push's whole sentence, in one pure function shared by the plain push and every later subtitle
// update. What's under test is NOTIFY_AUDIT.md §3.2's single rule: `<marker> · <subject>` over
// `<repo> · <what happened>`, with nothing appearing twice.

// Both are PANE alerts, so both carry a `paneId` — its absence is a fact of its own now (a board
// alert, bridge/board-notify.ts), and `notifyCardId` reads it.
const CARD = {
  status: "done",
  paneId: "p1",
  cwd: "/home/you/.herdr/worktrees/collie-board/board/ship-it",
  cardTitle: "Ship 0.86",
} as const;
const HAND = { status: "done", paneId: "p2", cwd: "/home/you/git/elber" } as const;

describe("repoOf", () => {
  test("takes the segment under `worktrees`, not the branch directory below it", () => {
    expect(repoOf("/home/you/.herdr/worktrees/collie-board/board/ship-it")).toBe("collie-board");
  });

  test("falls back to the last segment for a pane sitting in the checkout itself", () => {
    expect(repoOf("/home/you/git/elber")).toBe("elber");
    expect(repoOf("/home/you/git/elber/")).toBe("elber");
  });
});

describe("notifyContent", () => {
  test("a card-backed alert: the card is the subject, the repo is the body", () => {
    expect(notifyContent(CARD, "3 files, +180 −12")).toEqual({
      title: "Done · Ship 0.86",
      body: "collie-board · 3 files, +180 −12",
    });
  });

  test("a hand-launched alert: the repo is the subject, so the body never repeats it", () => {
    expect(notifyContent(HAND, "rebased onto main")).toEqual({
      title: "Done · elber",
      body: "rebased onto main",
    });
  });

  test("blocked reads as a question, not a completion", () => {
    expect(notifyContent({ ...CARD, status: "blocked" }, null).title).toBe("Needs you · Ship 0.86");
  });

  test("no subtitle yet: the body is the repo alone, never a second copy of the subject", () => {
    expect(notifyContent(CARD, null).body).toBe("collie-board");
    expect(notifyContent(HAND, null).body).toBe("");
  });

  // The four acceptance criteria of NOTIFY_AUDIT.md §3.2, as one check each.
  test("two cards in the same repo get two different titles", () => {
    const a = notifyContent(CARD, null);
    const b = notifyContent({ ...CARD, cardTitle: "Audit the notifications" }, null);
    expect(a.title).not.toBe(b.title);
  });

  test("the repo name appears exactly once across title and body", () => {
    for (const alert of [CARD, HAND]) {
      const { title, body } = notifyContent(alert, "did a thing");
      const hits = `${title}\n${body}`.split(repoOf(alert.cwd)).length - 1;
      expect(hits).toBe(1);
    }
  });

  test("no field is repeated between title and body", () => {
    const { title, body } = notifyContent(CARD, "did a thing");
    expect(body).not.toContain(CARD.cardTitle);
    expect(title).not.toContain(repoOf(CARD.cwd));
  });

  test("the branch never reaches the push, even though it is right there in the cwd", () => {
    const { title, body } = notifyContent(CARD, "did a thing");
    expect(`${title} ${body}`).not.toContain("ship-it");
  });
});

// N9's whole point: the three surfaces share ONE composition. They can't share an import — the web
// app builds from its own source tree — so they share a byte-identical copy, and this is what keeps
// the copy honest. If it fails: edit one file, `cp` it over the other.
test("the web mirror is byte-identical to this one", async () => {
  const here = await Bun.file(new URL("./notify-content.ts", import.meta.url)).text();
  const there = await Bun.file(new URL("../web/src/lib/notify-content.ts", import.meta.url)).text();
  expect(there).toBe(here);
});

// NOTIFY_AUDIT.md §4.1 + §4.3: when the pane's card has landed in `review`, the notification is
// about the CARD TO READ, not the session that ended — and the tap follows the sentence. Two of
// §4.3's five rows are pure composition and live here; the other three are behaviours of the
// coordinator and live in notifications.test.ts.
describe("a card that landed in review", () => {
  const REVIEW = { ...CARD, cardId: "c1", cardStatus: "review" } as const;

  test("the marker says what is left to do — read the card, not `Done`", () => {
    expect(notifyContent(REVIEW, null).title).toBe("Review · Ship 0.86");
  });

  test("the subject and the body are untouched — only the marker changed", () => {
    expect(notifyContent(REVIEW, "3 files, +180 −12").body).toBe(
      notifyContent({ ...CARD, cardId: "c1" }, "3 files, +180 −12").body,
    );
  });

  test("the tap goes to the card, and only ever when the marker agrees", () => {
    expect(notifyCardId(REVIEW)).toBe("c1");
    // §4.3, row 1 — the operator moved the card out of review by hand. We don't lie about the state,
    // and the tap goes back to the pane with it.
    expect(notifyCardId({ ...CARD, cardId: "c1", cardStatus: "done" })).toBeUndefined();
    // §4.3, row 2 — no card at all: unchanged in both halves.
    expect(notifyCardId(HAND)).toBeUndefined();
  });

  test("no pane at all sends the tap to the card whatever its column — the board's own alert", () => {
    // A board alert (bridge/board-notify.ts) has no terminal behind it, so its card is the only
    // place its tap can go. The marker says which state that is; the destination never varies.
    const stalled = { status: "stalled", cwd: "/src/collie-board", cardId: "c1", cardTitle: "Ship it" } as const;
    expect(notifyMarker(stalled)).toBe("Stalled");
    expect(notifyCardId(stalled)).toBe("c1");
    expect(notifyContent(stalled, "its agent's pane is gone").title).toBe("Stalled · Ship it");
  });

  test("§4.3 row 1 — a card the operator moved out of review still reads `Done`", () => {
    expect(notifyContent({ ...CARD, cardId: "c1", cardStatus: "done" }, null).title).toBe("Done · Ship 0.86");
  });

  test("§4.3 row 2 — no card: the repo is the subject and the marker is `Done`, as before", () => {
    expect(notifyContent(HAND, null).title).toBe("Done · elber");
  });

  test("`blocked` outranks it — an agent asking a question is not a card to read", () => {
    expect(notifyContent({ ...REVIEW, status: "blocked" }, null).title).toBe("Needs you · Ship 0.86");
  });
});

describe("the in-app surfaces", () => {
  test("a non-primary session opens the body — where to look, ahead of what happened", () => {
    expect(notifyContent({ ...CARD, session: "side" }, "3 files").body).toBe("side · collie-board · 3 files");
  });

  test("the primary session adds nothing, so a toast reads exactly like the push did", () => {
    expect(notifyContent(CARD, "3 files")).toEqual(notifyContent({ ...CARD, session: undefined }, "3 files"));
  });
});
