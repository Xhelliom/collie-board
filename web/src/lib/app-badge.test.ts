import { describe, expect, it, vi } from "vitest";

import { recordSlot, showBadge, slotCount, waitingCount, type BadgeCaches } from "./app-badge";
import type { AgentView } from "./types";

const agent = (status: AgentView["status"], kind?: "shell"): AgentView =>
  ({ paneId: status, status, kind, cwd: "/", focused: false }) as AgentView;

function fakeCaches(): BadgeCaches {
  const store = new Map<string, string>();
  return {
    open: async () => ({
      match: async (key: RequestInfo | URL) => {
        const v = store.get(String(key));
        return v === undefined ? undefined : new Response(v);
      },
      put: async (key: RequestInfo | URL, res: Response) => void store.set(String(key), await res.text()),
    }),
  } as BadgeCaches;
}

describe("app badge", () => {
  it("counts blocked and finished-unseen agent panes, never a shell", () => {
    expect(waitingCount([agent("blocked"), agent("done"), agent("working"), agent("idle"), agent("done", "shell")])).toBe(2);
  });

  it("reads a herd push's count, a clear as zero, and ignores every other push", () => {
    expect(slotCount({ tag: "collie:herd", badge: 2 })).toBe(2);
    expect(slotCount({ tag: "collie:herd:dev", type: "clear" })).toBe(0);
    expect(slotCount({ tag: "collie:herd" })).toBeUndefined(); // an older bridge must not zero it
    expect(slotCount({ tag: "collie-update", type: "update", badge: 1 })).toBeUndefined();
    expect(slotCount({ tag: "collie:herd", badge: -1 })).toBeUndefined();
  });

  it("sums every session's last count, and drops one that clears", async () => {
    const caches = fakeCaches();
    expect(await recordSlot(caches, "https://x", "collie:herd", 2)).toBe(2);
    expect(await recordSlot(caches, "https://x", "collie:herd:dev", 1)).toBe(3);
    expect(await recordSlot(caches, "https://x", "collie:herd", 0)).toBe(1);
  });

  it("sets the count, clears it at zero, and swallows a refusal", async () => {
    const target = { setAppBadge: vi.fn(async () => {}), clearAppBadge: vi.fn(async () => {}) };
    await showBadge(target, 3);
    await showBadge(target, 0);
    expect(target.setAppBadge).toHaveBeenCalledWith(3);
    expect(target.clearAppBadge).toHaveBeenCalledOnce();
    await expect(showBadge({ setAppBadge: () => Promise.reject(new Error("no")) }, 1)).resolves.toBeUndefined();
  });
});
