// Retouching a screenshot before it goes up: crop, pen, circle, arrow — on a native canvas, no
// dependency. Every point is NORMALISED (0..1 of the full image), so one list of edits draws the
// same on the small preview canvas and on the full-size export.

export type EditTool = "crop" | "pen" | "circle" | "arrow";

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One undoable step. A crop replaces the previous crop; marks pile up. */
export type Edit =
  | { kind: "crop"; rect: Rect }
  | { kind: "pen"; points: Pt[] }
  | { kind: "circle" | "arrow"; from: Pt; to: Pt };

export const MARK_COLOR = "#ef4444";
const MAX_EXPORT = 4096;

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** The rectangle two drag points span, clamped to the image. */
export function rectFrom(a: Pt, b: Pt): Rect {
  const x0 = clamp(Math.min(a.x, b.x));
  const y0 = clamp(Math.min(a.y, b.y));
  return { x: x0, y: y0, w: clamp(Math.max(a.x, b.x)) - x0, h: clamp(Math.max(a.y, b.y)) - y0 };
}

/** The crop in force: the last one, or the whole image. A sliver (a tap) is not a crop. */
export function cropOf(edits: Edit[]): Rect {
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i];
    if (e.kind === "crop" && e.rect.w > 0.02 && e.rect.h > 0.02) return e.rect;
  }
  return { x: 0, y: 0, w: 1, h: 1 };
}

/** Draw the marks for an image of `w`×`h` px at the context's origin (crops are not marks). */
export function drawMarks(ctx: CanvasRenderingContext2D, edits: Edit[], w: number, h: number) {
  const px = (p: Pt) => [p.x * w, p.y * h] as const;
  const lw = Math.max(3, Math.max(w, h) * 0.006);
  ctx.save();
  ctx.strokeStyle = MARK_COLOR;
  ctx.lineWidth = lw;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const e of edits) {
    ctx.beginPath();
    if (e.kind === "pen") {
      e.points.forEach((p, i) => (i ? ctx.lineTo(...px(p)) : ctx.moveTo(...px(p))));
    } else if (e.kind === "circle") {
      const r = rectFrom(e.from, e.to);
      ctx.ellipse((r.x + r.w / 2) * w, (r.y + r.h / 2) * h, (r.w / 2) * w, (r.h / 2) * h, 0, 0, Math.PI * 2);
    } else if (e.kind === "arrow") {
      const [x0, y0] = px(e.from);
      const [x1, y1] = px(e.to);
      const a = Math.atan2(y1 - y0, x1 - x0);
      const head = lw * 5;
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.moveTo(x1 - head * Math.cos(a - 0.5), y1 - head * Math.sin(a - 0.5));
      ctx.lineTo(x1, y1);
      ctx.lineTo(x1 - head * Math.cos(a + 0.5), y1 - head * Math.sin(a + 0.5));
    } else continue;
    ctx.stroke();
  }
  ctx.restore();
}

/** The edited image as a PNG file: the crop, at full resolution (capped), with the marks burnt in. */
export function exportEdited(img: HTMLImageElement, edits: Edit[], name: string): Promise<File | null> {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const c = cropOf(edits);
  const sw = c.w * W;
  const sh = c.h * H;
  const scale = Math.min(1, MAX_EXPORT / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.scale(scale, scale);
  ctx.translate(-c.x * W, -c.y * H);
  ctx.drawImage(img, 0, 0);
  drawMarks(ctx, edits, W, H);
  const base = name.replace(/\.[^.]+$/, "") || "image";
  return new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b ? new File([b], `${base}-edit.png`, { type: "image/png" }) : null), "image/png"),
  );
}
