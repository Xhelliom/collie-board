import { describe, expect, it } from "vitest";

import { noteLabel } from "./card.tsx";

// A session carries one of two documents in the same field, and they are not the same thing: a
// handoff note is written FOR the next agent, a closing report is what the outgoing agent says it
// did when the operator files the card. Labelling both "handoff note" made the second unreadable.
describe("noteLabel", () => {
  it("names the document by what ended the session", () => {
    expect(noteLabel(false, false)).toBe("Handoff note");
    expect(noteLabel(false, true)).toBe("Closing report");
  });

  it("turns into its own dismiss label when open", () => {
    expect(noteLabel(true, false)).toBe("Hide handoff note");
    expect(noteLabel(true, true)).toBe("Hide closing report");
  });
});
