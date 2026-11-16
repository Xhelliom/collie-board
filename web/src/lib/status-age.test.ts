import { describe, expect, it } from "vitest";

import { LOUD_AFTER_MS, ageTone } from "./status-age";

const now = 10 * LOUD_AFTER_MS;

describe("ageTone", () => {
  it("a wait turns orange, a stuck state red, only past the threshold", () => {
    expect(ageTone("blocked", now - LOUD_AFTER_MS - 1, now)).toBe("wait");
    expect(ageTone("stuck", now - 2 * LOUD_AFTER_MS, now)).toBe("stuck");
    expect(ageTone("blocked", now - LOUD_AFTER_MS, now)).toBeNull();
    expect(ageTone("stuck", now - 60_000, now)).toBeNull();
  });
  it("everything else stays grey, however long", () => {
    for (const s of ["working", "idle", "done", "review"] as const) expect(ageTone(s, 0, now)).toBeNull();
  });
  it("no age, no tone", () => {
    expect(ageTone("blocked", null, now)).toBeNull();
    expect(ageTone("blocked", undefined, now)).toBeNull();
  });
});
