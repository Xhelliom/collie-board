import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";
import { tagHue } from "@/lib/board";

/**
 * A card's tag as a chip. The sibling of {@link CardStatusChip}, with one difference that is the
 * whole point: a status has a fixed palette, a tag's colour is COMPUTED from its name — so the chip
 * carries a hue and `.tag-chip` (index.css) turns it into border/background/text for the theme in
 * force. Nothing here picks a colour; nothing stores one.
 */
export function TagChip({ tag, className }: { tag: string; className?: string }) {
  return (
    <span
      className={cn(
        "tag-chip shrink-0 rounded-full border px-1.5 py-0.5 text-[0.65rem] font-medium",
        className,
      )}
      style={{ "--tag-hue": tagHue(tag) } as CSSProperties}
    >
      {tag}
    </span>
  );
}
