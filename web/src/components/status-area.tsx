import { useCallback } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { clearStatus, useStatus, type StatusTone } from "@/lib/status";
import { useT } from "@/i18n";

// A slim, self-contained status line. Mounted ONCE, in routes/root.tsx, inside a pointer-events-none
// overlay pinned above the mobile tab bar (and above whatever bottom bar lifts it), it shows the latest status with a tone colour
// + icon. Non-errors fade on their own; errors persist until dismissed — the bar re-enables pointer
// events and shows a real ✕ button for that. Renders nothing when there's no status.
//
// The dismiss lives on a <button>, not on the bar: an error notice is the ONE thing in the app you
// have to actively clear, so it can't be the one thing a keyboard can't reach. The container keeps
// role="status" and stays inert — a live region that is also a click target announces as neither.
//
// Which is also why ONLY the button re-enables pointer events. The bar floats over the content on
// every screen (its wrapper is pointer-events-none for exactly that reason); a bar that
// swallowed taps without acting on them would be a dead strip across whatever sits beneath it.
const TONE: Record<StatusTone, string> = {
  info: "text-muted-foreground",
  success: "text-status-done",
  warn: "text-status-working",
  error: "text-status-blocked",
};

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warn: AlertTriangle,
  error: AlertCircle,
} as const;

export function StatusArea({ className }: { className?: string }) {
  const t = useT();
  const status = useStatus();
  if (!status) return null;
  const Icon = ICONS[status.tone];
  const dismissable = status.tone === "error";
  return (
    <div
      key={status.id}
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-md border bg-background/95 px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur duration-(--duration-long) ease-enter animate-in fade-in",
        dismissable ? "border-status-blocked/50" : "border-border/60",
        TONE[status.tone],
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{status.text}</span>
      {dismissable && (
        <button
          type="button"
          onClick={() => clearStatus()}
          aria-label={t("spaces.dismiss")}
          className="pointer-events-auto -mr-1 flex size-5 shrink-0 items-center justify-center rounded opacity-70 transition-opacity hover:opacity-100 active:bg-muted/60"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * A callback ref for a bottom-pinned bar (the pane's composer, the board's run button): while it is
 * mounted, the status line sits above it instead of over it. One bar at a time — the last one wins.
 */
export function useStatusLift(): (el: HTMLElement | null) => (() => void) | undefined {
  return useCallback((el: HTMLElement | null) => {
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const root = document.documentElement.style;
    const ro = new ResizeObserver(() => root.setProperty("--status-lift", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.removeProperty("--status-lift");
    };
  }, []);
}

/**
 * The app's one status line, pinned to the bottom: above the mobile tab bar (its height is
 * ABOVE_TAB_BAR's), plus whatever `--status-lift` a bottom bar claims. Same place on every screen.
 */
export function StatusOverlay() {
  return (
    <div className="pointer-events-none fixed inset-x-0 z-30 mx-auto w-full max-w-screen-sm px-3 lg:max-w-none bottom-[calc(var(--status-lift,0px)+0.75rem+env(safe-area-inset-bottom))] max-lg:bottom-[calc(var(--status-lift,0px)+3.5rem+0.875rem+1px+0.5rem+env(safe-area-inset-bottom))]">
      <StatusArea />
    </div>
  );
}
