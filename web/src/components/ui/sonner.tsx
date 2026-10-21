import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

import { useIsDesktop } from "@/hooks/use-media-query";
import { useT } from "@/i18n";
import { loadThemeMode } from "@/lib/theme";

// shadcn's Sonner wrapper, mounted ONCE in routes/root.tsx: every setStatus() and every agent ping
// lands in this one stack. Top, under the header — never at the bottom, where it would cover the
// composer and the terminal's tail — and clear of the header itself, which is how you leave a screen.
// Sonner's own CSS is injected as a <style> tag, which the CSP's `style-src 'unsafe-inline'` allows,
// and it already honours prefers-reduced-motion.
const UNDER_HEADER = { top: "calc(env(safe-area-inset-top) + 4.25rem)" };

export function Toaster(props: ToasterProps) {
  const t = useT();
  const desktop = useIsDesktop();
  return (
    <Sonner
      // Read on every render: root re-renders on each poll, so a theme change in Settings lands soon.
      theme={loadThemeMode()}
      position={desktop ? "top-right" : "top-center"}
      offset={UNDER_HEADER}
      mobileOffset={UNDER_HEADER}
      richColors
      toastOptions={{ closeButtonAriaLabel: t("toast.dismiss") }}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as CSSProperties
      }
      {...props}
    />
  );
}
