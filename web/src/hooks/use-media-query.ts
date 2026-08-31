import { useCallback, useMemo, useSyncExternalStore } from "react";

// A media query as reactive state — the app's ONE viewport reader.
//
// There used to be a second one: `wrapDefaultFor(window.innerWidth)` in use-display-prefs, read once
// at mount, deaf to a window dragged wider or a laptop dropped onto an external display. It goes
// through this hook now, at the same 640px threshold.
//
// Layout itself belongs in CSS (`lg:` and container queries do all of it here). This exists for the
// one thing CSS can't reach: a PROP, like the drawer's direction, or a stored preference's default.

/** Tailwind's own `lg` breakpoint, in the same unit, so CSS and JS can't disagree about "wide". */
const DESKTOP = "(min-width: 64rem)";

export function useMediaQuery(query: string): boolean {
  const mql = useMemo(
    () =>
      typeof window === "undefined" || typeof window.matchMedia !== "function"
        ? null
        : window.matchMedia(query),
    [query],
  );
  const subscribe = useCallback(
    (onChange: () => void) => {
      mql?.addEventListener("change", onChange);
      return () => mql?.removeEventListener("change", onChange);
    },
    [mql],
  );
  // Server snapshot is `false` — narrow is the honest default for something that is a phone app first.
  return useSyncExternalStore(subscribe, () => mql?.matches ?? false, () => false);
}

/** True at and above Tailwind's `lg` — the one breakpoint the desktop layout turns on at. */
export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP);
}
