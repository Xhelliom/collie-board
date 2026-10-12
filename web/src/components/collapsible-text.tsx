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
  const [overflow, setOverflow] = useState(false);

  // Re-measure on every render of the content; only while folded (open = unclamped, nothing to measure).
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setOverflow(el.scrollHeight > el.clientHeight + 1);
  });

  return (
    <div className={className}>
      <div
        ref={ref}
        id={id}
        className={open ? undefined : "overflow-hidden"}
        style={open ? undefined : { maxHeight: `${lines * 1.5}em` }}
      >
        {children}
      </div>
      {(overflow || open) && (
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
