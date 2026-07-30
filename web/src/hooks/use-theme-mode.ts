import { useState } from "react";

import { applyTheme, loadThemeMode, saveThemeMode, type ThemeMode } from "@/lib/theme";

// Settings-facing control over the theme preference. Applies + persists immediately on change —
// useThemeSync (mounted once at the app root) is what keeps the class correct afterwards, so this
// hook doesn't need to own the OS-change listener too.
export function useThemeMode(): { mode: ThemeMode; setMode: (mode: ThemeMode) => void } {
  const [mode, setModeState] = useState<ThemeMode>(loadThemeMode);

  function setMode(next: ThemeMode) {
    saveThemeMode(next);
    applyTheme(next);
    setModeState(next);
  }

  return { mode, setMode };
}
