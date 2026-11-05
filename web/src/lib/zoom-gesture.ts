// The full-screen output's gesture math, pure so each rule is a table test (components/output-zoom.tsx
// is the one caller). Idea from upstream Collie 1.25.0, rewritten here.
//
// The text is laid out once, unwrapped, drawn scaled by a transform inside a box sized to the scaled
// text, so the browser's own scroller does every one-finger pan. A gesture moves two numbers: the
// scale and the scroll offset. `viewport point = content point × scale − scroll`.

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;
/** Where a double tap at 1× lands. */
export const DOUBLE_TAP_ZOOM = 2.5;
/** One tap of the − / + buttons. */
export const ZOOM_STEP = 1.5;
export const DOUBLE_TAP_MS = 300;
/** Two taps this close on the glass (CSS px) are one double tap. */
export const DOUBLE_TAP_SLOP = 30;
/** A touch that moved further than this is a pan, never a tap. */
export const TAP_SLOP = 10;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface ZoomView {
  readonly scale: number;
  readonly scroll: Point;
}

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/** Zoom to `next` (clamped) keeping the content under viewport point `at` where it is on screen. */
export function zoomAbout(view: ZoomView, at: Point, next: number): ZoomView {
  const scale = clampScale(next);
  const cx = (view.scroll.x + at.x) / view.scale;
  const cy = (view.scroll.y + at.y) / view.scale;
  return { scale, scroll: { x: cx * scale - at.x, y: cy * scale - at.y } };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** What a pinch remembers from the moment its second finger landed. */
export interface PinchStart {
  readonly view: ZoomView;
  readonly distance: number;
  readonly mid: Point;
}

export function pinchStart(view: ZoomView, a: Point, b: Point): PinchStart {
  return { view, distance: distance(a, b), mid: midpoint(a, b) };
}

/**
 * One move of a pinch: the scale follows the spread ratio, and the content that was under the
 * starting midpoint follows the CURRENT midpoint, so moving both fingers together pans too.
 */
export function pinchMove(start: PinchStart, a: Point, b: Point): ZoomView {
  const ratio = start.distance > 0 ? distance(a, b) / start.distance : 1;
  const zoomed = zoomAbout(start.view, start.mid, start.view.scale * ratio);
  const mid = midpoint(a, b);
  return {
    scale: zoomed.scale,
    scroll: { x: zoomed.scroll.x - (mid.x - start.mid.x), y: zoomed.scroll.y - (mid.y - start.mid.y) },
  };
}

export interface Tap {
  readonly at: number;
  readonly point: Point;
}

export function isDoubleTap(prev: Tap | null, next: Tap): boolean {
  if (!prev) return false;
  const dt = next.at - prev.at;
  return dt >= 0 && dt <= DOUBLE_TAP_MS && distance(prev.point, next.point) <= DOUBLE_TAP_SLOP;
}

/** Double tap toggles: zoomed in at all → back to 1×; at 1× → {@link DOUBLE_TAP_ZOOM}. */
export function doubleTapTarget(scale: number): number {
  return scale > MIN_ZOOM + 0.01 ? MIN_ZOOM : DOUBLE_TAP_ZOOM;
}

/** `1×`, `2.5×`, `6×`. */
export function formatScale(scale: number): string {
  return `${Math.round(scale * 10) / 10}×`;
}
