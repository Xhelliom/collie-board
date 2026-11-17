import { useEffect, useState } from "react";
import { useNavigation, useRevalidator } from "react-router";

// A normal poll settles in well under 300ms, so this threshold never trips on healthy traffic — it
// deliberately preserves the "no flicker on every tick" property. It only fires when a poll genuinely
// hangs (a black-holed fetch on a sleeping/wandering phone).
const DEFAULT_THRESHOLD_MS = 2_500;

// A navigation chains several loaders, and on a busy bridge each can wait 0.2–1.4s behind another
// route (docs/dev/audit-perf-2026-11.md §1.1): 2.5s was crossed with no network fault at all, and the
// dog said "reconnecting" on a mere page change. A slow navigation already shows the busy bar at
// 500ms (use-poll-busy); only one still hanging this long reads as a lost connection. Kept under
// GET_TIMEOUT_MS (10s, lib/api) so a black-holed tap gallops before the loader's own error lands.
export const NAV_STALL_MS = 8_000;

/**
 * True once a load has been in flight continuously past its threshold: a background revalidation
 * (`useRevalidator`, the poll) after `thresholdMs`, a route navigation (`useNavigation`, e.g. tapping
 * a pane row waits on its loader) after `navThresholdMs`. Resets to false the moment BOTH go idle.
 *
 * Navigation still counts — a black-holed pane-open tap must give feedback, and the poll does not
 * fetch on its own while a navigation is pending — but later than the poll, so a merely slow page
 * change stays on the busy bar instead of the "reconnecting" dog. Feeds `isConnecting`.
 */
export function useLoadingStalled(thresholdMs = DEFAULT_THRESHOLD_MS, navThresholdMs = NAV_STALL_MS): boolean {
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  // One "how long until stalled" value drives a single timer; the effect re-runs only when it changes,
  // so a burst of fast polls never trips it and going idle clears it at once.
  const wait =
    revalidator.state === "loading" ? thresholdMs : navigation.state !== "idle" ? navThresholdMs : null;
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    if (wait === null) {
      setStalled(false);
      return;
    }
    const id = window.setTimeout(() => setStalled(true), wait);
    return () => clearTimeout(id);
  }, [wait]);

  return stalled;
}
