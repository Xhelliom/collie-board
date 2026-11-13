import { Link } from "react-router";
import { FileText, SquareTerminal } from "lucide-react";

import { StatusSignal, cardSignal } from "@/components/status-signal";
import { useT } from "@/i18n";
import { CARD_STATUS_LABEL, cardPath, type CardView } from "@/lib/board";
import type { LotHold } from "@/lib/lot-hold";
import { panePath } from "@/lib/nav";
import { stepGroup } from "@/lib/project";
import { cn } from "@/lib/utils";

// A card on the project page: ONE line — its state dot, its title (opens the card), a short status, and
// two ways out: the card, and the agent while one runs. The card's spec, criteria and phase live on its
// own screen; the project page never unfolds a card.
/** `note`: how a planned lot's card will start (« 1re du lot »), in place of its status. */
export function CardRow({ card, hold = null, note }: { card: CardView; hold?: LotHold | null; note?: string }) {
  const t = useT();
  const group = stepGroup(card);
  const pane = card.runtime?.paneId ?? null;
  const icon = "inline-flex size-11 sm:size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground";
  return (
    <li
      data-group={group}
      className="grid min-h-11 grid-cols-[auto_minmax(0,1fr)_auto_2.75rem] items-center gap-x-2.5 rounded-lg px-2 py-1 hover:bg-muted/40 sm:grid-cols-[auto_minmax(0,1fr)_auto_2rem]"
    >
      <StatusSignal status={cardSignal(card.status)} decorative />
      {/* Never cut to a few letters: two lines on a wide screen, whole on a phone with the status under it. */}
      <span className="flex min-w-0 flex-col gap-x-3 sm:flex-row sm:items-center">
        <Link to={cardPath(card.id)} className="min-w-0 text-sm sm:line-clamp-2 font-medium leading-snug hover:underline sm:flex-1">
          {card.title}
        </Link>
        <span className={cn("shrink-0 text-xs sm:max-w-[13rem] sm:text-right", group === "waiting" ? "font-semibold text-brand" : "text-muted-foreground")}>
          {note ?? (hold?.step ? t(`lot.step.${hold.step}`) : CARD_STATUS_LABEL[card.status])}
        </span>
      </span>
      <Link to={cardPath(card.id)} aria-label={t("row.openCard")} title={t("row.openCard")} className={icon}>
        <FileText className="size-4" />
      </Link>
      {pane ? (
        <Link to={panePath(pane)} aria-label={t("row.toAgent")} title={t("row.toAgent")} className={icon}>
          <SquareTerminal className="size-4" />
        </Link>
      ) : (
        <span />
      )}
    </li>
  );
}
