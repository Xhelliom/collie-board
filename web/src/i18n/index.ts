import { useSyncExternalStore } from "react";

import { CATALOG, type MessageKey } from "./catalog";

// The board speaks the operator's language (ADR 0024). English is the source and the fallback; a
// message is written ONCE, with both languages side by side, so a missing translation is a type error
// rather than a hole found on a phone. Upstream's own screens stay hard-coded English and never go
// through here — this is the fork's layer, not a rewrite of Altan's.

export type Locale = "en" | "fr";
export const LOCALES: readonly Locale[] = ["en", "fr"];
export type Preference = Locale | "auto";

export { defineMessages, type Entry } from "./define";
import type { Entry } from "./define";

const KEY = "collie:locale";

const read = (): Preference => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "en" || v === "fr" ? v : "auto";
  } catch {
    return "auto";
  }
};

/** "auto" follows the browser: French for any fr-*, English for everything else. Pure, for the test. */
export function resolveLocale(pref: Preference, browser: string | undefined): Locale {
  if (pref !== "auto") return pref;
  return (browser ?? "").toLowerCase().startsWith("fr") ? "fr" : "en";
}

let preference: Preference = read();
const listeners = new Set<() => void>();
const browserLanguage = () => (typeof navigator === "undefined" ? undefined : navigator.language);
let current: Locale = resolveLocale(preference, browserLanguage());

export const getPreference = (): Preference => preference;
export const getLocale = (): Locale => current;

export function setPreference(p: Preference): void {
  preference = p;
  current = resolveLocale(p, browserLanguage());
  try {
    if (p === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, p);
  } catch {
    /* private window: the choice lasts for this visit only */
  }
  if (typeof document !== "undefined") document.documentElement.lang = current;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

type Params = Record<string, string | number>;

const fill = (s: string, params?: Params) =>
  params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;

/**
 * The message in the current language. `{name}` is replaced from `params`; with a `count` param an
 * entry written as `{ one, other }` picks the language's plural form. Outside React (a pure function
 * building a sentence) call this directly; inside a component use {@link useT} so it re-renders when
 * the language changes.
 */
export function t(key: MessageKey, params?: Params): string {
  const entry: Entry = CATALOG[key];
  const raw = entry[current];
  if (typeof raw === "string") return fill(raw, params);
  const n = typeof params?.count === "number" ? params.count : 1;
  return fill(raw[new Intl.PluralRules(current).select(n) === "one" ? "one" : "other"], params);
}

export function useT(): typeof t {
  useSyncExternalStore(subscribe, getLocale, getLocale);
  return t;
}

export function usePreference(): Preference {
  return useSyncExternalStore(subscribe, getPreference, getPreference);
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}

export type { MessageKey };
