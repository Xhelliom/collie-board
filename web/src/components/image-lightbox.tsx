import { useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { GalleryImg } from "@/components/gallery-img";
import { closeLightbox, useLightbox } from "@/lib/lightbox";

// Full-screen image viewer with swipe-through.
//
// Two native platform features carry this, and neither is worth re-implementing:
//
//  - `<dialog showModal()>` gives Escape-to-close, a focus trap, inertness of the page behind it and
//    the top layer (so no z-index fight with the sheets or the nav) for free.
//  - CSS scroll snapping gives the swipe: a horizontal scroller with `snap-mandatory` and one
//    full-width pane per image IS the gesture, with the platform's own momentum, rubber-banding and
//    interruption. A JS drag handler would be more code and worse — Vaul owns the sheet gesture here
//    for the same reason (ADR 0003).
//
// So the only thing left to write is which image you land on, which is scroll position over pane
// width. `loading="lazy"` then means a swipe-through fetches one image at a time, not the whole set:
// these are full-size renders and this is a phone on a tailnet.

/**
 * Mounted once at the root; shows whatever lib/lightbox.ts currently holds. Nothing renders until
 * something calls openLightbox(), and the inner component is REMOUNTED per opening (keyed on the
 * first path) so its scroll position starts fresh instead of carrying over from the last set.
 */
export function ImageLightboxHost() {
  const state = useLightbox();
  if (!state) return null;
  return (
    <ImageLightbox
      key={state.images[0]}
      images={state.images}
      index={state.index}
      onClose={closeLightbox}
    />
  );
}

export function ImageLightbox({
  images,
  index,
  onClose,
}: {
  /** Absolute paths, in display order. */
  images: string[];
  /** Which one opens. */
  index: number;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(index);

  // Open it, THEN jump to the image that was tapped — one effect, in that order, because the order is
  // the whole thing. showModal() is what puts the dialog in the top layer, and a <dialog> that hasn't
  // had it called is `display: none` per the UA stylesheet: until it runs, the scroller has no width,
  // so `index * clientWidth` is `index * 0` and every opening landed on the first image.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    const el = scrollerRef.current;
    if (el && el.clientWidth > 0) el.scrollLeft = index * el.clientWidth;
  }, [index]);

  const name = (images[current] ?? "").split("/").pop() ?? "";

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-label="Image viewer"
      // The UA stylesheet centres a dialog in a box; this one is the whole viewport.
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-black/95 p-0 text-white backdrop:bg-black/80"
      // ← / → step a pane on a desktop keyboard. Touch needs nothing: the scroller IS the gesture.
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const el = scrollerRef.current;
        if (!el) return;
        e.preventDefault();
        el.scrollBy({ left: e.key === "ArrowRight" ? el.clientWidth : -el.clientWidth, behavior: "smooth" });
      }}
    >
      <div className="flex h-full flex-col">
        <header className="flex shrink-0 items-center gap-2 px-3 py-2 pt-[calc(env(safe-area-inset-top)_+_0.5rem)]">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-white/70">{name}</span>
          {images.length > 1 && (
            <span className="shrink-0 text-xs tabular-nums text-white/70">
              {current + 1}/{images.length}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 shrink-0 rounded-full p-2 text-white/80 hover:bg-white/10"
          >
            <X className="size-5" />
          </button>
        </header>

        <div
          ref={scrollerRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.clientWidth > 0) setCurrent(Math.round(el.scrollLeft / el.clientWidth));
          }}
          className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain"
        >
          {images.map((path) => (
            <div key={path} className="flex min-w-full snap-center items-center justify-center p-2">
              <GalleryImg path={path} className="max-h-full max-w-full object-contain" />
            </div>
          ))}
        </div>
      </div>
    </dialog>
  );
}
