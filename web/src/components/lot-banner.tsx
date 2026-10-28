import { Link } from "react-router";
import { ExternalLink, SquareTerminal } from "lucide-react";

import { HaltReason } from "@/components/halt-reason";
import { useT } from "@/i18n";
import type { LiveLot, LiveState } from "@/lib/lot-live";
import { panePath } from "@/lib/nav";
import { cn } from "@/lib/utils";

// The lot in progress, under the project page's header: its name, how many cards are merged, and each
// card's state now with a way to its pane and its PR. One banner per running lot; none when none runs.

const TONE: Record<LiveState, string> = {
  queued: "bg-muted text-muted-foreground",
  working: "bg-status-working/15 text-status-working",
  review: "bg-brand/15 text-brand",
  pr: "bg-brand/15 text-brand",
  merged: "bg-status-done/15 text-status-done",
  blocked: "bg-status-blocked/15 text-status-blocked",
};

export function LotBanner({ live }: { live: LiveLot }) {
  const t = useT();
  const { lot, cards, merged } = live;
  const name = lot.name ?? t("lot.fallbackName");
  return (
    <section
      aria-label={t("lot.live.aria", { name })}
      className="flex flex-col gap-2 rounded-2xl border border-status-working/45 bg-card/70 p-4"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-status-working">{t(lot.halted ? "lot.halted" : "lot.running")}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{t("lot.live.progress", { done: merged, total: cards.length })}</span>
      </div>
      {lot.halted && <HaltReason reason={lot.halted} className="min-w-0" />}
      <div className="h-[5px] overflow-hidden rounded-[3px] bg-border" aria-hidden="true">
        <i className="block h-full bg-status-done transition-[width] duration-700" style={{ width: `${(100 * merged) / cards.length}%` }} />
      </div>
      <ul className="flex flex-col gap-1.5">
        {cards.map(({ card, state, paneId, prUrl }) => (
          <li key={card.id} className="flex items-center gap-2 text-sm">
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", TONE[state])}>{t(`lot.live.${state}`)}</span>
            <span className="min-w-0 flex-1 truncate">{card.title}</span>
            {paneId && (
              <Link to={panePath(paneId)} aria-label={t("lot.live.pane")} title={t("lot.live.pane")} className="shrink-0 text-brand">
                <SquareTerminal className="size-4" />
              </Link>
            )}
            {prUrl && (
              <a href={prUrl} target="_blank" rel="noreferrer" aria-label={t("lot.live.prLink")} title={t("lot.live.prLink")} className="shrink-0 text-brand">
                <ExternalLink className="size-4" />
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
