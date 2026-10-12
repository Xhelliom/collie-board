import { useT } from "@/i18n";
import { cardMilestones, type MilestoneTone } from "@/lib/card-milestones";
import { cn } from "@/lib/utils";
import type { BoardEvent } from "@/lib/board";

const DOT: Record<MilestoneTone, string> = {
  good: "bg-status-done",
  bad: "bg-status-blocked",
  warn: "bg-brand",
  plain: "bg-muted-foreground/60",
};

/** The card's milestones as a row of tiny dots — the timeline's compact form, derived from the same
 *  journal events (the facts ride the existing poll). Meaning is in the accessible name, not the colour. */
export function MilestoneDots({ events, className }: { events: BoardEvent[] | undefined; className?: string }) {
  const t = useT();
  const ms = cardMilestones(events ?? []);
  if (ms.length === 0) return null;
  return (
    <span className={cn("flex items-center gap-1", className)}>
      {ms.map((m) => {
        const label =
          m.kind === "gate" ? t(m.tone === "good" ? "milestone.gate.ok" : "milestone.gate.ko") : t(`milestone.${m.kind}`, { count: m.count ?? 1 });
        return <span key={`${m.kind}-${m.events[0]!.id}`} role="img" aria-label={label} title={label} className={cn("size-2 shrink-0 rounded-full", DOT[m.tone])} />;
      })}
    </span>
  );
}
