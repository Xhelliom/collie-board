import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Minimal modal focus handling (no deps, no full trap): on open move focus into the panel so
// keyboard / screen-reader users land inside the dialog; on close restore focus to whatever was
// focused before it opened. The panel must carry tabIndex={-1} to be a focus target.
function useDialogFocus(open: boolean, panelRef: React.RefObject<HTMLElement | null>) {
  React.useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [open, panelRef]);
}

// A prop kept in a ref refreshed on every render, so an effect can call the LATEST value without
// listing it as a dependency. Callers pass `onClose` as an inline lambda (a new identity every
// render); with `onClose` in the dependency array the key/touch listeners tore down and re-attached
// on every parent render — mid-gesture, that dropped the drag. Fixing it here rather than asking
// the four call sites for a useCallback means a future call site can't reintroduce the bug.
function useLatest<T>(value: T) {
  const ref = React.useRef(value);
  ref.current = value;
  return ref;
}

// A touch that starts on a control, or inside something that scrolls on its own, belongs to that
// control / that scroller — never to the pull-to-dismiss. Same selector as agent-chat.tsx, same
// reason. The panel itself is excluded from the scroll walk: its own `scrollTop <= 0` arbitrates.
const INTERACTIVE_TARGET = "button, a, input, textarea, select, [role='textbox']";

function ownsVerticalScroll(start: Element | null, panel: HTMLElement) {
  for (let el = start; el && el !== panel; el = el.parentElement) {
    const overflowY = getComputedStyle(el).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight)
      return true;
  }
  return false;
}

// Exit animation duration. Must match the `duration-200` on the panel / backdrop below.
const CLOSE_MS = 200;

// A minimal bottom sheet — no Radix, no portals, no extra deps. Renders nothing when closed.
// Dismisses on backdrop tap or Escape. Animations come from tw-animate-css (already imported).
interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

const IDLE_DRAG = { startY: 0, atTop: false, engaged: false, dy: 0 };

export function BottomSheet({ open, onClose, title, children, className }: BottomSheetProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef({ ...IDLE_DRAG });
  // `null` = open. "auto" = closing by ✕ / Escape / backdrop (play the exit animation). "drag" = the
  // finger already carried the sheet down, so it finishes its own course instead of snapping back to
  // rest to replay that animation.
  const [closing, setClosing] = React.useState<null | "auto" | "drag">(null);
  const closeTimer = React.useRef<number | undefined>(undefined);
  const titleId = React.useId();
  const onCloseRef = useLatest(onClose);
  useDialogFocus(open, panelRef);

  // Closing is animated: the sheet slides out and only THEN is unmounted (it used to vanish in one
  // frame — the bulk of the "brutal" feel). All four dismiss paths go through here.
  const requestClose = React.useCallback(
    (mode: "auto" | "drag" = "auto") => {
      if (closeTimer.current !== undefined) return; // already closing
      const panel = panelRef.current;
      if (mode === "drag" && panel) {
        panel.style.transition = `transform ${CLOSE_MS}ms ease-out`;
        panel.style.transform = "translateY(100%)";
      }
      setClosing(mode);
      closeTimer.current = window.setTimeout(() => {
        closeTimer.current = undefined;
        setClosing(null);
        onCloseRef.current();
      }, CLOSE_MS);
    },
    [onCloseRef],
  );

  // Backdrop dismiss requires press AND release on the backdrop itself (the Radix
  // outside-pointerdown rule) — NOT just whatever the browser happens to synthesize a `click` on. A
  // long-press that opens this sheet has its finger still down at the moment the sheet mounts; the
  // browser's release click then lands on whatever is now under the finger, which is the backdrop —
  // and without this guard that click would immediately close the sheet it just opened. Arming only
  // on a backdrop `pointerdown` means a click that originated elsewhere (e.g. the pill's release)
  // never dismisses.
  const backdropArmed = React.useRef(false);

  // On open: nothing of the previous gesture survives — leftover drag state replayed on the first
  // render and made the sheet flicker back into place. The background is also frozen while a sheet
  // is up, so a pull that escapes the panel doesn't scroll the page behind it.
  React.useEffect(() => {
    if (!open) return;
    backdropArmed.current = false;
    setClosing(null);
    const panel = panelRef.current;
    if (panel) {
      panel.style.transition = "";
      panel.style.transform = "";
    }
    // ponytail: one global lock — two sheets open at once doesn't happen here. Ref-count it if it does.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      clearTimeout(closeTimer.current);
      closeTimer.current = undefined;
      // A parent that closes us on its own (navigation) mid-animation must not leave `closing` set:
      // the next open would render one frame of the exit animation. Same residue bug as the drag.
      setClosing(null);
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, requestClose]);

  // Drag-to-dismiss: pull the sheet down from the top to close it. The touchmove listener is
  // attached NON-PASSIVE so we can `preventDefault()` the downward pull — that's what suppresses
  // the browser's pull-to-refresh (otherwise a pull-down at the top would reload the whole app
  // instead of closing the sheet). A gesture that starts mid-scroll falls through to normal list
  // scrolling; only a pull that begins at the top engages the dismiss.
  React.useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const SLOP = 6; // ignore taps / tiny jitter before engaging the drag
    const CLOSE = 90; // px past which release closes instead of snapping back

    const onStart = (e: TouchEvent) => {
      drag.current = { ...IDLE_DRAG }; // disarmed until this gesture proves it owns the pull
      const t = e.touches[0];
      if (!t) return;
      const target = e.target as Element | null;
      if (target?.closest?.(INTERACTIVE_TARGET)) return;
      if (ownsVerticalScroll(target, panel)) return;
      drag.current = { startY: t.clientY, atTop: panel.scrollTop <= 0, engaged: false, dy: 0 };
    };
    const onMove = (e: TouchEvent) => {
      const d = drag.current;
      if (!d.atTop) return;
      const t = e.touches[0];
      if (!t) return;
      const dy = t.clientY - d.startY;
      if (!d.engaged && dy > SLOP) {
        d.engaged = true;
        panel.style.transition = "none"; // follow the finger 1:1, no easing lag
      }
      if (d.engaged) {
        e.preventDefault();
        const off = Math.max(0, dy);
        d.dy = off;
        panel.style.transform = `translateY(${off}px)`; // straight to the DOM: no React render per frame
      }
    };
    const onEnd = () => {
      const off = drag.current.dy;
      drag.current = { ...IDLE_DRAG };
      if (!off) return; // a tap, not a pull — leave the panel's style alone
      panel.style.transition = `transform ${CLOSE_MS}ms ease-out`;
      if (off > CLOSE) requestClose("drag");
      else panel.style.transform = "";
    };

    panel.addEventListener("touchstart", onStart, { passive: true });
    panel.addEventListener("touchmove", onMove, { passive: false });
    panel.addEventListener("touchend", onEnd);
    panel.addEventListener("touchcancel", onEnd);
    return () => {
      panel.removeEventListener("touchstart", onStart);
      panel.removeEventListener("touchmove", onMove);
      panel.removeEventListener("touchend", onEnd);
      panel.removeEventListener("touchcancel", onEnd);
    };
  }, [open, requestClose]);

  if (!open) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex flex-col justify-end",
        closing && "pointer-events-none", // the sheet is on its way out: no second dismiss mid-flight
      )}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
    >
      {/* Backdrop: still dismisses on tap, but hidden from assistive tech — the ✕ in the header is
          the single accessible "Close", so the dialog isn't announced with a giant duplicate. Dismiss
          fires only when the pointer went DOWN on the backdrop too — see backdropArmed above. */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        className={cn(
          "absolute inset-0 bg-black/50 duration-200",
          closing ? "animate-out fade-out fill-mode-forwards" : "animate-in fade-in",
        )}
        onPointerDown={() => {
          backdropArmed.current = true;
        }}
        onClick={() => {
          if (!backdropArmed.current) return;
          backdropArmed.current = false;
          requestClose();
        }}
      />
      {/* No inline `style` here: the drag writes transform/transition straight onto the node, and a
          React-owned style prop would fight it (and re-render every frame). */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "relative z-10 max-h-[82dvh] w-full overflow-y-auto overscroll-contain rounded-t-2xl border-t border-border bg-background shadow-2xl duration-200",
          closing === "auto" && "animate-out slide-out-to-bottom fill-mode-forwards",
          !closing && "animate-in slide-in-from-bottom",
          "pb-[calc(env(safe-area-inset-bottom)_+_1rem)]",
          className,
        )}
      >
        <div className="sticky top-0 z-10 border-b border-border/60 bg-background/95 backdrop-blur-md">
          {/* Grab handle — pull down (from anywhere at the top) to dismiss. */}
          <div className="flex justify-center pt-2 pb-1">
            <span className="h-1 w-9 rounded-full bg-muted-foreground/40" />
          </div>
          <div className="flex items-center justify-between px-4 pb-3">
            <span id={title ? titleId : undefined} className="text-sm font-semibold">
              {title}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => requestClose()}
              aria-label="Close"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
        <div className="px-4 py-3">{children}</div>
      </div>
    </div>
  );
}

// A left-edge drawer — same no-deps approach as BottomSheet, but slides in from the side and fills
// the viewport height with a scrollable body. Used for the thread sidebar (TUI-style switcher).
interface SideSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Optional action(s) rendered in the header, to the left of the close (✕) button. */
  headerAction?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function SideSheet({
  open,
  onClose,
  title,
  headerAction,
  children,
  footer,
  className,
}: SideSheetProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const onCloseRef = useLatest(onClose);
  useDialogFocus(open, panelRef);

  // Backdrop dismiss requires press AND release on the backdrop itself (the Radix
  // outside-pointerdown rule) — NOT just whatever the browser happens to synthesize a `click` on. A
  // long-press that opens this sheet has its finger still down at the moment the sheet mounts; the
  // browser's release click then lands on whatever is now under the finger, which is the backdrop —
  // and without this guard that click would immediately close the sheet it just opened. Arming only
  // on a backdrop `pointerdown` means a click that originated elsewhere (e.g. the pill's release)
  // never dismisses.
  const backdropArmed = React.useRef(false);
  React.useEffect(() => {
    if (open) backdropArmed.current = false;
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCloseRef]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "relative z-10 flex h-full w-[86%] max-w-sm flex-col border-r border-border bg-background shadow-2xl duration-200 animate-in slide-in-from-left",
          className,
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur-md [padding-top:calc(env(safe-area-inset-top)_+_0.75rem)]">
          <span id={title ? titleId : undefined} className="text-sm font-semibold">
            {title}
          </span>
          <div className="flex items-center gap-1">
            {headerAction}
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-border/60 px-3 py-2 pb-[calc(env(safe-area-inset-bottom)_+_0.5rem)]">
            {footer}
          </div>
        )}
      </div>
      {/* Backdrop: dismisses on tap but hidden from assistive tech — the header ✕ is the accessible
          "Close", so the drawer isn't announced with a giant duplicate close target. Dismiss fires
          only when the pointer went DOWN on the backdrop too — see backdropArmed above. */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        className="flex-1 bg-black/50 duration-200 animate-in fade-in"
        onPointerDown={() => {
          backdropArmed.current = true;
        }}
        onClick={() => {
          if (!backdropArmed.current) return;
          backdropArmed.current = false;
          onClose();
        }}
      />
    </div>
  );
}
