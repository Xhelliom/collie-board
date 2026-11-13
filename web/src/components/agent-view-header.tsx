// Who the open agent is, at the top of its view: the same identity the Agents page lists
// (lib/agent-identity.ts, the pieces of agent-line.tsx), laid out for a header. Desktop: name and
// state, then project · machine · model · sub-agents, the gauge beside. Phone: three short lines.
import { useT } from "@/i18n";
import { projectOf } from "@/lib/agent-groups";
import { agentIdentity } from "@/lib/agent-identity";
import type { AgentView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MachineChip, ModelEffort, STATE_TONE, useStateSaid } from "./agent-line";
import { CtxBar } from "./ctx-bar";
import { SubagentsLine } from "./subagents-line";

/** « contexte 26 % », its bar before it; nothing without a number. */
export function ContextMeter({ agent, className }: { agent: AgentView; className?: string }) {
  const t = useT();
  const pct = agent.ctxPct;
  if (pct == null) return null;
  return (
    <span
      className={cn("flex shrink-0 items-center gap-2 whitespace-nowrap text-xs tabular-nums text-muted-foreground", className)}
      title={agent.ctxTokens != null ? t("gauge.tokens", { count: Math.round(agent.ctxTokens / 1000) }) : undefined}
    >
      <CtxBar pct={pct} className="w-[90px]" />
      {t("pane.contextPct", { pct: Math.round(pct) })}
    </span>
  );
}

/** `stale`: the connection isn't live, so the state is the last snapshot's — dimmed, not presented as current. */
export function AgentViewIdentity({ agent, stale, phone = false }: { agent: AgentView; stale: boolean; phone?: boolean }) {
  const t = useT();
  const id = agentIdentity(agent, t("agents.orchestrator"));
  const said = useStateSaid(id);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      {/* The state drops under the name rather than squeeze it: a card title is long, a phone narrow. */}
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
        <span className={cn("min-w-0 max-w-full truncate font-semibold leading-tight", phone ? "text-base" : "text-[17px]")}>{id.name}</span>
        <span className={cn("shrink-0 text-[13px]", id.state === "idle" ? "text-muted-foreground" : STATE_TONE[id.state], stale && "opacity-50")}>{said}</span>
      </div>
      <div className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
        <span className="shrink-0">{projectOf(agent.cwd)}</span>
        <MachineChip machine={id.machine} />
        <ModelEffort id={id} />
        {!phone && <SubagentsLine subagents={agent.subagents} className="text-[13px]" />}
      </div>
      {phone && <ContextMeter agent={agent} className="mt-1" />}
    </div>
  );
}
