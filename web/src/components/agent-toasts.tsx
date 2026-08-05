import { useEffect } from "react";
import { X } from "lucide-react";
import { useNavigate } from "react-router";

import { panePath } from "@/lib/nav";
import type { AgentToast } from "@/hooks/use-transitions";

// The foreground notification: an agent blocked or finished while you were using the app. It lands
// as a toast under the header — floating, so nothing on screen moves and the screen you're on stays
// usable (the stack is pointer-events-none; only the toasts themselves take taps). Tapping one
// deep-links into the pane that pinged, in its own session, exactly like the bell's history.
//
// Under the header, not over it: the header is how you leave a screen, and a notice that covered the
// back chevron and the bell would be the one overlay you can't get past. Bottom was already taken —
// it covers the terminal tail and the composer, which is why the old status toasts moved out of it.
//
// Deliberately NOT the shared status line (lib/status.ts): that one is latest-wins and shared with
// every "Sent ✓", so a ping arriving a second after a send was overwritten before it was read.

/** How long a toast stays up. Longer than a send confirmation — this one is worth reading and tapping. */
const TOAST_TTL_MS = 6000;

export function AgentToasts({
  toasts,
  onDismiss,
}: {
  toasts: AgentToast[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    // aria-live sits on the inert wrapper, never on a toast: a live region that is also a click
    // target announces as neither (same rule as StatusArea).
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-30 mx-auto flex w-full max-w-screen-sm flex-col gap-2 px-3 [top:calc(env(safe-area-inset-top)_+_4.25rem)] lg:max-w-md"
    >
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function Toast({ toast, onDismiss }: { toast: AgentToast; onDismiss: (id: number) => void }) {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_TTL_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-border/60 bg-background/95 shadow-lg backdrop-blur duration-(--duration-long) ease-enter animate-in fade-in slide-in-from-top-2">
      <button
        type="button"
        onClick={() => {
          onDismiss(toast.id);
          navigate(panePath(toast.paneId, toast.session));
        }}
        className="flex min-w-0 flex-1 items-baseline gap-2 rounded-l-xl py-2.5 pl-3 text-left transition-colors active:bg-muted"
      >
        <span
          className={
            toast.status === "blocked"
              ? "size-2 shrink-0 translate-y-[-1px] rounded-full bg-status-blocked"
              : "size-2 shrink-0 translate-y-[-1px] rounded-full bg-status-done"
          }
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{toast.title}</span>
          <span className="block truncate text-xs text-muted-foreground">{toast.detail}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-70 transition-opacity hover:opacity-100 active:bg-muted/60"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
