import { Brush, Inbox, Monitor } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { AGENT_GROUPS, groupMembers, isOrchestrator, type AgentGroup } from "@/lib/agent-groups";
import type { AgentView, BridgeStatus } from "@/lib/types";
import type { PeerHerdView } from "@/lib/peers";
import { useFold } from "./fold";
import { Button } from "./ui/button";
import { Chip } from "./ui/chip";
import { IdleDoneRow, NeedsYouCard, WorkingCard } from "./agent-card";
import { usePins } from "@/lib/pins";
import { GonePin, PinButton, resolvePins } from "./pin-button";
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
  // Which machine's agents: null all, "" this one, else a paired peer. Drawn only once a peer has one.
  const [machine, setMachine] = useState<string | null>(null);
  const machines = [...new Set(agents.flatMap((a) => (a.peer ? [a.peer] : [])))];
  const hasOrch = agents.some(isOrchestrator);
  const pins = usePins(agents);
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
  const shown = agents.filter((a) => (!orchOnly || isOrchestrator(a)) && (machine === null || (a.peer ?? "") === machine));
  const sections = groups
    .map((g) => ({ g, members: groupMembers(shown, g) }))
    .filter((s) => s.members.length > 0);
  if (sections.length === 0 && !orchOnly && machine === null) return null;

  return (
    <div className="flex flex-col gap-7">
      {/* Phone only: the desktop sidebar already lists them under the orchestrators. */}
      {pins.length > 0 && (
        <section className="flex flex-col gap-2.5 lg:hidden">
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
            {t("quick.pinned")}
          </h2>
          <div className="flex flex-col">
            {resolvePins(pins, agents).map(({ pin, agent: a }) =>
              a ? (
                <IdleDoneRow key={pin.session} agent={a} onClick={() => onOpen(a.paneId)} />
              ) : (
                <GonePin key={pin.session} pin={pin} className="px-3 py-1.5 text-sm" />
              ),
            )}
          </div>
        </section>
      )}
      <div className="-mb-3 flex items-center gap-2">
        {(hasOrch || orchOnly || machines.length > 0 || machine !== null) && (
          <Chip
            label={t("filter.all")}
            active={!orchOnly && machine === null}
            onClick={() => {
              setOrchOnly(false);
              setMachine(null);
            }}
          />
        )}
        {(hasOrch || orchOnly) && (
          <Chip label={t("home.filter.orch")} active={orchOnly} onClick={() => setOrchOnly(!orchOnly)} />
        )}
        {(machines.length > 0 || machine !== null) &&
          ["", ...machines].map((m) => (
            <Chip key={m} label={m || t("machines.this")} active={machine === m} onClick={() => setMachine(machine === m ? null : m)} />
          ))}
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
              {members.map((a) => (
                <Pinnable key={a.paneId} agent={a}>
                  {g.key === "needs" ? (
                    <NeedsYouCard agent={a} onClick={() => onOpen(a.paneId)} />
                  ) : (
                    <WorkingCard agent={a} onClick={() => onOpen(a.paneId)} />
                  )}
                </Pinnable>
              ))}
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
        <Pinnable key={a.paneId} agent={a}>
          <IdleDoneRow agent={a} onClick={() => onOpen(a.paneId)} />
        </Pinnable>
      ))}
      {toggle}
    </div>
  );
}

/** A tile with its pin beside it — a sibling, since a button can't hold another. */
function Pinnable({ agent, children }: { agent: AgentView; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <div className="min-w-0 flex-1">{children}</div>
      <PinButton agent={agent} />
    </div>
  );
}

/** A paired peer whose herd can't be read: one greyed line saying why — never its last-known agents. */
export function PeersDown({ peers }: { peers: readonly PeerHerdView[] }) {
  const t = useT();
  const down = peers.filter((p) => p.state === "disconnected");
  if (down.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {down.map((p) => (
        <div key={p.peer} role="status" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground opacity-70">
          <Monitor className="size-4 shrink-0" />
          <span className="shrink-0 font-medium">{t("herd.peerDown", { peer: p.peer })}</span>
          {p.error && <span className="min-w-0 truncate font-mono text-[11px]">{p.error}</span>}
        </div>
      ))}
    </div>
  );
}
