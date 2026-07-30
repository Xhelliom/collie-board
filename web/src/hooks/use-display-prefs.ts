import { useCallback, useState } from "react";

// Terminal mirror display preferences, persisted in localStorage.
// Safe to call in SSR contexts (localStorage guarded throughout).

export interface DisplayPrefs {
  /** Whether the mirror wraps long lines (default: false — preserves column alignment like desktop Herdr; enable Wrap in View for prose). */
  wrap: boolean;
  /** Font size in px for the mirror pre (default: 12, range: 9–16). */
  fontSize: number;
  /**
   * Raw-terminal escape hatch (default: false). When on, the mirror renders the PLAIN terminal —
   * every Claude grammar (chrome stripping, native prompt-select buttons, the status strip) is
   * bypassed, so a misdetected/mis-rendered dialog can always be driven manually with the keys pad.
   * The universal fallback, made user-controllable.
   */
  rawTerminal: boolean;
}

const STORAGE_KEY = "collie:display-prefs:v3";
const FONT_MIN = 9;
const FONT_MAX = 16;
/**
 * Width below which line wrap defaults ON.
 *
 * At 12px monospace a character is ~7px, so ~80 columns needs ~560px. Panes here measure a median
 * of 81 columns and a max of 233 — on a phone that means most lines run off the edge, and reading
 * the mirror becomes a horizontal pan. Matches the app's own `max-w-screen-sm` container.
 */
const WRAP_BELOW_PX = 640;

/**
 * Whether wrap should START on, given the viewport width.
 *
 * NOT wrap-always: upstream's no-wrap default is right on a wide screen, where preserving column
 * alignment is what makes a TUI's boxes and tables readable at all — wrapping scatters their
 * borders. It is wrong on a phone, which cannot show the columns in the first place. So the default
 * follows the screen, and the moment the user touches the toggle their choice is stored and wins
 * forever after. Pure + exported so the threshold is testable without a DOM.
 */
export function wrapDefaultFor(viewportWidth: number): boolean {
  return viewportWidth > 0 && viewportWidth < WRAP_BELOW_PX;
}

function defaults(): DisplayPrefs {
  const width = typeof window === "undefined" ? 0 : window.innerWidth;
  return { wrap: wrapDefaultFor(width), fontSize: 12, rawTerminal: false };
}

function clampFont(n: number): number {
  return Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(n)));
}

function loadPrefs(): DisplayPrefs {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    const DEFAULTS = defaults();
    if (!raw) return DEFAULTS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULTS;
    const p = parsed as Record<string, unknown>;
    return {
      wrap: typeof p.wrap === "boolean" ? p.wrap : DEFAULTS.wrap,
      fontSize: typeof p.fontSize === "number" ? clampFont(p.fontSize) : DEFAULTS.fontSize,
      rawTerminal: typeof p.rawTerminal === "boolean" ? p.rawTerminal : DEFAULTS.rawTerminal,
    };
  } catch {
    return defaults();
  }
}

/**
 * The raw-terminal pref, read straight from storage for non-React callers.
 *
 * The pane loader has to pick Herdr's read source before any component renders, and a loader can't
 * call a hook. Same storage, same parsing — so the source and the grammars can never disagree about
 * which mode we're in.
 */
export function rawTerminalPref(): boolean {
  return loadPrefs().rawTerminal;
}

function savePrefs(prefs: DisplayPrefs): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    }
  } catch {
    // Ignore quota / SSR write errors.
  }
}

export interface UseDisplayPrefsReturn {
  prefs: DisplayPrefs;
  /** Toggle or explicitly set line-wrap. */
  setWrap: (wrap: boolean) => void;
  /** Set font size, clamped to 9–16. */
  setFontSize: (size: number) => void;
  /** Step font size by delta (positive = larger), clamped to 9–16. */
  stepFontSize: (delta: number) => void;
  /** Toggle or explicitly set the raw-terminal escape hatch. */
  setRawTerminal: (raw: boolean) => void;
}

export function useDisplayPrefs(): UseDisplayPrefsReturn {
  const [prefs, setPrefs] = useState<DisplayPrefs>(loadPrefs);

  const setWrap = useCallback((wrap: boolean) => {
    setPrefs((p) => {
      const next: DisplayPrefs = { ...p, wrap };
      savePrefs(next);
      return next;
    });
  }, []);

  const setFontSize = useCallback((size: number) => {
    setPrefs((p) => {
      const next: DisplayPrefs = { ...p, fontSize: clampFont(size) };
      savePrefs(next);
      return next;
    });
  }, []);

  const stepFontSize = useCallback((delta: number) => {
    setPrefs((p) => {
      const next: DisplayPrefs = { ...p, fontSize: clampFont(p.fontSize + delta) };
      savePrefs(next);
      return next;
    });
  }, []);

  const setRawTerminal = useCallback((rawTerminal: boolean) => {
    setPrefs((p) => {
      const next: DisplayPrefs = { ...p, rawTerminal };
      savePrefs(next);
      return next;
    });
  }, []);

  return { prefs, setWrap, setFontSize, stepFontSize, setRawTerminal };
}
