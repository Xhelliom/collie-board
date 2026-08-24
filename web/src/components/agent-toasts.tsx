import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";
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

/** Drag a toast this far sideways (px) and letting go dismisses it; anything shorter springs back. */
const SWIPE_DISMISS_PX = 72;
/** Past this the gesture is a swipe, not a tap — the ensuing click must not deep-link into the pane. */
const SWIPE_SLOP_PX = 8;

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
  // Swipe-to-dismiss, either direction. Touch pointers are implicitly captured to their target, so
  // no setPointerCapture is needed for the gesture that matters; `touch-pan-y` keeps the page's own
  // vertical scroll while claiming the horizontal axis. `dragged` suppresses the click that a
  // release fires on the inner button — a swipe must not also navigate (same trick as useLongPress).
  const startX = useRef<number | null>(null);
  const dragged = useRef(false);
  const [dx, setDx] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_TTL_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    startX.current = e.clientX;
    dragged.current = false;
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (startX.current === null) return;
    const moved = e.clientX - startX.current;
    if (Math.abs(moved) > SWIPE_SLOP_PX) dragged.current = true;
    setDx(moved);
  };

  const onPointerUp = () => {
    if (startX.current === null) return;
    startX.current = null;
    if (Math.abs(dx) >= SWIPE_DISMISS_PX) onDismiss(toast.id);
    else setDx(0);
  };

  const onPointerCancel = () => {
    startX.current = null;
    setDx(0);
  };

  const onClickCapture = (e: ReactMouseEvent) => {
    if (!dragged.current) return;
    dragged.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    // The entrance animation lives on the wrapper, the swipe transform on the card: a running
    // `animate-in` sets `transform` with animation-fill-mode both, which would beat the inline style.
    <div className="duration-(--duration-long) ease-enter animate-in fade-in slide-in-from-top-2">
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerCancel}
        onPointerCancel={onPointerCancel}
        onClickCapture={onClickCapture}
        style={{
          transform: dx ? `translateX(${dx}px)` : undefined,
          opacity: dx ? Math.max(0.25, 1 - Math.abs(dx) / (SWIPE_DISMISS_PX * 2)) : undefined,
          // While the finger is down the card tracks it 1:1; on release the same properties animate.
          transitionDuration: dx ? "0s" : undefined,
        }}
        className="pointer-events-auto flex touch-pan-y items-center gap-1 rounded-xl border border-border/60 bg-background/95 shadow-lg backdrop-blur transition-[transform,opacity] ease-enter"
      >
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
            <span className="line-clamp-2 text-xs text-muted-foreground">{toast.detail}</span>
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
    </div>
  );
}
