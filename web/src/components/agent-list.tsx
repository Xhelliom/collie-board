import { Brush, Inbox } from "lucide-react";
import { useState } from "react";

import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { AGENT_GROUPS, groupMembers, isOrchestrator, type AgentGroup } from "@/lib/agent-groups";
import type { AgentView, BridgeStatus } from "@/lib/types";
import { useFold } from "./fold";
import { Button } from "./ui/button";
import { Chip } from "./ui/chip";
import { IdleDoneRow, NeedsYouCard, WorkingCard } from "./agent-card";
import { TidySheet } from "./tidy-sheet";

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
  const t = useT();
  // "All" / "Orchestrators": drawn only when the herd has one — and kept while on, so a list narrowed
  // by a chip that isn't drawn never silently loses its panes.
  const [orchOnly, setOrchOnly] = useState(false);
  const [tidy, setTidy] = useState(false);
  const hasOrch = agents.some(isOrchestrator);
  if (agents.length === 0) {
    if (!emptyState) return null;
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
        <Inbox className="size-7" />
        <span className="text-sm">
          {bridge === "connected" ? t("home.empty.none") : t("home.empty.waiting")}
        </span>
      </div>
    );
  }

  // Only render groups that actually have members — and nothing at all if every slice is empty, so
  // it adds no stray padding.
  const shown = orchOnly ? agents.filter(isOrchestrator) : agents;
  const sections = groups
    .map((g) => ({ g, members: groupMembers(shown, g) }))
    .filter((s) => s.members.length > 0);
  if (sections.length === 0 && !orchOnly) return null;

  return (
    <div className="flex flex-col gap-7">
      <div className="-mb-3 flex items-center gap-2">
        {(hasOrch || orchOnly) && (
          <>
            <Chip label={t("filter.all")} active={!orchOnly} onClick={() => setOrchOnly(false)} />
            <Chip label={t("home.filter.orch")} active={orchOnly} onClick={() => setOrchOnly(!orchOnly)} />
          </>
        )}
        {/* « Ménage »: mounted only while open — it reads the router, which a bare list doesn't need. */}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setTidy(true)}>
          <Brush />
          {t("tidy.open")}
        </Button>
        {tidy && <TidySheet open onClose={() => setTidy(false)} />}
      </div>
      {sections.map(({ g, members }) => (
        <section key={g.key} className="flex flex-col gap-2.5">
          <h2
            className={cn(
              "flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em]",
              g.accent ? "text-status-blocked" : "text-muted-foreground",
            )}
          >
            <span aria-hidden className={cn("size-2 shrink-0 rounded-full", g.dot)} />
            {t(g.label)}
            <span className="font-semibold tabular-nums opacity-70">({members.length})</span>
          </h2>
          {g.key === "other" ? (
            // The quiet list: no grid, no cards — a settled pane earns the least ink of the three.
            <IdleList members={members} onOpen={onOpen} />
          ) : (
            // `[&>*]:min-w-0`: a grid item defaults to min-width:auto, i.e. it never shrinks below
            // its min-content — and a card full of `truncate` text has a min-content as wide as the
            // untruncated string, so the card grew past the viewport instead of ellipsising.
            <div className="grid gap-3 [&>*]:min-w-0 lg:grid-cols-[repeat(auto-fill,minmax(360px,1fr))]">
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

/** Idle · done grows with every finished pane: the newest few, the rest a tap away (members come newest first). */
function IdleList({ members, onOpen }: { members: AgentView[]; onOpen: (paneId: string) => void }) {
  const { shown, toggle } = useFold(members, 4);
  return (
    <div className="flex flex-col lg:max-w-[720px]">
      {shown.map((a) => (
        <IdleDoneRow key={a.paneId} agent={a} onClick={() => onOpen(a.paneId)} />
      ))}
      {toggle}
    </div>
  );
}
