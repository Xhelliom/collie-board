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
}: {
  children: ReactNode;
  lines?: number;
  moreLabel?: string;
  lessLabel?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  // Height limit in px once overflow is confirmed; null = fits, nothing is clamped.
  const [limit, setLimit] = useState<number | null>(null);

  // Re-measure on every render of the content. Short text is never clamped, so it renders as before.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
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
      {(limit !== null || open) && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="mt-1 text-sm text-primary underline-offset-2 hover:underline"
        >
          {open ? lessLabel : moreLabel}
        </button>
      )}
    </div>
  );
}
