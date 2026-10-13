import { afterEach, describe, expect, it, vi } from "vitest";

import { getLocale, resolveLocale, setPreference, t } from "@/i18n";

afterEach(() => setPreference("en"));

describe("i18n", () => {
  it("auto follows the browser: French for fr-*, English otherwise", () => {
    expect(resolveLocale("auto", "fr-FR")).toBe("fr");
    expect(resolveLocale("auto", "fr")).toBe("fr");
    expect(resolveLocale("auto", "de-DE")).toBe("en");
    expect(resolveLocale("auto", undefined)).toBe("en");
    expect(resolveLocale("en", "fr-FR")).toBe("en");
  });

  it("speaks the chosen language, and a change is immediate", () => {
    setPreference("fr");
    expect(getLocale()).toBe("fr");
    expect(t("language.label")).toBe("Langue");
    setPreference("en");
    expect(t("language.label")).toBe("Language");
  });

  it("shows an unknown key instead of crashing — a key built from a value the bridge added later", () => {
    expect(t("card.outcome.someday" as never)).toBe("card.outcome.someday");
  });

  it("picks the plural form of the language", () => {
    setPreference("en");
    expect([t("common.cards", { count: 1 }), t("common.cards", { count: 3 })]).toEqual(["1 card", "3 cards"]);
    setPreference("fr");
    expect([t("common.cards", { count: 0 }), t("common.cards", { count: 1 }), t("common.cards", { count: 2 })]).toEqual(["0 carte", "1 carte", "2 cartes"]);
  });

  describe("first launch", () => {
    // The module reads localStorage once, at import: each case re-imports it fresh.
    const fresh = async (navLang: string) => {
      vi.resetModules();
      vi.spyOn(navigator, "language", "get").mockReturnValue(navLang);
      return import("@/i18n");
    };
    afterEach(() => vi.restoreAllMocks());

    it("defaults to English with an empty storage, even in a French browser", async () => {
      localStorage.clear();
      const m = await fresh("fr-FR");
      expect(m.getPreference()).toBe("en");
      expect(m.getLocale()).toBe("en");
    });

    it("remembers an explicit \"auto\" and reads it back, then follows the browser", async () => {
      localStorage.clear();
      const a = await fresh("fr-FR");
      a.setPreference("auto");
      expect(localStorage.getItem("collie:locale")).toBe("auto");
      const b = await fresh("fr-FR");
      expect(b.getPreference()).toBe("auto");
      expect(b.getLocale()).toBe("fr");
    });
  });
});
