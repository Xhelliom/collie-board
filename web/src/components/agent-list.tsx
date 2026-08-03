import { Inbox } from "lucide-react";

import { cn } from "@/lib/utils";
import { AGENT_GROUPS, type AgentGroup } from "@/lib/agent-groups";
import type { AgentView, BridgeStatus } from "@/lib/types";
import { AgentCard } from "./agent-card";

interface AgentListProps {
  agents: AgentView[];
  bridge?: BridgeStatus | undefined;
  onOpen: (paneId: string) => void;
  /** Which triage groups to render (default: all). Lets the dashboard hoist "Needs you" above the
   *  spaces overview while the rest render below it. */
  groups?: readonly AgentGroup[];
  /** Show the "no agents" placeholder when the herd is empty (default true). Turn off for a partial
   *  slice (e.g. the hoisted "Needs you" list) so the placeholder only appears once, on the main list. */
  emptyState?: boolean;
}

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

  // Only render groups that actually have members — and nothing at all if this slice is empty (e.g.
  // the hoisted "Needs you" list when no agent is blocked), so it adds no stray padding.
  const sections = groups
    .map((g) => ({ g, members: agents.filter((a) => g.match(a.status)) }))
    .filter((s) => s.members.length > 0);
  if (sections.length === 0) return null;

  return (
    <div className="flex flex-col gap-5 px-3 py-4">
      {sections.map(({ g, members }) => (
        <section key={g.key} className="flex flex-col gap-2">
          <h2
            className={cn(
              "px-1 text-xs font-semibold uppercase tracking-wide",
              g.accent ? "text-status-blocked" : "text-muted-foreground",
            )}
          >
            {g.label} <span className="opacity-60">({members.length})</span>
          </h2>
          {/* One column below `lg` — the phone's stack, unchanged — then as many 24rem tracks as
              fit. `auto-fill` rather than fixed breakpoints because the answer isn't "how big is the
              viewport" but "how many readable cards fit in it", and that is a question CSS can
              answer better than a ladder of `lg:`/`xl:`/`2xl:` guesses. `auto-fill` rather than
              `auto-fit` so a lone card stays 24rem instead of stretching across a 27" display. */}
          <div className="grid gap-2 lg:grid-cols-[repeat(auto-fill,minmax(24rem,1fr))]">
            {members.map((a) => (
              <AgentCard key={a.paneId} agent={a} onClick={() => onOpen(a.paneId)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
