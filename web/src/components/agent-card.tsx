import { ChevronRight, GitBranch, TerminalSquare } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { ShellBadge, StatusBadge, StatusDot } from "@/components/status-badge";
import { AgentIcon } from "@/components/agent-icon";
import { CtxBar } from "@/components/ctx-bar";
import { shortCwd } from "@/lib/format";
import { repoName } from "@/lib/board";
import { paneDisplayName, STATUS_LABEL } from "@/lib/types";
import type { AgentView } from "@/lib/types";

// A pane row, used by the space view. Usually an agent; for a bare shell pane (kind:"shell") it
// shows a terminal glyph and a muted "shell" tag instead of a status badge.
//
// The Herd triage (routes/home.tsx) uses its OWN three cards below instead — NeedsYouCard,
// WorkingCard, IdleDoneRow — because the redesign wants three DIFFERENT amounts of ink for three
// different urgencies (loud → medium → bare row), not one card reused three times at different
// tints. This one stays as the space view's card: every pane in a tab is equally "current", so
// there is no urgency ranking to express there.
export function AgentCard({ agent, onClick }: { agent: AgentView; onClick: () => void }) {
  const isShell = agent.kind === "shell";
  const blocked = agent.status === "blocked";
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
            <span className="truncate text-xs text-muted-foreground">· {agent.workspaceLabel}</span>
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
            {agent.ctxPct != null && <span className="shrink-0">· ctx {Math.round(agent.ctxPct)}%</span>}
          </div>
        </div>
        {isShell ? <ShellBadge /> : <StatusBadge status={agent.status} />}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Card>
    </button>
  );
}

/**
 * The Herd triage's LOUD card — one per blocked pane, the thing a glance is supposed to find
 * without reading anything. A solid status chip (not a tint) plus the whole card tinted/bordered in
 * the same tone is what carries that: more ink than every other row on the screen, on purpose.
 */
export function NeedsYouCard({ agent, onClick }: { agent: AgentView; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left transition-transform active:scale-[0.99]"
    >
      <div className="flex flex-col gap-2.5 rounded-2xl border border-status-blocked/45 bg-status-blocked/8 p-3.5 transition-colors hover:bg-status-blocked/14">
        <div className="flex items-center gap-2">
          <span className="shrink-0 rounded-full bg-status-blocked px-2.5 py-[3px] text-[length:var(--label-size)] font-bold uppercase tracking-[var(--label-tracking)] text-status-chip-foreground">
            {STATUS_LABEL.blocked}
          </span>
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {agent.workspaceLabel}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <AgentIcon agent={agent.agent} className="size-[26px] shrink-0" />
          <span className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-[-0.01em]">
            {paneDisplayName(agent)}
          </span>
        </div>
        {(agent.branch || agent.ctxPct != null) && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {agent.branch && (
              <>
                <GitBranch className="size-3 shrink-0" />
                <span className="min-w-0 truncate font-mono">{agent.branch}</span>
              </>
            )}
            {agent.ctxPct != null && (
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
                <CtxBar pct={agent.ctxPct} className="w-9" />
                <span className="tabular-nums">ctx {Math.round(agent.ctxPct)}%</span>
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

/** The Herd triage's MEDIUM card — a working pane. Less ink than NeedsYouCard: a plain bordered
 *  card, a pulsing dot rather than a filled chip, one metadata line instead of two. */
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
          <div className="truncate text-[15px] font-semibold">{paneDisplayName(agent)}</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {agent.workspaceLabel}
            {agent.ctxPct != null && ` · ctx ${Math.round(agent.ctxPct)}%`}
          </div>
        </div>
        {/* size-2.5 = 10px, already StatusDot's default. */}
        <StatusDot status={agent.status} />
      </div>
    </button>
  );
}

/** The Herd triage's QUIET row — idle or done. No card at all: the ranking IS the design, and a
 *  settled pane earns the least ink of the three. */
export function IdleDoneRow({ agent, onClick }: { agent: AgentView; onClick: () => void }) {
  const isShell = agent.kind === "shell";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted/40 active:scale-[0.99]"
    >
      {isShell ? (
        <TerminalSquare className="size-5 shrink-0 text-muted-foreground opacity-75" />
      ) : (
        <AgentIcon agent={agent.agent} className="size-5 shrink-0 opacity-75" />
      )}
      {/* The name alone doesn't distinguish rows — several idle/done panes are routinely all
          "claude" (paneDisplayName's fallback). The Herdr workspace name is the actual
          differentiator, so it rides along on every breakpoint now, not just desktop. */}
      <span className="min-w-0 flex-1 truncate text-sm">
        {paneDisplayName(agent)}
        <span className="text-muted-foreground"> · {agent.workspaceLabel}</span>
      </span>
      {/* Repo (last segment of cwd) — NOT the same field as the workspace name above: Herdr lets a
          workspace be labelled anything, so the two agree by convention, not by guarantee. */}
      <span className="w-16 shrink-0 truncate font-mono text-[11px] text-muted-foreground sm:w-20 lg:w-24">
        {repoName(agent.cwd)}
      </span>
      <span className="shrink-0 truncate font-mono text-[11px] text-muted-foreground">
        {isShell ? "shell" : STATUS_LABEL[agent.status]}
      </span>
    </button>
  );
}
