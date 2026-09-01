import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { CARD_STATUS_CHIP, CHIP_SHELL, type CardStatus } from "@/lib/board";

/**
 * A card's COLUMN as a chip — the board's counterpart to {@link StatusBadge}, which shows a live
 * agent's status. The distinction is load-bearing: an orphaned card has a column but no agent, and
 * a badge would claim a running process that isn't there.
 *
 * Extracted because the same seven-token class string had been copied to four call sites and had
 * already drifted (`px-2` here, `px-1.5` there). `children` covers the one real variation: the
 * collapsed group summary shows a COUNT in the same shell rather than the status name.
 */
export function CardStatusChip({
  status,
  children,
  className,
}: {
  status: CardStatus;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn(CHIP_SHELL, CARD_STATUS_CHIP[status], className)}>
      {children ?? status}
    </span>
  );
}
