import { useCallback, useMemo, useState } from "react";

import { useMediaQuery } from "@/hooks/use-media-query";

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
  /**
   * Reading mode (default: false). The pane screen has two modes of the same screen, not two screens:
   * TERMINAL is the mirror — faithful to the TUI, native dialog buttons, the mode you PILOT in — and
   * READING renders the agent's own transcript as prose, which is the mode you READ in. Per device,
   * because it's about the screen in your hand: the same conversation is worth mirroring on a laptop
   * and worth reflowing on a phone.
   */
  reading: boolean;
}

const STORAGE_KEY = "collie:display-prefs:v3";
const FONT_MIN = 9;
const FONT_MAX = 16;
/**
 * Width below which line wrap defaults ON.
 *
 * At 12px monospace a character is ~7px, so ~80 columns needs ~560px. Panes here measure a median
 * of 81 columns and a max of 233 — on a phone that means most lines run off the edge, and reading
 * the mirror becomes a horizontal pan. It is a VIEWPORT threshold, not a container one — the
 * routes no longer stop at 640px above `lg`, but a viewport narrower than that still can't show
 * 80 columns.
 */
const WRAP_BELOW_PX = 640;

/**
 * The same threshold as a media query, so the default follows the screen instead of whatever the
 * screen happened to be at mount. One viewport reader in the app (`useMediaQuery`), not two: a
 * window dragged wider, or dropped onto an external display, re-decides the default — until the
 * user touches the toggle, at which point the stored choice wins forever.
 */
const NARROW_VIEWPORT = `(width < ${WRAP_BELOW_PX}px)`;

/** What storage actually holds: `wrap` is ABSENT until the user picks one, so it can stay reactive. */
type StoredPrefs = Omit<DisplayPrefs, "wrap"> & { wrap?: boolean };

const DEFAULTS: StoredPrefs = { fontSize: 12, rawTerminal: false, reading: false };

function clampFont(n: number): number {
  return Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(n)));
}

function loadPrefs(): StoredPrefs {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return DEFAULTS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULTS;
    const p = parsed as Record<string, unknown>;
    return {
      ...(typeof p.wrap === "boolean" ? { wrap: p.wrap } : {}),
      fontSize: typeof p.fontSize === "number" ? clampFont(p.fontSize) : DEFAULTS.fontSize,
      rawTerminal: typeof p.rawTerminal === "boolean" ? p.rawTerminal : DEFAULTS.rawTerminal,
      reading: typeof p.reading === "boolean" ? p.reading : DEFAULTS.reading,
    };
  } catch {
    return DEFAULTS;
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

function savePrefs(prefs: StoredPrefs): void {
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
  /** Switch the pane screen between the terminal mirror and the reading view. */
  setReading: (reading: boolean) => void;
}

export function useDisplayPrefs(): UseDisplayPrefsReturn {
  const [stored, setPrefs] = useState<StoredPrefs>(loadPrefs);
  const narrow = useMediaQuery(NARROW_VIEWPORT);
  const prefs = useMemo<DisplayPrefs>(() => ({ ...stored, wrap: stored.wrap ?? narrow }), [stored, narrow]);

  const setWrap = useCallback((wrap: boolean) => {
    setPrefs((p) => {
      const next: StoredPrefs = { ...p, wrap };
      savePrefs(next);
      return next;
    });
  }, []);

  const setFontSize = useCallback((size: number) => {
    setPrefs((p) => {
      const next: StoredPrefs = { ...p, fontSize: clampFont(size) };
      savePrefs(next);
      return next;
    });
  }, []);

  const stepFontSize = useCallback((delta: number) => {
    setPrefs((p) => {
      const next: StoredPrefs = { ...p, fontSize: clampFont(p.fontSize + delta) };
      savePrefs(next);
      return next;
    });
  }, []);

  const setRawTerminal = useCallback((rawTerminal: boolean) => {
    setPrefs((p) => {
      const next: StoredPrefs = { ...p, rawTerminal };
      savePrefs(next);
      return next;
    });
  }, []);

  const setReading = useCallback((reading: boolean) => {
    setPrefs((p) => {
      const next: StoredPrefs = { ...p, reading };
      savePrefs(next);
      return next;
    });
  }, []);

  return { prefs, setWrap, setFontSize, stepFontSize, setRawTerminal, setReading };
}
