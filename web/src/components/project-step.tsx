import { Link } from "react-router";
import { ChevronDown } from "lucide-react";

import { CardStatusChip } from "@/components/card-status-chip";
import { TemplateChip } from "@/components/template-chip";
import { MarkdownText } from "@/components/markdown-text";
import { cardPath, type CardView, type Phase } from "@/lib/board";
import { useT, type MessageKey } from "@/i18n";
import { duration, factChips, rich, specLine, type CardFacts, type Tone } from "@/lib/project-facts";
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
const ASK: Partial<Record<CardView["status"], MessageKey>> = {
  review: "step.ask.review",
  blocked: "step.ask.blocked",
  orphaned: "step.ask.orphaned",
};

const CHIP_TONE: Record<Tone, string> = {
  good: "bg-status-done/15 text-status-done",
  bad: "bg-status-blocked/15 text-status-blocked",
  warn: "bg-status-working/15 text-status-working",
  plain: "bg-muted text-muted-foreground",
};

/** The three kinds of hand on a step, as the road map names them: an AI, a script, you. */
export const WHO = {
  ia: "bg-brand/15 text-brand",
  script: "bg-status-done/15 text-status-done",
  human: "bg-status-working/15 text-status-working",
  muted: "bg-muted text-muted-foreground",
} as const;

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
  facts,
  template,
  inLot = false,
  onToggle,
  phases = [],
  onMove,
}: {
  card: CardView;
  index: number;
  next: boolean;
  open: boolean;
  flash: boolean;
  predecessor: CardView | undefined;
  /** What the journal knows of this card; absent while loading or when the bridge cannot say. */
  facts?: CardFacts;
  /** The template this step starts with — its own or its phase's (ADR 0026). */
  template?: { name: string; inherited: boolean };
  /** Drawn inside its lot's group: the group already says "in a run", so the chip is dropped. */
  inLot?: boolean;
  onToggle: () => void;
  /** The repo's phases; with `onMove`, the step can be filed under another one. */
  phases?: Phase[];
  onMove?: (phaseId: string | null) => void;
}) {
  const t = useT();
  const group = stepGroup(card);
  const agent = card.runtime?.agent ?? card.session?.agentKind ?? card.agentKind;
  const ask = ASK[card.status] ? t(ASK[card.status]!) : undefined;
  const body = `step-${card.id}-body`;
  const chips = factChips(card, facts);
  const line = specLine(card.spec);
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
        <span className="col-span-2 flex flex-col gap-1.5">
          {line && <span className="line-clamp-2 text-[13px] leading-snug text-muted-foreground">{line}</span>}
          <span className="flex flex-wrap items-center gap-1.5">
          {next && <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand">{t("step.next")}</span>}
          {template && <TemplateChip name={template.name} inherited={template.inherited} className="text-[11px] py-0.5" />}
          {card.runId && !inLot && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{t("step.inRun")}</span>}
          <CardStatusChip status={card.status} />
          {chips.map((c) => (
            <span key={c.label} className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", CHIP_TONE[c.tone])}>
              {c.label}
            </span>
          ))}
          </span>
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
                    <span
                      aria-hidden="true"
                      className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", card.status === "done" ? "bg-status-done" : "bg-muted-foreground/50")}
                    />
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            )}
            {predecessor && (
              <p className="text-xs text-muted-foreground">
                {rich(t(predecessor.status === "done" ? "step.after.filed" : "step.after.waiting", { title: predecessor.title }))}
              </p>
            )}
            <ul className="flex flex-col gap-1.5" aria-label={t("step.who.aria")}>
              {agent && (
                <Who label={t("step.who.agent")} tone={WHO.ia}>
                  {agent}
                  {card.runtime
                    ? ` — ${card.runtime.agentStatus}`
                    : facts?.startedAt != null && facts.endedAt != null
                      ? t("step.agent.worked", { duration: duration(facts.endedAt - facts.startedAt) })
                      : card.status === "done"
                        ? t("step.agent.finished")
                        : ""}
                  {facts?.template?.model ? `, ${t("templates.agent.model", { model: facts.template.model })}` : ""}
                  {facts && facts.sentBack > 0 ? t("step.agent.sentBack", { count: facts.sentBack }) : ""}
                </Who>
              )}
              {facts?.gate && (
                <Who label={t("step.who.gate")} tone={WHO.script}>
                  <code className="text-xs">{facts.gate.command}</code> — {facts.gate.ok ? t("step.gate.green") : t("step.gate.red")}
                </Who>
              )}
              {facts?.lead && (
                <Who label={t("step.who.lead")} tone={WHO.ia}>
                  <b className="font-semibold text-foreground">{facts.lead.decision === "finished" ? t("step.lead.finished") : t("step.lead.sentBack")}</b>
                  {facts.lead.reason ? ` — ${facts.lead.reason}` : ""}
                </Who>
              )}
              {facts?.review && (
                <Who label={t("step.who.review")} tone={WHO.ia}>
                  {rich(t("step.review.copilot", { verdict: `**${facts.review}**` }))}
                  {facts.triage ? t(facts.triage.accept ? "step.review.accepted" : "step.review.rejected", { reason: facts.triage.reason }) : ""}
                </Who>
              )}
              {facts?.pr && (
                <Who label={t("step.who.pr")} tone={WHO.script}>
                  {facts.pr.url ? (
                    <a href={facts.pr.url} target="_blank" rel="noreferrer" className="text-brand underline-offset-2 hover:underline">
                      {facts.pr.url.replace(/^https?:\/\/github\.com\//, "")}
                    </a>
                  ) : (
                    t("step.pr.opened")
                  )}{" "}
                  — {t(`step.pr.${facts.pr.state}`)}
                  {facts.pr.state === "open" && facts.pr.autoMerge === "refused" ? t("step.pr.refused") : ""}
                  {facts.pr.state === "open" && facts.pr.autoMerge === "armed" ? t("step.pr.armed") : ""}
                </Who>
              )}
              {card.origin && (
                <Who label={t(`step.origin.${card.origin}`)} tone={WHO.muted}>
                  {t("step.origin.filed")}
                </Who>
              )}
              {ask && (
                <Who label={t("step.who.you")} tone={WHO.human}>
                  {ask}
                </Who>
              )}
              {facts && facts.operatorSaid > 0 && !ask && (
                <Who label={t("step.who.you")} tone={WHO.human}>
                  {t("step.spoke", { count: facts.operatorSaid })}
                </Who>
              )}
            </ul>
            {phases.length > 0 && onMove && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                {t("step.phase")}
                <select
                  value={card.phaseId ?? ""}
                  onChange={(e) => onMove(e.target.value || null)}
                  className="rounded-lg border bg-background px-2 py-1 text-sm text-foreground"
                >
                  <option value="">{t("project.noPhase")}</option>
                  {phases.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Link to={cardPath(card.id)} className="self-start text-xs font-semibold text-brand">
              {t("step.open")}
            </Link>
          </div>
        </div>
      </div>
    </li>
  );
}
