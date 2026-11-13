// The shared pieces of an agent line — machine chip, model + effort, state with its age, the role
// with the card or the activity — and the line itself. Every field comes from lib/agent-identity.ts.
import { Link } from "react-router";

import { useT } from "@/i18n";
import { ago } from "@/lib/agents-page";
import { agentIdentity, type AgentIdentity } from "@/lib/agent-identity";
import { cardPath } from "@/lib/board";
import type { AgentView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CtxBar } from "./ctx-bar";
import { StatusDot } from "./status-badge";

export const STATE_TONE = { needs: "text-status-blocked", working: "text-status-working", idle: "text-muted-foreground" } as const;

/** « dev », or « ce PC ». */
export function MachineChip({ machine, className }: { machine: string | null; className?: string }) {
  const t = useT();
  return <span className={cn("shrink-0 rounded-sm bg-muted px-2 text-xs leading-5 text-muted-foreground", className)}>{machine ?? t("home.machine.this")}</span>;
}

/** « Opus 5.5, moyen » — nothing at all without a model, and no effort unless the transcript states one. */
export function ModelEffort({ id, className }: { id: Pick<AgentIdentity, "model" | "effort">; className?: string }) {
  const t = useT();
  if (!id.model) return null;
  return <span className={cn("min-w-0 truncate", className)}>{id.effort ? `${id.model}, ${t(`agents.effort.${id.effort}`)}` : id.model}</span>;
}

const FOR = { needs: "needsFor", working: "workingFor", done: "doneAgo", idle: "idleFor" } as const;

/** « travaille depuis 12 min » — the age only when the bridge saw the state begin. */
export function useStateSaid(id: Pick<AgentIdentity, "word" | "since">): string {
  const t = useT();
  if (id.since === null) return t(`agents.state.${id.word}`);
  const duration = ago(Date.now() - id.since, { min: t("agents.unit.min"), h: t("agents.unit.h"), d: t("agents.unit.d") });
  return t(`agents.state.${FOR[id.word]}`, { duration });
}

/** « carte ↗ · ce qu'il dit », « orchestrateur · collie », « agent libre · ce qu'il dit ». The card word is its link. */
export function AgentDetail({ id, className }: { id: AgentIdentity; className?: string }) {
  const t = useT();
  const role = t(`agents.role.${id.role}`);
  return (
    <span className={cn("flex min-w-0 items-baseline gap-1 text-[13px] text-muted-foreground", className)}>
      {id.cardId ? (
        // Above the line's own button (its ::after covers the row), so the tap lands here.
        <Link to={cardPath(id.cardId)} aria-label={t("agents.openCard")} className="relative z-10 shrink-0 underline decoration-dotted underline-offset-2 hover:text-foreground">
          {role} ↗
        </Link>
      ) : (
        <span className="shrink-0">{role}</span>
      )}
      {id.detail && <span className="min-w-0 truncate">· {id.detail}</span>}
    </span>
  );
}

/**
 * One agent, one line, as the Agents page lists it. Wide: dot · name over its detail · machine ·
 * state · model · gauge. Phone: name, then role + card/activity, then state and model, discreet.
 * `compact` (the pane column, the phone's pane switcher): the phone shape at every width, the
 * machine joining the discreet line; `current` is the pane open beside it.
 */
export function AgentLine({ agent, onOpen, compact = false, current = false }: { agent: AgentView; onOpen: (paneId: string) => void; compact?: boolean; current?: boolean }) {
  const t = useT();
  const id = agentIdentity(agent, t("agents.orchestrator"));
  const said = useStateSaid(id);
  const wide = compact ? "hidden" : "hidden lg:block";
  return (
    <div
      className={cn(
        "relative flex w-full min-w-0 items-center gap-3 rounded-xl transition-colors",
        compact ? "min-h-11 px-2.5 py-1.5" : "min-h-14 px-3.5 py-2 lg:grid lg:min-h-11 lg:grid-cols-[10px_minmax(0,1fr)_6.5rem_11rem_8.5rem_6.5rem] lg:gap-x-4",
        current
          ? "bg-primary/10 ring-1 ring-primary/30"
          : id.state === "needs" ? "bg-status-blocked/10 hover:bg-status-blocked/15" : id.state === "working" ? "bg-card/70 hover:bg-muted/60" : "hover:bg-muted/60",
      )}
    >
      <StatusDot status={agent.status} className={cn(id.state === "idle" && "opacity-55")} />
      <span className="flex min-w-0 flex-1 flex-col">
        <button
          type="button"
          onClick={() => onOpen(agent.paneId)}
          aria-label={`${id.name}, ${t(`agents.role.${id.role}`)}, ${said}`}
          aria-current={current ? "page" : undefined}
          className={cn(
            "min-w-0 truncate text-left outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring/50",
            id.state === "idle" ? "text-foreground/75" : "font-medium",
          )}
        >
          {id.name}
        </button>
        <AgentDetail id={id} />
        {/* Phone: the third, discreet line. */}
        <span className={cn("flex min-w-0 gap-1 text-xs text-muted-foreground", !compact && "lg:hidden")}>
          <span className={cn("shrink-0", id.state !== "idle" && STATE_TONE[id.state])}>{said}</span>
          {id.model && <span aria-hidden="true">·</span>}
          <ModelEffort id={id} />
          {compact && id.machine && <span className="shrink-0">· {id.machine}</span>}
        </span>
      </span>
      {!compact && <MachineChip machine={id.machine} className="justify-self-start" />}
      <span className={cn("min-w-0 truncate text-[13px]", wide, STATE_TONE[id.state])}>{said}</span>
      <span className={cn("min-w-0 text-xs text-muted-foreground", wide)}>
        <ModelEffort id={id} className="block" />
      </span>
      <span className={cn("items-center gap-2 text-xs tabular-nums text-muted-foreground", compact ? "hidden" : "hidden lg:flex")}>
        {id.ctxPct != null && (
          <>
            <CtxBar pct={id.ctxPct} className="w-auto flex-1" />
            {Math.round(id.ctxPct)}%
          </>
        )}
      </span>
    </div>
  );
}
