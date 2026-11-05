import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Minus, Plus, X } from "lucide-react";

import { AnsiOutput } from "@/components/ansi-output";
import { useT } from "@/i18n";
import {
  MIN_ZOOM,
  TAP_SLOP,
  ZOOM_STEP,
  clampScale,
  distance,
  doubleTapTarget,
  formatScale,
  isDoubleTap,
  pinchMove,
  pinchStart,
  zoomAbout,
  type PinchStart,
  type Point,
  type Tap,
  type ZoomView,
} from "@/lib/zoom-gesture";

// THE PANE'S OUTPUT, FULL SCREEN. Pinch zooms about the fingers (to ×6), one finger pans natively,
// double tap toggles 1× ⇄ 2.5×, the header buttons step for a one-pointer reader. Read-only: the text
// is the pane loader's, rendered by AnsiOutput (React text nodes), NEVER wrapped so a pinch only
// scales a row and a sideways pan reaches its end. Listeners are native and non-passive: a two-finger
// move must preventDefault the browser's own pinch, and React attaches touch handlers passive.

export interface OutputZoomProps {
  text: string;
  fontSize: number;
  title: string;
  onClose: () => void;
}

export function OutputZoom({ text, fontSize, title, onClose }: OutputZoomProps) {
  const t = useT();
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(MIN_ZOOM);
  // The text's own laid-out size (a transform doesn't change it); 0 until measured.
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const scaleRef = useRef(scale);
  // A gesture's scroll offset waits here for the render that sizes the box to its scale.
  const pendingScroll = useRef<Point | null>(null);
  // Opens on the tail and stays on it while rows arrive, until the reader scrolls away.
  const following = useRef(true);

  const flushScroll = useCallback(() => {
    const vp = viewportRef.current;
    const next = pendingScroll.current;
    if (!vp || !next) return;
    pendingScroll.current = null;
    // The browser clamps scrollLeft/Top to the box it now has.
    vp.scrollLeft = next.x;
    vp.scrollTop = next.y;
  }, []);

  const apply = useCallback(
    (next: ZoomView) => {
      following.current = false;
      pendingScroll.current = next.scroll;
      const changed = next.scale !== scaleRef.current;
      scaleRef.current = next.scale;
      setScale(next.scale);
      // An unchanged scale renders nothing, so the layout effect below won't flush it.
      if (!changed) flushScroll();
    },
    [flushScroll],
  );

  const currentView = useCallback((): ZoomView => {
    const vp = viewportRef.current;
    return { scale: scaleRef.current, scroll: { x: vp?.scrollLeft ?? 0, y: vp?.scrollTop ?? 0 } };
  }, []);

  const zoomCentred = useCallback(
    (next: number) => {
      const vp = viewportRef.current;
      apply(zoomAbout(currentView(), { x: (vp?.clientWidth ?? 0) / 2, y: (vp?.clientHeight ?? 0) / 2 }, next));
    },
    [apply, currentView],
  );

  useLayoutEffect(flushScroll, [scale, flushScroll]);

  useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (vp && following.current) vp.scrollTop = vp.scrollHeight;
  }, [natural.height, text]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() =>
      setNatural((prev) =>
        prev.width === content.offsetWidth && prev.height === content.offsetHeight
          ? prev
          : { width: content.offsetWidth, height: content.offsetHeight },
      ),
    );
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") zoomCentred(scaleRef.current * ZOOM_STEP);
      else if (e.key === "-") zoomCentred(scaleRef.current / ZOOM_STEP);
      else if (e.key === "0") zoomCentred(MIN_ZOOM);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, zoomCentred]);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    let pinch: PinchStart | null = null;
    let press: { point: Point; moved: boolean } | null = null;
    let lastTap: Tap | null = null;
    const rel = (touch: Touch): Point => {
      const rect = vp.getBoundingClientRect();
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    };

    const onStart = (e: TouchEvent) => {
      const [a, b] = [e.touches[0], e.touches[1]];
      if (a && b) {
        pinch = pinchStart(currentView(), rel(a), rel(b));
        press = null;
        lastTap = null;
      } else if (a && e.touches.length === 1) {
        press = { point: rel(a), moved: false };
      }
    };
    const onMove = (e: TouchEvent) => {
      const [a, b] = [e.touches[0], e.touches[1]];
      if (pinch && a && b) {
        if (e.cancelable) e.preventDefault();
        apply(pinchMove(pinch, rel(a), rel(b)));
      } else if (press && a && distance(rel(a), press.point) > TAP_SLOP) {
        press.moved = true;
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (pinch) {
        // A finger left: the pinch is over; one still down pans natively. No tap.
        if (e.touches.length < 2) pinch = null;
        press = null;
        return;
      }
      if (press && !press.moved && e.touches.length === 0) {
        const tap: Tap = { at: e.timeStamp, point: press.point };
        if (isDoubleTap(lastTap, tap)) {
          if (e.cancelable) e.preventDefault();
          const now = currentView();
          apply(zoomAbout(now, tap.point, doubleTapTarget(now.scale)));
          lastTap = null;
        } else {
          lastTap = tap;
        }
      } else if (press?.moved) {
        lastTap = null;
      }
      press = null;
    };
    const onCancel = () => {
      pinch = null;
      press = null;
    };
    // A trackpad's pinch arrives as a ctrl+wheel.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      const now = currentView();
      apply(zoomAbout(now, { x: e.clientX - rect.left, y: e.clientY - rect.top }, now.scale * Math.exp(-e.deltaY * 0.01)));
    };

    vp.addEventListener("touchstart", onStart, { passive: true });
    vp.addEventListener("touchmove", onMove, { passive: false });
    vp.addEventListener("touchend", onEnd, { passive: false });
    vp.addEventListener("touchcancel", onCancel);
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      vp.removeEventListener("touchstart", onStart);
      vp.removeEventListener("touchmove", onMove);
      vp.removeEventListener("touchend", onEnd);
      vp.removeEventListener("touchcancel", onCancel);
      vp.removeEventListener("wheel", onWheel);
    };
  }, [apply, currentView]);

  const onScroll = () => {
    const vp = viewportRef.current;
    if (vp) following.current = vp.scrollTop + vp.clientHeight >= vp.scrollHeight - 4;
  };

  const measured = natural.width > 0 && natural.height > 0;
  const label = formatScale(scale);
  const iconBtn =
    "flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 active:bg-muted/60 disabled:opacity-40";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("zoom.open")}
      data-slot="output-zoom"
      className="fixed inset-0 z-50 flex flex-col bg-terminal-background"
    >
      <div className="flex min-h-12 shrink-0 items-center gap-1 border-b border-border bg-background px-1 pt-[env(safe-area-inset-top)]">
        <button type="button" className={iconBtn} aria-label={t("zoom.close")} onClick={onClose}>
          <X className="size-5" />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>
        <button
          type="button"
          className={iconBtn}
          aria-label={t("zoom.out")}
          disabled={scale <= MIN_ZOOM}
          onClick={() => zoomCentred(scale / ZOOM_STEP)}
        >
          <Minus className="size-5" />
        </button>
        <button
          type="button"
          className="h-11 min-w-14 rounded-lg px-2 font-mono text-sm tabular-nums hover:bg-muted/60"
          aria-label={t("zoom.reset", { scale: label })}
          onClick={() => zoomCentred(MIN_ZOOM)}
        >
          {label}
        </button>
        <button
          type="button"
          className={iconBtn}
          aria-label={t("zoom.in")}
          disabled={clampScale(scale * ZOOM_STEP) === scale}
          onClick={() => zoomCentred(scale * ZOOM_STEP)}
        >
          <Plus className="size-5" />
        </button>
      </div>
      <div
        ref={viewportRef}
        tabIndex={-1}
        onScroll={onScroll}
        // A URL the agent printed is a link in AnsiOutput; a double tap's first tap must not follow it.
        onClickCapture={(e) => {
          if (e.target instanceof Element && e.target.closest("a[href]")) e.preventDefault();
        }}
        // `pan-x pan-y`: one finger scrolls natively; the browser's pinch/double-tap zoom stand down.
        className="relative min-h-0 flex-1 overflow-auto overscroll-contain outline-none [touch-action:pan-x_pan-y]"
      >
        <div style={measured ? { width: natural.width * scale, height: natural.height * scale } : undefined}>
          <div
            ref={contentRef}
            className="px-2 py-1"
            style={{ width: "max-content", transform: scale === MIN_ZOOM ? undefined : `scale(${scale})`, transformOrigin: "0 0" }}
          >
            {/* No agent: the block grammars (prompt buttons) stay off — this view only reads. */}
            <AnsiOutput text={text} wrap={false} fontSize={fontSize} className="w-max max-w-none overflow-visible" />
          </div>
        </div>
      </div>
    </div>
  );
}
