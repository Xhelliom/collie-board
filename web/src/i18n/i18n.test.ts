import { afterEach, describe, expect, it } from "vitest";

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

  it("picks the plural form of the language", () => {
    setPreference("en");
    expect([t("common.cards", { count: 1 }), t("common.cards", { count: 3 })]).toEqual(["1 card", "3 cards"]);
    setPreference("fr");
    expect([t("common.cards", { count: 0 }), t("common.cards", { count: 1 }), t("common.cards", { count: 2 })]).toEqual(["0 carte", "1 carte", "2 cartes"]);
  });
});
