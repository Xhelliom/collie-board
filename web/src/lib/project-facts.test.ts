import { describe, expect, it } from "vitest";

import { duration, factChips, specLine, type CardFacts } from "@/lib/project-facts";

const facts = (o: Partial<CardFacts> = {}): CardFacts => ({
  cardId: "c", gate: null, lead: null, triage: null, review: null, pr: null,
  sentBack: 0, operatorSaid: 0, startedAt: null, endedAt: null, ...o,
});

describe("factChips", () => {
  it("says what the journal knows, headline first", () => {
    const chips = factChips(
      { session: null },
      facts({ gate: { ok: true, command: "make", ts: 1 }, pr: { url: "u", state: "open", autoMerge: "refused" }, review: "partial", sentBack: 2, startedAt: 0, endedAt: 12 * 60_000 }),
    );
    expect(chips.map((c) => c.label)).toEqual(["gate ✓", "PR open", "merge it yourself", "review partial", "sent back 2×", "12 min"]);
  });
  it("is empty for a card the journal has nothing on", () => {
    expect(factChips({ session: null }, undefined)).toEqual([]);
  });
});

describe("helpers", () => {
  it("duration is coarse", () => {
    expect(duration(10_000)).toBe("1 min");
    expect(duration(125 * 60_000)).toBe("2 h 05");
  });
  it("specLine drops markdown marks and takes the first real line", () => {
    expect(specLine("\n## Show the score\nmore")).toBe("Show the score");
    expect(specLine(null)).toBeNull();
  });
});
