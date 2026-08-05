import { describe, expect, it } from "vitest";

import {
  BOARD_COLUMNS,
  BOARD_LANES,
  CARD_STATUS_LABEL,
  canDropCard,
  MANUAL_STATUSES,
  loadRepoScope,
  matchesFilters,
  positionFor,
  repoName,
  reposOf,
  saveRepoScope,
  tagHue,
  normalizeTag,
  tagsOf,
  type CardView,
} from "./board";

// The wide-screen board renders lanes, not columns. A status that fell out of every lane would keep
// working on a phone and silently vanish from the desktop board — the kind of gap nobody notices
// until a blocked card goes missing on the machine they actually work on.
describe("BOARD_LANES", () => {
  it("covers every board column exactly once", () => {
    const laid = BOARD_LANES.flatMap((l) => l.statuses);
    expect([...laid].sort()).toEqual([...BOARD_COLUMNS].sort());
  });

  it("never lanes `archived` — it isn't a column either", () => {
    expect(BOARD_LANES.flatMap((l) => l.statuses)).not.toContain("archived");
  });

  it("puts every manual column in a lane, so a drop target is always visible somewhere", () => {
    const laid = new Set(BOARD_LANES.flatMap((l) => l.statuses));
    for (const s of MANUAL_STATUSES) {
      if (s === "archived") continue; // no column, by design
      expect(laid.has(s)).toBe(true);
    }
  });

  it("only ever repeats a column's name on its FIRST column, so the heading can dedupe", () => {
    // board.tsx hides a sub-section heading when it repeats its lane's name. A lane whose name
    // matched its SECOND column would open with unlabelled tiles belonging to the first one.
    // A lane whose name matches none of them (e.g. "To do" over ready + backlog) keeps every
    // sub-heading, which is the honest outcome and what that lane's count depends on.
    for (const lane of BOARD_LANES) {
      const repeated = lane.statuses.filter((s) => CARD_STATUS_LABEL[s] === lane.label);
      if (repeated.length === 0) continue;
      expect(repeated).toEqual([lane.statuses[0]]);
    }
  });
});

// What a drag is ALLOWED to do. This is the whole safety boundary of the feature: everything else
// about it is a dataTransfer and a class name, but get this wrong and a drop either sends a working
// agent home or writes a status the next poll silently undoes.
describe("canDropCard", () => {
  it("allows the moves the card page's Move to already offers", () => {
    expect(canDropCard("backlog", "ready")).toBe(true);
    expect(canDropCard("ready", "backlog")).toBe(true);
    expect(canDropCard("ready", "done")).toBe(true);
    expect(canDropCard("done", "backlog")).toBe(true);
  });

  it("refuses every column the herd owns, as a source and as a target", () => {
    for (const live of ["blocked", "review", "working", "starting", "orphaned"] as const) {
      expect(canDropCard(live, "done")).toBe(false);
      expect(canDropCard("backlog", live)).toBe(false);
    }
  });

  it("allows a drop on the card's own column — that is a reorder", () => {
    expect(canDropCard("ready", "ready")).toBe(true);
  });

  it("never targets `archived` — it is manual but has no column to drop on", () => {
    expect(canDropCard("backlog", "archived")).toBe(false);
    // …though it remains a legal SOURCE if an archived card is ever shown.
    expect(canDropCard("archived", "backlog")).toBe(true);
  });
});

// Reordering is one PATCH on one card, and this is the arithmetic that makes that true. It is worth
// pinning because the failure is silent: a wrong value here doesn't throw, it just puts the card
// somewhere else and looks like the drop missed.
describe("positionFor", () => {
  const column = [10, 20, 30];

  it("slots halfway between the two cards it lands between", () => {
    expect(positionFor(column, 1)).toBe(15);
    expect(positionFor(column, 2)).toBe(25);
  });

  it("goes one below the top card when dropped first — the rule new cards already follow", () => {
    expect(positionFor(column, 0)).toBe(9);
  });

  it("goes one above the last card when dropped last", () => {
    expect(positionFor(column, 3)).toBe(31);
  });

  it("handles an empty column", () => {
    expect(positionFor([], 0)).toBe(0);
  });

  it("keeps halving a gap without ever landing on a neighbour", () => {
    // What repeated drops into the same slot actually do. Each result must stay strictly between
    // its neighbours — an inclusive result would tie, and a tie is a card that doesn't move.
    let pair = [0, 1];
    for (let i = 0; i < 20; i++) {
      const mid = positionFor(pair, 1);
      expect(mid).toBeGreaterThan(pair[0]);
      expect(mid).toBeLessThan(pair[1]);
      pair = [pair[0], mid];
    }
  });

  it("survives negative positions, which is what the top of a column is made of", () => {
    // New cards take `min - 1`, so a lived-in column counts down through zero.
    expect(positionFor([-3, -2, -1], 0)).toBe(-4);
    expect(positionFor([-3, -1], 1)).toBe(-2);
  });
});

// A tag's colour is not stored anywhere, so these two properties are the only thing standing
// between "same tag, same colour" and a tag that changes colour between two screens.
describe("tagHue", () => {
  it("gives one name one hue, every time", () => {
    // Pinned, not merely self-consistent: this number is what "the same colour on every device"
    // means, so a change to the hash is a change every board sees and has to be a deliberate one.
    expect(tagHue("infra")).toBe(45);
    expect(tagHue("infra")).toBe(tagHue("infra"));
  });

  it("stays on the band grid, whatever the name", () => {
    for (const tag of ["", "a", "infra", "ui polish", "🐛", "x".repeat(24)]) {
      const hue = tagHue(tag);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
      // Centred in a 30° band — never on 0°, where it would read as the blocked red.
      expect((hue - 15) % 30).toBe(0);
    }
  });

  it("spreads short lowercase words across the wheel — the only names tags actually take", () => {
    const tags = ["bug", "infra", "ui", "docs", "perf", "refactor", "board", "fix", "test", "ux"];
    // Collisions are accepted (see TAG_HUES); clumping is not. Half the wheel unused would mean
    // every tag on a real board arriving in one of three colours.
    expect(new Set(tags.map(tagHue)).size).toBeGreaterThanOrEqual(8);
  });
});

describe("tagsOf", () => {
  const card = (tag: string | null, updatedAt: number) => ({ tag, updatedAt }) as CardView;

  it("dedupes, drops untagged cards, and puts the most recently touched first", () => {
    expect(tagsOf([card("bug", 1), card(null, 9), card("infra", 5), card("bug", 7)])).toEqual([
      "bug",
      "infra",
    ]);
  });

  it("is empty on a board with no tags at all", () => {
    expect(tagsOf([card(null, 1), card(null, 2)])).toEqual([]);
  });
});

describe("matchesFilters", () => {
  const card = (over: Partial<CardView>) => ({ tag: null, origin: null, ...over }) as CardView;
  const auto = card({ origin: "copilot", tag: "infra" });
  const hand = card({ tag: "infra" });

  it("keeps everything when neither filter is on", () => {
    expect([auto, hand].filter((c) => matchesFilters(c, { tag: null, autoOnly: false }))).toEqual([
      auto,
      hand,
    ]);
  });

  it("isolates the cards the copilot filed on its own", () => {
    expect([auto, hand].filter((c) => matchesFilters(c, { tag: null, autoOnly: true }))).toEqual([
      auto,
    ]);
  });

  it("composes with the tag — an automatic card keeps its own tag, so both axes still answer", () => {
    expect(matchesFilters(auto, { tag: "infra", autoOnly: true })).toBe(true);
    expect(matchesFilters(auto, { tag: "ui", autoOnly: true })).toBe(false);
    expect(matchesFilters(hand, { tag: "infra", autoOnly: true })).toBe(false);
  });
});

describe("reposOf", () => {
  const card = (repoPath: string | null, updatedAt: number) =>
    ({ repoPath, updatedAt }) as CardView;

  it("dedupes, drops repo-less cards, and puts the most recently touched repo first", () => {
    expect(
      reposOf([card("/a/collie", 1), card(null, 9), card("/b/herdr", 5), card("/a/collie", 7)]),
    ).toEqual([
      { path: "/a/collie", name: "collie" },
      { path: "/b/herdr", name: "herdr" },
    ]);
  });

  it("is empty on a board where no card has a repo — the strip then draws nothing", () => {
    expect(reposOf([card(null, 1), card(null, 2)])).toEqual([]);
  });
});

// What the board comes up on. "All repos" has to be a REMEMBERED answer and not merely the absence
// of one — stored as "" — otherwise picking All would leave the last repo in storage and the very
// next visit would silently scope itself again.
describe("the remembered repo scope", () => {
  it("gives back nothing before anything was ever chosen", () => {
    localStorage.clear();
    expect(loadRepoScope()).toBeNull();
  });

  it("round-trips a repo, and remembers All as All rather than as unset", () => {
    saveRepoScope("/a/collie");
    expect(loadRepoScope()).toBe("/a/collie");
    saveRepoScope(null);
    expect(loadRepoScope()).toBeNull();
  });
});

describe("repoName", () => {
  it("is the last segment, trailing slashes and all", () => {
    expect(repoName("/home/me/git/collie-board")).toBe("collie-board");
    expect(repoName("/home/me/git/collie-board/")).toBe("collie-board");
  });

  it("falls back to the path itself rather than to an empty chip", () => {
    expect(repoName("/")).toBe("/");
  });
});

describe("normalizeTag", () => {
  it("folds the spellings that would otherwise become separate tags", () => {
    // The whole point: all four are the tag `bug`, so none of them can mint a second one.
    for (const typed of ["bug", "Bug", " BUG ", "bug\t"]) expect(normalizeTag(typed)).toBe("bug");
    expect(normalizeTag("Front  End")).toBe("front end");
  });

  it("reads an empty box as no tag, so the field stays optional", () => {
    expect(normalizeTag("")).toBeNull();
    expect(normalizeTag("   ")).toBeNull();
  });

  it("clips a sentence to the chip's width without leaving it ending in a space", () => {
    expect(normalizeTag("a".repeat(40))).toBe("a".repeat(24));
    expect(normalizeTag(`${"a".repeat(23)} bcd`)).toBe("a".repeat(23));
  });

  // Client-side folding only matters because it must agree with the bridge's. If these two ever
  // disagree, the field lights up `bug` and the card lands on something else.
  it("agrees with bridge/db.ts normalizeTag", () => {
    expect(normalizeTag(" Bug  Fix ")).toBe("bug fix");
  });
});
