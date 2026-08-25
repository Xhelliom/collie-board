import { describe, expect, it } from "vitest";

import { describeEvent, editedByHandSince, fieldList } from "./card-journal";
import type { BoardEvent } from "@/lib/board";

function event(type: string, payload: unknown = {}): BoardEvent {
  return { id: 1, cardId: "c1", type, payload, ts: 0 };
}

describe("fieldList", () => {
  it("names what was replaced, in a sentence", () => {
    expect(fieldList({ spec: "x" })).toBe("the spec");
    expect(fieldList({ title: "x", spec: "y" })).toBe("the title and the spec");
    expect(fieldList({ title: "x", spec: "y", acceptance: [] })).toBe(
      "the title, the spec and the acceptance criteria",
    );
  });

  it("counts a field that was cleared, not just one that was rewritten", () => {
    // `spec: null` is a real previous value — the card had no spec and now does.
    expect(fieldList({ spec: null })).toBe("the spec");
  });

  it("falls back rather than producing an empty sentence", () => {
    expect(fieldList({})).toBe("this card");
    expect(fieldList()).toBe("this card");
  });
});

describe("describe", () => {
  it("turns the journal into sentences instead of database rows", () => {
    expect(describeEvent(event("card.created"))).toBe("Card created");
    expect(describeEvent(event("card.status", { from: "backlog", to: "working", reason: "agent working" })))
      .toBe("Moved from backlog to working — agent working");
    expect(describeEvent(event("session.closed", { outcome: "handoff" }))).toBe(
      "Session ended (handoff)",
    );
  });

  it("says what a split did, on both sides of it", () => {
    expect(describeEvent(event("copilot.reformulated", { split: 3 }))).toBe(
      "Copilot rewrote the card and split it into 3",
    );
    expect(describeEvent(event("copilot.reformulated", { split: 0 }))).toBe("Copilot rewrote the card");
    expect(describeEvent(event("card.split_from", { after: "Mode desktop" }))).toBe(
      "Split off, after “Mode desktop”",
    );
  });

  it("quotes the correction back — 'the copilot corrected this' alone says nothing", () => {
    expect(describeEvent(event("copilot.refined", { instruction: "say the format is json" }))).toBe(
      "Corrected on your instruction: “say the format is json”",
    );
  });

  it("says how far a correction on a container went, and where a sub-task's came from", () => {
    expect(
      describeEvent(event("copilot.refined", { instruction: "the format is json", subtasks: 2 })),
    ).toBe("Corrected on your instruction: “the format is json” — and 2 sub-tasks");
    // On the sub-task itself: you never typed an instruction here, its parent did.
    expect(
      describeEvent(event("copilot.refined", { instruction: "the format is json", parentId: "c1" })),
    ).toBe("Corrected with its parent card: “the format is json”");
  });

  it("mentions the predecessor a worktree was forked from", () => {
    expect(describeEvent(event("card.worktree", { branch: "board/x", after: "Audit" }))).toBe(
      "Worktree on board/x, after “Audit”",
    );
  });

  it("shows the raw type for an event nobody has written a sentence for", () => {
    // A journal with holes in it would be worse than one with a bit of jargon.
    expect(describeEvent(event("card.something_new"))).toBe("card.something_new");
  });
});

describe("editedByHandSince", () => {
  it("says yes when the newest edit is a person's", () => {
    expect(
      editedByHandSince([
        event("card.edited", { reason: "edit" }),
        event("card.edited", { reason: "copilot" }),
      ]),
    ).toBe(true);
  });

  it("says no when the copilot wrote last — re-running it then loses nothing", () => {
    expect(
      editedByHandSince([
        event("card.edited", { reason: "copilot" }),
        event("card.edited", { reason: "edit" }),
      ]),
    ).toBe(false);
  });

  it("says no on a card nobody has ever edited", () => {
    // Otherwise the confirmation would nag on every freshly dictated card.
    expect(editedByHandSince([event("card.created")])).toBe(false);
    expect(editedByHandSince([])).toBe(false);
  });

  it("counts a restore as a hand edit — it is one, and it must not be silently undone", () => {
    expect(editedByHandSince([event("card.edited", { reason: "revert" })])).toBe(true);
  });
});
