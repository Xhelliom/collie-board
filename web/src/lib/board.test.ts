import { describe, expect, it } from "vitest";

import { BOARD_COLUMNS, BOARD_LANES, CARD_STATUS_LABEL, canDropCard, MANUAL_STATUSES } from "./board";

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

  it("refuses a drop on the column the card is already in", () => {
    expect(canDropCard("ready", "ready")).toBe(false);
  });

  it("never targets `archived` — it is manual but has no column to drop on", () => {
    expect(canDropCard("backlog", "archived")).toBe(false);
    // …though it remains a legal SOURCE if an archived card is ever shown.
    expect(canDropCard("archived", "backlog")).toBe(true);
  });
});
