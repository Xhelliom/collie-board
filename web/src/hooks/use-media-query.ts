import { useCallback, useMemo, useSyncExternalStore } from "react";

// A media query as reactive state.
//
// The app already had a width test — `wrapDefaultFor(window.innerWidth)` in use-display-prefs — but
// that one reads once at mount and never hears about a resize. Which is right for it: its whole job
// is to pick a default the user then overrides forever. It is wrong for layout, where a desktop
// window gets dragged wider and a sheet that opened from the bottom at 900px has to know it is at
// 1400px now.
//
// Layout itself belongs in CSS (`lg:` and container queries do all of it here). This exists for the
// one thing CSS can't reach: a PROP, like the drawer's direction.

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
