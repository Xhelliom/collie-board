import { afterEach, describe, expect, it, vi } from "vitest";

import { revealWhenRendered } from "./reveal";

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("revealWhenRendered", () => {
  it("waits for the section to be rendered and the drawer to be gone", async () => {
    const drawer = document.createElement("div");
    drawer.setAttribute("data-vaul-drawer", "");
    document.body.append(drawer);
    const found = vi.fn();
    revealWhenRendered("s", found, () => {});
    const s = document.createElement("section");
    s.id = "s";
    document.body.append(s);
    await Promise.resolve();
    expect(found).not.toHaveBeenCalled();
    drawer.remove();
    await vi.waitFor(() => expect(found).toHaveBeenCalledWith(s));
  });

  it("says so when the section never shows up", () => {
    vi.useFakeTimers();
    const found = vi.fn();
    const missing = vi.fn();
    revealWhenRendered("nope", found, missing, 100);
    vi.advanceTimersByTime(100);
    expect(missing).toHaveBeenCalledOnce();
    expect(found).not.toHaveBeenCalled();
  });
});
