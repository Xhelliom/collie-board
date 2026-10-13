import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Folds long content (Markdown or plain) to `lines` lines with a « Voir plus / moins » toggle.
 * Content that fits renders exactly as before — no wrapper height, no button. Overflow is measured,
 * not guessed from the string, so wrapped lines on a narrow phone count.
 */
export function CollapsibleText({
  children,
  lines = 6,
  moreLabel = "Voir plus",
  lessLabel = "Voir moins",
  className,
  forceOpen = false,
}: {
  children: ReactNode;
  lines?: number;
  moreLabel?: string;
  lessLabel?: string;
  className?: string;
  /** Unfolds without touching the user's own toggle — a search hit must never sit behind a fold. */
  forceOpen?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const [openState, setOpen] = useState(false);
  const open = openState || forceOpen;
  // Height limit in px once overflow is confirmed; null = fits, nothing is clamped.
  const [limit, setLimit] = useState<number | null>(null);

  // Re-measure on every render, open or not (overflow is still known when unfolded). Short text is never clamped, so it renders as before.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) || 1.5 * (parseFloat(cs.fontSize) || 16);
    setLimit(el.scrollHeight > lines * lh + 1 ? lines * lh : null);
  });

  return (
    <div className={className}>
      <div
        ref={ref}
        id={id}
        className={limit !== null && !open ? "overflow-hidden" : undefined}
        style={limit !== null && !open ? { maxHeight: limit } : undefined}
      >
        {children}
      </div>
      {/* Nothing to toggle while a search forces it open, or when the content fits. */}
      {limit !== null && !forceOpen && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
          className="mt-1 text-sm text-primary underline-offset-2 hover:underline"
        >
          {open ? lessLabel : moreLabel}
        </button>
      )}
    </div>
  );
}
