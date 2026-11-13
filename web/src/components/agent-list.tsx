import { Brush, ChevronRight } from "lucide-react";
import { useState } from "react";

import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { AGENT_GROUPS, groupMembers, projectOf } from "@/lib/agent-groups";
import type { AgentView } from "@/lib/types";
import { headline } from "./agent-card";
import { Button } from "./ui/button";
import { Chip } from "./ui/chip";
import { PinButton } from "./pin-button";
import { StatusDot } from "./status-badge";
import { TidySheet } from "./tidy-sheet";

const [NEEDS, WORKING, OTHER] = AGENT_GROUPS as [(typeof AGENT_GROUPS)[number], (typeof AGENT_GROUPS)[number], (typeof AGENT_GROUPS)[number]];
export const sectionTitle = "text-sm font-medium text-muted-foreground";

/** One agent, one line: its state, what it works on, its project, its machine. The pin shows on hover. */
export function AgentRow({ agent, onOpen }: { agent: AgentView; onOpen: (paneId: string) => void }) {
  const t = useT();
  const blocked = agent.status === "blocked";
  return (
    <div className="group flex min-w-0 items-center gap-1">
      <button
        type="button"
        onClick={() => onOpen(agent.paneId)}
        className={cn(
          "flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl border bg-card/70 px-3.5 py-2 text-left transition-colors hover:bg-muted/40",
          blocked && "border-status-blocked/40 bg-status-blocked/5 hover:bg-status-blocked/10",
        )}
      >
        <StatusDot status={agent.status} />
        <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-3">
          <span className="min-w-0 truncate font-medium sm:flex-1">{agent.cardTitle ?? headline(agent)}</span>
          <span className="min-w-0 truncate text-sm text-muted-foreground sm:max-w-[40%] sm:shrink-0">{projectOf(agent.cwd)}</span>
        </span>
        <span className="shrink-0 rounded-full bg-muted px-2 text-xs leading-5 text-muted-foreground">{agent.peer ?? t("home.machine.this")}</span>
      </button>
      {/* No hover on a touch screen: the pin lives on the Agents page there. */}
      <PinButton agent={agent} className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:hidden" />
    </div>
  );
}

interface AgentListProps {
  /** The herd as the home shows it (orchestrators already left out unless asked for). */
  agents: AgentView[];
  onOpen: (paneId: string) => void;
  /** « Avec les orchestrateurs »: drawn when the herd has one. */
  hasOrch: boolean;
  withOrch: boolean;
  onWithOrch: (on: boolean) => void;
}

// The home's agents: « T'attendent » (only when someone does), then « Au travail », one row each,
// ranked by state alone. The resting ones are IdleAgents', folded further down the screen.
export function AgentList({ agents, onOpen, hasOrch, withOrch, onWithOrch }: AgentListProps) {
  const t = useT();
  // Which machine's agents: null all, "" this one, else a paired peer. Drawn only once a peer has one.
  const [machine, setMachine] = useState<string | null>(null);
  const machines = [...new Set(agents.flatMap((a) => (a.peer ? [a.peer] : [])))];
  const shown = agents.filter((a) => machine === null || (a.peer ?? "") === machine);
  const needs = groupMembers(shown, NEEDS);
  const working = groupMembers(shown, WORKING);
  return (
    <div className="flex flex-col gap-6">
      {needs.length > 0 && (
        <section className="flex flex-col gap-1.5" aria-label={t("home.herd.needs")}>
          <h2 className={cn(sectionTitle, "mb-1 text-status-blocked")}>{t("home.herd.needs")}</h2>
          {needs.map((a) => <AgentRow key={a.paneId} agent={a} onOpen={onOpen} />)}
        </section>
      )}
      <section className="flex flex-col gap-1.5" aria-label={t("home.herd.working")}>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h2 className={cn(sectionTitle, "flex-1")}>{t("home.herd.working")}</h2>
          {hasOrch && <Chip label={t("home.filter.withOrch")} active={withOrch} onClick={() => onWithOrch(!withOrch)} />}
          {(machines.length > 0 || machine !== null) && (
            <span className="hidden gap-2 sm:flex">
              {["", ...machines].map((m) => (
                <Chip key={m} label={m || t("home.machine.this")} active={machine === m} onClick={() => setMachine(machine === m ? null : m)} />
              ))}
            </span>
          )}
        </div>
        {working.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("home.herd.nobody")}</p>
        ) : (
          working.map((a) => <AgentRow key={a.paneId} agent={a} onOpen={onOpen} />)
        )}
      </section>
    </div>
  );
}

/** « Agents au repos (N) », folded: the settled herd, newest first, and the tidy-up beside it. */
export function IdleAgents({ agents, onOpen, className }: { agents: AgentView[]; onOpen: (paneId: string) => void; className?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [tidy, setTidy] = useState(false);
  const members = groupMembers(agents, OTHER);
  if (members.length === 0) return null;
  return (
    <section className={cn("flex flex-col gap-1.5", className)} aria-label={t("home.herd.idle", { count: members.length })}>
      <div className="flex items-center">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-h-11 flex-1 items-center gap-2 text-left text-sm text-muted-foreground hover:text-foreground">
          <ChevronRight className={cn("size-4 transition-transform motion-reduce:transition-none", open && "rotate-90")} />
          {t("home.herd.idle", { count: members.length })}
        </button>
        {open && (
          <Button variant="ghost" size="sm" onClick={() => setTidy(true)}>
            <Brush />
            {t("tidy.open")}
          </Button>
        )}
      </div>
      {open && members.map((a) => <AgentRow key={a.paneId} agent={a} onOpen={onOpen} />)}
      {/* Mounted only while open — it reads the router, which a bare list doesn't need. */}
      {tidy && <TidySheet open onClose={() => setTidy(false)} />}
    </section>
  );
}
