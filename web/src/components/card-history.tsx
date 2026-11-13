import { useState, type ReactNode } from "react";

import { useT } from "@/i18n";
import { Panel, PanelLink } from "@/components/card-panel";
import { CollapsibleText } from "@/components/collapsible-text";
import { CardJournal, describeEvent } from "@/components/card-journal";
import { historyRows, type Actor } from "@/lib/card-fiche";
import { ago } from "@/lib/project-facts";
import { cn } from "@/lib/utils";
import type { BoardEvent, CardView } from "@/lib/board";

// The card's history: one line per key step — when, WHO (the agent, the lead, the copilot, the
// orchestrator, the board, you), what. The raw journal (with « Restaurer ») and anything the caller
// adds (sessions, rounds with the lead) sit behind « Journal complet ». Timeline and journal in one.

const ACTOR_TONE: Record<Actor, string> = {
  agent: "text-status-working",
  lead: "text-brand",
  copilot: "text-status-done",
  orchestrator: "text-brand",
  board: "text-muted-foreground",
  you: "text-foreground",
};

export function CardHistory({
  card,
  events,
  milestoneEvents,
  count,
  onRestore,
  more,
}: {
  card: Pick<CardView, "origin" | "originCardId">;
  events: BoardEvent[];
  milestoneEvents?: BoardEvent[];
  count?: ReactNode;
  onRestore: (eventId: number) => Promise<void>;
  /** Shown with the full journal: the sessions, the rounds with the lead. */
  more?: ReactNode;
}) {
  const t = useT();
  const [full, setFull] = useState(false);
  const rows = historyRows(milestoneEvents ?? events, events, card, describeEvent, (n) => t("timeline.sentBack", { count: n }));
  return (
    <Panel
      title={t("fiche.history")}
      count={count}
      actions={
        (events.length > 0 || more) && (
          <PanelLink expanded={full} onClick={() => setFull((v) => !v)}>
            {full ? t("fiche.history.hideJournal") : t("fiche.history.journal")}
          </PanelLink>
        )
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("fiche.history.empty")}</p>
      ) : (
        <ol className="flex flex-col">
          {rows.map((r) => (
            <li key={r.id} className="grid grid-cols-[64px_96px_minmax(0,1fr)] gap-x-3 py-1.5 text-sm max-sm:grid-cols-[minmax(0,1fr)] max-sm:gap-y-0.5">
              <span className="whitespace-nowrap text-[13px] tabular-nums text-muted-foreground max-sm:hidden">{ago(r.ts)}</span>
              <span className={cn("text-[13px] font-medium max-sm:hidden", ACTOR_TONE[r.actor])}>{t(`fiche.actor.${r.actor}`)}</span>
              {/* Phone: time and actor share one small line over the sentence. */}
              <span className="text-xs text-muted-foreground sm:hidden">
                {ago(r.ts)}, <span className={ACTOR_TONE[r.actor]}>{t(`fiche.actor.${r.actor}`)}</span>
              </span>
              <CollapsibleText lines={2} className="min-w-0 whitespace-pre-wrap break-words">
                {r.text}
              </CollapsibleText>
            </li>
          ))}
        </ol>
      )}
      {full && (
        <div className="flex flex-col gap-4 border-t border-border/60 pt-3">
          {more}
          <CardJournal events={events} onRestore={onRestore} />
        </div>
      )}
    </Panel>
  );
}

