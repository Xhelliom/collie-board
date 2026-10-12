import { describe, expect, it } from "bun:test";

import { exclusive } from "./integration-lock.ts";

describe("integration lock", () => {
  it("refuses a second gesture on the same card while the first runs, not on another card", async () => {
    const held = new Set<string>();
    let release!: () => void;
    const first = exclusive(held, "c1", () => new Promise<string>((r) => (release = () => r("pushed"))));
    expect(await exclusive(held, "c1", async () => "again")).toEqual({ busy: true });
    expect(await exclusive(held, "c2", async () => "other")).toEqual({ busy: false, value: "other" });
    release();
    expect(await first).toEqual({ busy: false, value: "pushed" });
    expect(await exclusive(held, "c1", async () => "next")).toEqual({ busy: false, value: "next" });
  });

  it("releases the card when the gesture throws", async () => {
    const held = new Set<string>();
    await expect(exclusive(held, "c1", async () => Promise.reject(new Error("hook failed")))).rejects.toThrow("hook failed");
    expect(held.size).toBe(0);
  });
});
