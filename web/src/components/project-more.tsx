import { useEffect, useRef, useState, type ReactNode } from "react";
import { Ellipsis } from "lucide-react";

import { cn } from "@/lib/utils";

// The page's « ⋯ »: a phase's, a lot's, a section's rarer gestures — never lost, one tap away (refonte
// sans perte). A menu item closes it unless it carries `data-keep-open` (a two-tap confirm, a sheet).

export const MENU_ITEM = "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm font-medium hover:bg-muted/60 sm:min-h-10";

export function MoreActions({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <span ref={ref} className={cn("relative inline-flex shrink-0", className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex size-11 items-center justify-center rounded-sm border bg-background text-muted-foreground shadow-xs hover:bg-accent hover:text-foreground sm:size-8"
      >
        <Ellipsis className="size-4" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          onClick={(e) => {
            const item = (e.target as HTMLElement).closest("[role=menuitem]");
            if (item && !item.hasAttribute("data-keep-open")) setOpen(false);
          }}
          className="absolute right-0 top-full z-30 mt-1 flex w-72 max-w-[calc(100vw-2rem)] flex-col rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg"
        >
          {children}
        </div>
      )}
    </span>
  );
}
