import { loadThemeMode, resolveTheme, saveThemeMode } from "./theme";

describe("theme", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to system when nothing is stored", () => {
    expect(loadThemeMode()).toBe("system");
  });

  it("round-trips an explicit light/dark choice through localStorage", () => {
    saveThemeMode("dark");
    expect(loadThemeMode()).toBe("dark");
    saveThemeMode("light");
    expect(loadThemeMode()).toBe("light");
  });

  it("choosing system again clears the stored override", () => {
    saveThemeMode("dark");
    saveThemeMode("system");
    expect(localStorage.getItem("collie:theme")).toBeNull();
    expect(loadThemeMode()).toBe("system");
  });

  it("falls back to system on a malformed stored value", () => {
    localStorage.setItem("collie:theme", "purple");
    expect(loadThemeMode()).toBe("system");
  });

  it("resolveTheme passes explicit modes through unchanged", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("resolveTheme('system') follows matchMedia", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    expect(resolveTheme("system")).toBe("dark");
    window.matchMedia = original;
  });
});
