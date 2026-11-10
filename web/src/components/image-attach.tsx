import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { ArrowUpRight, Circle, Crop, ImageIcon, Loader2, Pencil, Undo2, X } from "lucide-react";

import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { dataUrl, type ImageUpload } from "@/hooks/use-image-upload";
import { cropOf, drawMarks, exportEdited, rectFrom, type Edit, type EditTool, type Pt } from "@/lib/image-edit";
import { setStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

// What every draft box that carries a screenshot shows around the shared upload hook: the preview a
// paste or a pick opens (Attach the original as is, or Edit it first), and the thumbnails of what the
// draft already carries, each with its ✕. The mechanism stays the hook's — this is only its face.

/** The thumbnails above the input, and the spinner while an upload is on its way. */
export function AttachedImages({ upload, className }: { upload: ImageUpload; className?: string }) {
  const t = useT();
  if (!upload.uploading && upload.images.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {upload.images.map((img) => {
        const name = `#${img.n}`;
        return (
          <div key={img.n} className="relative size-14 overflow-hidden rounded-md border border-border bg-muted">
            {img.url ? (
              <img src={img.url} alt={name} className="size-full object-cover" />
            ) : (
              <ImageIcon className="m-auto mt-4 size-5 text-muted-foreground" aria-label={name} />
            )}
            <button
              type="button"
              onClick={() => upload.remove(img.n)}
              aria-label={t("img.remove", { name })}
              className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-full bg-black/70 text-white"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
      {upload.uploading && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t("img.uploading")}
        </span>
      )}
    </div>
  );
}

/** The preview a pasted or picked image opens: Attach sends the original, Edit retouches it first. */
export function ImagePreviewSheet({ upload }: { upload: ImageUpload }) {
  const t = useT();
  const file = upload.pending;
  const [url, setUrl] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setImg(null);
    setEditing(false);
    setUrl(null);
    if (!file) return;
    let live = true;
    // A data: URL — the CSP refuses blob:, and a refused preview would attach unseen through onError.
    void dataUrl(file).then((u) => {
      if (!live) return;
      if (u) setUrl(u);
      else void upload.uploadImage(file); // unreadable here is not an error: it goes up as is
    });
    return () => {
      live = false;
    };
  }, [file]);

  const attach = (f: File) => void upload.uploadImage(f);

  return (
    <BottomSheet
      open={file !== null}
      onClose={upload.dismiss}
      title={t("img.preview")}
      footer={
        !editing && file ? (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={!img} onClick={() => setEditing(true)}>
              <Pencil className="size-4" />
              {t("img.edit")}
            </Button>
            <Button variant="brand" onClick={() => attach(file)}>
              {t("img.attach")}
            </Button>
          </div>
        ) : undefined
      }
    >
      {file && editing && img ? (
        <ImageEditor img={img} name={file.name} onBack={() => setEditing(false)} onDone={(f) => attach(f ?? file)} />
      ) : (
        url && (
          <img
            src={url}
            alt={file?.name ?? ""}
            className="mx-auto max-h-[60dvh] max-w-full rounded-md object-contain"
            onLoad={(e) => setImg(e.currentTarget)}
            // A format this browser can't show (HEIC…) is not an error: it goes up as is.
            onError={() => file && attach(file)}
          />
        )
      )}
    </BottomSheet>
  );
}

const TOOLS: { tool: EditTool; icon: typeof Crop; key: "img.tool.crop" | "img.tool.pen" | "img.tool.circle" | "img.tool.arrow" }[] = [
  { tool: "crop", icon: Crop, key: "img.tool.crop" },
  { tool: "pen", icon: Pencil, key: "img.tool.pen" },
  { tool: "circle", icon: Circle, key: "img.tool.circle" },
  { tool: "arrow", icon: ArrowUpRight, key: "img.tool.arrow" },
];

const PREVIEW_MAX = 1200;

function ImageEditor({
  img,
  name,
  onBack,
  onDone,
}: {
  img: HTMLImageElement;
  name: string;
  onBack: () => void;
  /** The edited PNG, or null when nothing was changed (the original goes up). */
  onDone: (file: File | null) => void;
}) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<EditTool>("pen");
  const [edits, setEdits] = useState<Edit[]>([]);
  const [draft, setDraft] = useState<Edit | null>(null);
  const [saving, setSaving] = useState(false);
  // Where a crop drag began: the rectangle spans from it to the finger.
  const anchor = useRef<Pt>({ x: 0, y: 0 });

  const k = Math.min(1, PREVIEW_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * k);
  const h = Math.round(img.naturalHeight * k);

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const all = draft ? [...edits, draft] : edits;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    drawMarks(ctx, all, w, h);
    // The crop in force: everything outside it dimmed.
    const c = cropOf(all);
    if (c.w < 1 || c.h < 1) {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.rect(c.x * w, c.y * h, c.w * w, c.h * h);
      ctx.fill("evenodd");
      ctx.strokeStyle = "#fff";
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(c.x * w, c.y * h, c.w * w, c.h * h);
      ctx.restore();
    }
  }, [img, w, h, edits, draft]);

  function at(e: PointerEvent<HTMLCanvasElement>): Pt {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  // The gesture in progress, read synchronously: pointer events can outrun React's re-render.
  const live = useRef<Edit | null>(null);
  function put(d: Edit | null) {
    live.current = d;
    setDraft(d);
  }

  function down(e: PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = at(e);
    anchor.current = p;
    put(
      tool === "pen"
        ? { kind: "pen", points: [p] }
        : tool === "crop"
          ? { kind: "crop", rect: rectFrom(p, p) }
          : { kind: tool, from: p, to: p },
    );
  }

  function move(e: PointerEvent<HTMLCanvasElement>) {
    const d = live.current;
    if (!d) return;
    const p = at(e);
    if (d.kind === "pen") put({ ...d, points: [...d.points, p] });
    else if (d.kind === "crop") put({ ...d, rect: rectFrom(anchor.current, p) });
    else put({ ...d, to: p });
  }

  function up() {
    const d = live.current;
    if (d) setEdits((prev) => [...prev, d]);
    put(null);
  }

  async function done() {
    if (edits.length === 0) return onDone(null);
    setSaving(true);
    const file = await exportEdited(img, edits, name);
    setSaving(false);
    if (file) onDone(file);
    else setStatus(t("img.exportFailed"), "error");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1">
        {TOOLS.map(({ tool: id, icon: Icon, key }) => (
          <Button
            key={id}
            size="sm"
            variant={tool === id ? "secondary" : "ghost"}
            aria-pressed={tool === id}
            onClick={() => setTool(id)}
          >
            <Icon className="size-4" />
            {t(key)}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          disabled={edits.length === 0}
          onClick={() => setEdits((prev) => prev.slice(0, -1))}
          aria-label={t("img.undo")}
        >
          <Undo2 className="size-4" />
        </Button>
      </div>
      <canvas
        ref={canvas}
        width={w}
        height={h}
        aria-label={t("img.canvas")}
        className="mx-auto block h-auto max-h-[55dvh] w-auto max-w-full touch-none rounded-md"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => put(null)}
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onBack}>
          {t("img.back")}
        </Button>
        <Button variant="brand" disabled={saving} onClick={() => void done()}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {t("img.attach")}
        </Button>
      </div>
    </div>
  );
}
