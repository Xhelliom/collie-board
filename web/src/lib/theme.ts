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
 * Toggle the `.dark` class.
 *
 * It used to swing `<meta name="theme-color">` between "#0a0a0a" and "#ffffff" too. It must not:
 * that meta only tells Chrome which way to tint the Android system status-bar icons, while the band
 * behind them is painted from the manifest's `theme_color`, a single value baked into the WebAPK at
 * install time (#0a0a0a). A light theme therefore asked for dark icons over a black band — black on
 * black, the clock and battery gone. Nothing in the page can repaint that band, at runtime or
 * otherwise — a `media`-scoped meta pair was tried against the device and fails the same way, see
 * index.html. The status-bar colour is one fixed dark value there and in the manifest.
 *
 * The "#0a0a0a"/"#ffffff" pair still lives in index.html's `.boot-splash`/`html.dark .boot-splash`
 * CSS, which runs before any CSS custom property exists to read from — keep it in sync with
 * --background if that ever moves.
 */
export function applyTheme(mode: ThemeMode): void {
  document.documentElement.classList.toggle("dark", resolveTheme(mode) === "dark");
}
