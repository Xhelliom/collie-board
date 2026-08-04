import { Inbox } from "lucide-react";

import { cn } from "@/lib/utils";
import { AGENT_GROUPS, type AgentGroup } from "@/lib/agent-groups";
import type { AgentView, BridgeStatus } from "@/lib/types";
import { IdleDoneRow, NeedsYouCard, WorkingCard } from "./agent-card";

interface AgentListProps {
  agents: AgentView[];
  bridge?: BridgeStatus | undefined;
  onOpen: (paneId: string) => void;
  /** Which triage groups to render (default: all three). */
  groups?: readonly AgentGroup[];
  /** Show the "no agents" placeholder when the herd is empty (default true). */
  emptyState?: boolean;
}

// The Herd triage (redesign §1): needs you (loud) → working (medium) → idle · done (a bare row) —
// see agent-card.tsx for why these are three DIFFERENT components rather than one card reused at
// three tints. The ranking IS the design: more ink for more urgency, so a glance finds the blocked
// agent without reading anything. `groups` narrows which sections render (unused now that the home
// screen shows all three together, kept so a partial slice stays possible if that changes again).
export function AgentList({
  agents,
  bridge,
  onOpen,
  groups = AGENT_GROUPS,
  emptyState = true,
}: AgentListProps) {
  if (agents.length === 0) {
    if (!emptyState) return null;
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
        <Inbox className="size-7" />
        <span className="text-sm">
          {bridge === "connected" ? "No agents running." : "Waiting for Herdr…"}
        </span>
      </div>
    );
  }

  // Only render groups that actually have members — and nothing at all if every slice is empty, so
  // it adds no stray padding.
  const sections = groups
    .map((g) => ({ g, members: agents.filter((a) => g.match(a.status)) }))
    .filter((s) => s.members.length > 0);
  if (sections.length === 0) return null;

  return (
    <div className="flex flex-col gap-7">
      {sections.map(({ g, members }) => (
        <section key={g.key} className="flex flex-col gap-2.5">
          <h2
            className={cn(
              "flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em]",
              g.accent ? "text-status-blocked" : "text-muted-foreground",
            )}
          >
            <span aria-hidden className={cn("size-2 shrink-0 rounded-full", g.dot)} />
            {g.label}
            <span className="font-semibold tabular-nums opacity-70">({members.length})</span>
          </h2>
          {g.key === "other" ? (
            // The quiet list: no grid, no cards — a settled pane earns the least ink of the three.
            <div className="flex flex-col lg:max-w-[720px]">
              {members.map((a) => (
                <IdleDoneRow key={a.paneId} agent={a} onClick={() => onOpen(a.paneId)} />
              ))}
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-[repeat(auto-fill,minmax(360px,1fr))]">
              {members.map((a) =>
                g.key === "needs" ? (
                  <NeedsYouCard key={a.paneId} agent={a} onClick={() => onOpen(a.paneId)} />
                ) : (
                  <WorkingCard key={a.paneId} agent={a} onClick={() => onOpen(a.paneId)} />
                ),
              )}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
