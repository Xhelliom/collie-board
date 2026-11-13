import { useEffect } from "react";

import { applyTheme, loadThemeMode } from "@/lib/theme";

// Keeps the `.dark` class correct for the app's whole lifetime, independent of whether Settings is
// on screen: applies the stored preference on mount (index.html's inline script already did this
// before first paint — this is the belt to its suspenders) and re-applies on a live OS theme change
// while the preference is "system". Mount once, at the app root (App.tsx).
export function useThemeSync(): void {
  useEffect(() => {
    applyTheme(loadThemeMode());
    try {
      localStorage.removeItem("collie:style"); // the retired Classique choice, from before 13/11
    } catch {
      // Private mode: nothing was stored.
    }
    if (typeof matchMedia === "undefined") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(loadThemeMode());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
}
