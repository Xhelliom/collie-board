import { Link } from "react-router";
import { FileText, SquareTerminal } from "lucide-react";

import { STEP_TONE } from "@/components/project-step";
import { useT } from "@/i18n";
import { CARD_STATUS_LABEL, cardPath, type CardView } from "@/lib/board";
import type { LotHold } from "@/lib/lot-hold";
import { panePath } from "@/lib/nav";
import { stepGroup } from "@/lib/project";
import { cn } from "@/lib/utils";

// A card on the project page: ONE line — its state dot, its title (opens the card), a short status, and
// two ways out: the card, and the agent while one runs. The card's spec, criteria and phase live on its
// own screen; the project page never unfolds a card.
export function CardRow({ card, hold = null }: { card: CardView; hold?: LotHold | null }) {
  const t = useT();
  const group = stepGroup(card);
  const pane = card.runtime?.paneId ?? null;
  const icon = "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground";
  return (
    <li
      data-group={group}
      className="grid min-h-10 grid-cols-[auto_minmax(0,1fr)_auto_auto_2rem] items-center gap-x-2.5 rounded-lg px-2 hover:bg-muted/40"
    >
      <span
        aria-hidden="true"
        className={cn("size-2 rounded-full", STEP_TONE[card.status] ?? "bg-muted-foreground/50", group === "flight" && "motion-safe:animate-pulse")}
      />
      <Link to={cardPath(card.id)} className="truncate text-sm font-medium hover:underline">
        {card.title}
      </Link>
      <span className={cn("max-w-[11rem] truncate text-xs", group === "waiting" ? "font-semibold text-brand" : "text-muted-foreground")}>
        {hold?.step ? t(`lot.step.${hold.step}`) : CARD_STATUS_LABEL[card.status]}
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
