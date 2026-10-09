import { Link } from "react-router";
import { ChevronDown } from "lucide-react";

import { CardStatusChip } from "@/components/card-status-chip";
import { MarkdownText } from "@/components/markdown-text";
import { cardPath, type CardView } from "@/lib/board";
import { stepGroup } from "@/lib/project";
import { cn } from "@/lib/utils";

// One step of the project view: a row that opens on what the card says and who has the ball. Every
// line below the row is read off the card — nothing is declared for the view.

/** Colour of a step's pip and its segment in a bar. One map, used by the bar and the row alike. */
export const STEP_TONE: Partial<Record<CardView["status"], string>> = {
  done: "bg-status-done",
  working: "bg-status-working",
  starting: "bg-status-working",
  review: "bg-brand",
  blocked: "bg-status-blocked",
  orphaned: "bg-status-blocked",
};

/** What the operator is being asked, for a step that waits on them. */
const ASK: Partial<Record<CardView["status"], string>> = {
  review: "The agent landed — read the diff, then file it or send it back.",
  blocked: "The agent stopped on a question or a permission prompt.",
  orphaned: "Its session ended without the card being filed.",
};

function Who({ label, tone, children }: { label: string; tone: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-2.5 text-sm">
      <span className={cn("rounded-[5px] px-1 py-1 text-center text-[10px] font-semibold uppercase leading-none tracking-widest", tone)}>
        {label}
      </span>
      <span className="text-muted-foreground">{children}</span>
    </li>
  );
}

export function StepItem({
  card,
  index,
  next,
  open,
  flash,
  predecessor,
  onToggle,
}: {
  card: CardView;
  index: number;
  next: boolean;
  open: boolean;
  flash: boolean;
  predecessor: CardView | undefined;
  onToggle: () => void;
}) {
  const group = stepGroup(card);
  const agent = card.runtime?.agent ?? card.session?.agentKind ?? card.agentKind;
  const ask = ASK[card.status];
  const body = `step-${card.id}-body`;
  return (
    <li
      id={`step-${card.id}`}
      data-group={group}
      style={{ animationDelay: `${Math.min(index, 20) * 35}ms` }}
      className={cn(
        "scroll-mt-20 rounded-xl border bg-card/70 transition-[border-color,box-shadow] duration-300 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-both",
        group === "flight" && "border-status-working/45",
        group === "waiting" && "border-brand/45",
        next && "border-brand/60",
        flash && "ring-2 ring-brand shadow-[0_0_30px_-6px] shadow-brand",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={body}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-xl px-3.5 py-3 text-left"
      >
        <span
          aria-hidden="true"
          className={cn(
            "size-2.5 rounded-full ring-4 ring-muted/60",
            STEP_TONE[card.status] ?? "bg-muted-foreground/50",
            group === "flight" && "motion-safe:animate-pulse",
          )}
        />
        <span className="min-w-0 break-words text-[15px] font-semibold leading-snug">{card.title}</span>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform duration-300", open && "rotate-180")} />
        <span />
        <span className="col-span-2 flex flex-wrap items-center gap-1.5">
          {next && <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand">next</span>}
          {card.runId && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">in a run</span>}
          <CardStatusChip status={card.status} />
        </span>
      </button>

      <div
        id={body}
        className={cn("grid transition-[grid-template-rows] duration-300 ease-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}
      >
        <div className="min-h-0 overflow-hidden">
          <div className={cn("flex flex-col gap-3 px-3.5 pb-3.5 pl-[2.1rem] transition-opacity duration-300", open ? "opacity-100" : "opacity-0")}>
            {card.spec && (
              <div className="max-h-52 overflow-y-auto text-muted-foreground">
                <MarkdownText text={card.spec} className="text-sm" />
              </div>
            )}
            {card.acceptance.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                {card.acceptance.map((a, i) => (
                  <li key={i} className="flex gap-2">
                    <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            )}
            {predecessor && (
              <p className="text-xs text-muted-foreground">
                After <b className="font-semibold text-foreground">{predecessor.title}</b> —{" "}
                {predecessor.status === "done" ? "filed" : "not filed yet, so this one waits"}.
              </p>
            )}
            <ul className="flex flex-col gap-1.5" aria-label="Who has the ball">
              {agent && (
                <Who label="Agent" tone="bg-status-working/15 text-status-working">
                  {agent}
                  {card.runtime ? ` — ${card.runtime.agentStatus}` : card.status === "done" ? " — finished" : ""}
                </Who>
              )}
              {card.origin && (
                <Who label={card.origin} tone="bg-muted text-muted-foreground">
                  filed this card on its own
                </Who>
              )}
              {ask && (
                <Who label="You" tone="bg-brand/15 text-brand">
                  {ask}
                </Who>
              )}
            </ul>
            <Link to={cardPath(card.id)} className="self-start text-xs font-semibold text-brand">
              Open the card →
            </Link>
          </div>
        </div>
      </div>
    </li>
  );
}
