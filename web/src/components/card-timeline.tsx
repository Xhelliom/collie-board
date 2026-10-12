import { useState } from "react";

import { CollapsibleText } from "@/components/collapsible-text";
import { describeEvent } from "@/components/card-journal";
import { useT } from "@/i18n";
import { cardMilestones, milestoneLabel, type MilestoneTone } from "@/lib/card-milestones";
import { ago } from "@/lib/project-facts";
import { cn } from "@/lib/utils";
import type { BoardEvent } from "@/lib/board";

const DOT: Record<MilestoneTone, string> = {
  good: "bg-status-done",
  bad: "bg-status-blocked",
  warn: "bg-brand",
  plain: "bg-muted-foreground",
};

/** The card's milestones as a vertical timeline, derived from the journal on each render (the polled
 *  card response drives it — no loop of its own). A folded milestone opens on tap; nothing is capped. */
export function CardTimeline({ events }: { events: BoardEvent[] }) {
  const t = useT();
  const [open, setOpen] = useState<number | null>(null);
  const milestones = cardMilestones(events);
  if (milestones.length === 0) return null;
  return (
    <ol className="flex flex-col">
      {milestones.map((m, i) => {
        const label = milestoneLabel(m, (count) => t("timeline.sentBack", { count }));
        const expandable = m.events.length > 1;
        const row = (
          <>
            <span className="w-[76px] shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">{ago(m.ts)}</span>
            <span className={cn("mt-1 size-2.5 shrink-0 rounded-full", DOT[m.tone])} aria-hidden />
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-left text-foreground">
              {expandable ? label : <CollapsibleText lines={2}>{label}</CollapsibleText>}
            </span>
          </>
        );
        return (
          <li key={`${m.kind}-${m.events[0]!.id}`} className="border-l border-border pl-0 ml-1">
            {expandable ? (
              <button
                type="button"
                aria-expanded={open === i}
                onClick={() => setOpen(open === i ? null : i)}
                className="flex min-h-11 w-full items-start gap-2.5 px-2 py-1.5 text-xs"
              >
                {row}
              </button>
            ) : (
              <div className="flex items-start gap-2.5 px-2 py-1.5 text-xs">{row}</div>
            )}
            {expandable && open === i && (
              <ul className="mb-1 ml-[102px] flex flex-col gap-1 text-xs text-muted-foreground">
                {m.events.map((e) => (
                  <li key={e.id} className="whitespace-pre-wrap break-words">
                    {ago(e.ts)} · {describeEvent(e)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
