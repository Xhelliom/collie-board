import { ChevronRight, GitBranch, Monitor, TerminalSquare } from "lucide-react";

import { cn } from "@/lib/utils";
import { ModelTag } from "@/components/model-tag";
import { Card } from "@/components/ui/card";
import { ShellBadge, StatusBadge, StatusDot } from "@/components/status-badge";
import { AgentIcon } from "@/components/agent-icon";
import { SubagentsLine } from "@/components/subagents-line";
import { shortCwd, timeAgo } from "@/lib/format";
import { placeOf } from "@/lib/agent-groups";
import { paneDisplayName } from "@/lib/types";
import type { AgentView } from "@/lib/types";
import { useT } from "@/i18n";

// A pane row, used by the space view. Usually an agent; for a bare shell pane (kind:"shell") it
// shows a terminal glyph and a muted "shell" tag instead of a status badge.
// The home lists the herd one line per agent instead (agent-list.tsx `AgentRow`).
/** An unnamed pane is "claude" like its neighbours; the workspace is what tells them apart, so it
 *  becomes the title and the agent name the footnote. */
const named = (a: AgentView) => !!(a.paneLabel || a.sessionName);
export const headline = (a: AgentView) => (named(a) ? paneDisplayName(a) : placeOf(a));
const footnote = (a: AgentView) => (named(a) ? placeOf(a) : paneDisplayName(a));

/**
 * "5m ago" for a SETTLED pane — how long it has been idle / done, so a session that just finished
 * reads differently from one that has been sitting there all afternoon. Only idle/done (the note
 * asks nothing for the others), and only when the bridge actually witnessed the switch: an unknown
 * instant renders nothing rather than a made-up duration (see `AgentView.statusSince`).
 */
export function settledFor(agent: AgentView): string | null {
  if (agent.status !== "idle" && agent.status !== "done") return null;
  return agent.statusSince === undefined ? null : timeAgo(agent.statusSince);
}

/** « sur dev » — where a paired peer's agent runs, in a card tile's words (ADR 0046 §4) — and, while
 *  the herd mixes herdr 0.9 and hc, which engine the pane runs on (ADR 0052 §4.2). */
export function PeerChip({ agent }: { agent: AgentView }) {
  const t = useT();
  if (!agent.peer && !agent.engine) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground">
      {agent.peer && (
        <>
          <Monitor className="size-3 shrink-0" />
          {t("cardEnv.on", { peer: agent.peer })}
        </>
      )}
      {agent.engine && (
        <span className="rounded border border-border px-1 leading-4" title={agent.engine}>
          {t(`cardEnv.engine.${agent.engine}`)}
        </span>
      )}
    </span>
  );
}

export function AgentCard({ agent, onClick }: { agent: AgentView; onClick: () => void }) {
  const isShell = agent.kind === "shell";
  const blocked = agent.status === "blocked";
  const settled = settledFor(agent);
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left transition-transform active:scale-[0.99]"
    >
      <Card
        className={cn(
          "flex-row items-center gap-3 rounded-xl px-3.5 py-3 shadow-sm transition-colors hover:bg-muted/40",
          blocked && "border-status-blocked/40 bg-status-blocked/5",
        )}
      >
        {isShell ? (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted">
            <TerminalSquare className="size-4 text-muted-foreground" />
          </div>
        ) : (
          <AgentIcon agent={agent.agent} className="size-9" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {/* Name slot: a user label, else Claude's /rename session name, else the agent name — the
                icon still shows which agent it is (see paneDisplayName). */}
            <span className="truncate font-medium">{paneDisplayName(agent)}</span>
            <span className="truncate text-xs text-muted-foreground">· {placeOf(agent)}</span>
            {/* The pane number — two agents in one space+tab are otherwise the same card twice
                (same name, same cwd, same ctx), so "which one did I just tap?" has no answer. The
                pane rail already labels its rows this way. */}
            <span className="shrink-0 font-mono text-xs text-muted-foreground/70">
              {agent.paneId.split(":").pop()}
            </span>
          </div>
          {/* Branch gets its OWN row: unlike cwd/ctx% it's unbounded length, and packing it into the
              row below starved ctx% of room (confirmed in a real browser at phone width — the branch
              icon and the ctx% number both got clipped with no ellipsis, not just visually tight).
              The BRANCH only ever appears for a pane backing an open board card (bridge
              `withCardFields`); ctx% below appears for any agent pane the bridge could read
              (`ContextTracker.enrich`, G3). Same fields CardTile shows, so a card ↔ agent pair reads
              the same on both screens (UI_AUDIT.md G2). */}
          {agent.branch && (
            <div className="flex items-center gap-1 truncate font-mono text-xs text-muted-foreground">
              <GitBranch className="size-3 shrink-0" />
              <span className="truncate">{agent.branch}</span>
            </div>
          )}
          <div className="flex items-center gap-2 truncate text-xs text-muted-foreground">
            <span className="truncate font-mono">{shortCwd(agent.cwd)}</span>
            <ModelTag model={agent.model} effort={agent.effort} lead />
            {agent.ctxPct != null && <span className="shrink-0">· ctx {Math.round(agent.ctxPct)}%</span>}
          </div>
          <SubagentsLine subagents={agent.subagents} />
        </div>
        {settled && <span className="shrink-0 text-[11px] text-muted-foreground">{settled}</span>}
        {isShell ? <ShellBadge /> : <StatusBadge status={agent.status} />}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Card>
    </button>
  );
}

/** A working pane as a medium card: a plain bordered card, a dot, one metadata line (a card's own agent). */
export function WorkingCard({ agent, onClick }: { agent: AgentView; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left transition-transform active:scale-[0.99]"
    >
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 transition-colors hover:bg-muted/40">
        <AgentIcon agent={agent.agent} className="size-[26px] shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{headline(agent)}</div>
          <div className="flex gap-1 font-mono text-[11px] text-muted-foreground">
            <span className="min-w-0 truncate">{footnote(agent)}</span>
            <ModelTag model={agent.model} effort={agent.effort} lead />
            {agent.ctxPct != null && <span className="shrink-0">· ctx {Math.round(agent.ctxPct)}%</span>}
          </div>
          <SubagentsLine subagents={agent.subagents} />
        </div>
        <PeerChip agent={agent} />
        {/* size-2.5 = 10px, already StatusDot's default. */}
        <StatusDot status={agent.status} />
      </div>
    </button>
  );
}
