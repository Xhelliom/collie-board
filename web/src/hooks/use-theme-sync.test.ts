import { renderHook } from "@testing-library/react";

import { useThemeSync } from "./use-theme-sync";

describe("useThemeSync", () => {
  afterEach(() => localStorage.clear());

  it("a device that remembered the retired Classique style opens in Sémaphore, the key erased", () => {
    localStorage.setItem("collie:style", "classic");
    renderHook(() => useThemeSync());
    expect(localStorage.getItem("collie:style")).toBeNull();
    expect(document.documentElement.dataset.style).toBeUndefined();
  });
});
