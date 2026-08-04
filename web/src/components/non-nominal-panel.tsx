import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type NonNominalTone = "working" | "blocked" | "unknown" | "muted";

const TONE: Record<NonNominalTone, { border: string; bg: string; dot: string }> = {
  working: { border: "border-status-working/40", bg: "bg-status-working/7", dot: "bg-status-working" },
  blocked: { border: "border-status-blocked/40", bg: "bg-status-blocked/7", dot: "bg-status-blocked" },
  unknown: { border: "border-status-unknown/40", bg: "bg-status-unknown/7", dot: "bg-status-unknown" },
  muted: { border: "border-border", bg: "bg-muted/40", dot: "bg-muted-foreground/50" },
};

/**
 * The shared shape every non-nominal state uses (redesign §10): read-only, an orphaned card's live
 * pane, an empty/filtered board. One component so the family reads as ONE thing, wherever it shows
 * up — a dot in the tone, a short title, a sentence of explanation. `role="status"`: these are all
 * informational, never an error a screen reader should interrupt for (that's ConnectionBanner's
 * `alert`, a different surface with its own shape).
 */
export function NonNominalPanel({
  tone,
  title,
  children,
  className,
}: {
  tone: NonNominalTone;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <div
      role="status"
      className={cn("rounded-[14px] border p-3.5", t.border, t.bg, className)}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", t.dot)} />
        <span className="text-[13px] font-semibold">{title}</span>
      </div>
      <p className="mt-1 text-xs leading-[1.55] text-muted-foreground">{children}</p>
    </div>
  );
}
