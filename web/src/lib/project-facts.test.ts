import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setPreference } from "@/i18n";
import { ago, duration, factChips, specLine, type CardFacts } from "@/lib/project-facts";

const facts = (o: Partial<CardFacts> = {}): CardFacts => ({
  cardId: "c", gate: null, lead: null, triage: null, review: null, pr: null,
  sentBack: 0, operatorSaid: 0, startedAt: null, endedAt: null, ...o,
});

// The texts asserted here are in one language, whatever the browser says.
beforeEach(() => setPreference("en"));
afterEach(() => setPreference("en"));

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

describe("in French", () => {
  it("chips and relative times follow the language", () => {
    setPreference("fr");
    const chips = factChips(
      { session: null },
      facts({ gate: { ok: true, command: "make", ts: 1 }, pr: { url: "u", state: "open", autoMerge: "refused" }, sentBack: 2 }),
    );
    expect(chips.map((c) => c.label)).toEqual(["barrière ✓", "PR ouverte", "à fusionner à la main", "renvoyée 2×"]);
    expect(ago(Date.now() - 5 * 60_000)).toMatch(/5/);
    expect(ago(Date.now() - 5 * 60_000)).not.toMatch(/ago/);
  });
});
