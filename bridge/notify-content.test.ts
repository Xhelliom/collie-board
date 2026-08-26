import { describe, expect, test } from "bun:test";

import { notifyContent, repoOf } from "./notify-content.ts";

// The push's whole sentence, in one pure function shared by the plain push and every later subtitle
// update. What's under test is NOTIFY_AUDIT.md §3.2's single rule: `<marker> · <subject>` over
// `<repo> · <what happened>`, with nothing appearing twice.

const CARD = { status: "done", cwd: "/home/you/.herdr/worktrees/collie-board/board/ship-it", cardTitle: "Ship 0.86" } as const;
const HAND = { status: "done", cwd: "/home/you/git/elber" } as const;

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
