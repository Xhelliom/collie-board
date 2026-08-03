import { describe, expect, it } from "vitest";

import { BOARD_COLUMNS, BOARD_LANES, CARD_STATUS_LABEL } from "./board";

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

  it("keeps each lane's own label among its columns' labels, so the heading can dedupe", () => {
    // board.tsx hides a sub-section heading when it repeats its lane's name. That only reads right
    // if the repeat is the lane's FIRST column — otherwise the lane opens with unlabelled tiles
    // belonging to some other status.
    for (const lane of BOARD_LANES) {
      const first = CARD_STATUS_LABEL[lane.statuses[0]];
      expect(first).toBe(lane.label);
    }
  });
});
