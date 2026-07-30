// Theme preference: light / dark / follow the OS (`prefers-color-scheme`), persisted in
// localStorage. This is the one place that decides what ".dark" means, so index.html's inline
// anti-FOUC script (which duplicates the same rules in plain JS, since it runs before this module
// loads) and useThemeSync can never disagree.

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "collie:theme";

export function loadThemeMode(): ThemeMode {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    return raw === "light" || raw === "dark" ? raw : "system";
  } catch {
    return "system";
  }
}

export function saveThemeMode(mode: ThemeMode): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (mode === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Ignore quota / private-mode write errors — the choice just won't persist.
  }
}

function systemPrefersDark(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
}

/** What a stored preference resolves to once the OS is consulted for "system". */
export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? (systemPrefersDark() ? "dark" : "light") : mode;
}

/**
 * Toggle the `.dark` class + the PWA status-bar color to match.
 *
 * The "#0a0a0a"/"#ffffff" pair is duplicated three times in this codebase — here, in index.html's
 * inline anti-FOUC script, and in its `.boot-splash`/`html.dark .boot-splash` CSS — because the
 * splash and the very first script run before this module (or any CSS custom property) exists to
 * read from. Not accidental copy-paste: keep all three in sync if the status-bar color ever changes.
 */
export function applyTheme(mode: ThemeMode): void {
  const dark = resolveTheme(mode) === "dark";
  document.documentElement.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0a0a0a" : "#ffffff");
}
