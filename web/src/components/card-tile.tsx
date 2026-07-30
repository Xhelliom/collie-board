import { Check, ChevronRight, CornerDownRight, GitBranch, Layers, Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { AgentIcon } from "@/components/agent-icon";
import { StatusBadge } from "@/components/status-badge";
import { CardStatusChip } from "@/components/card-status-chip";
import { shortCwd } from "@/lib/format";
import { paneDisplayName } from "@/lib/types";
import type { DependencyInfo } from "@/lib/board-groups";
import type { CardView } from "@/lib/board";

// One card in a board column. Deliberately the same visual language as AgentCard (the pane row):
// the board is a second lens on the same herd, not a different app.
//
// The badge on the right is the LIVE agent status when a pane is backing this card, and the card's
// own column otherwise — that distinction matters: an orphaned card has a status but no agent, and
// showing a fake "idle" badge for it would be a lie.
export function CardTile({
  card,
  onClick,
  dependency,
}: {
  card: CardView;
  onClick: () => void;
  /**
   * The card's declared predecessor, if any — shown on the TILE rather than left for the Start
   * button to reject (a 409 toast is a round trip for something the row already knew), and shown
   * even once satisfied so "why does this depend on that" doesn't require opening the editor.
   */
  dependency?: DependencyInfo;
}) {
  const waiting = dependency && !dependency.met;
  const urgent = card.status === "blocked";
  // Only when the pane has a name distinct from its bare agent slug — an icon already says "claude";
  // a real label or /rename name is the part worth repeating (UI_AUDIT.md G2: card title AND pane name).
  const paneName =
    card.runtime && (card.runtime.paneLabel || card.runtime.sessionName)
      ? paneDisplayName(card.runtime)
      : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left transition-transform active:scale-[0.99]"
    >
      <Card
        className={cn(
          "flex-row items-center gap-3 rounded-xl px-3.5 py-3 shadow-sm",
          urgent && "border-status-blocked/40 bg-status-blocked/5",
          // Held back, not broken — muted rather than alarming. `blocked` is the colour of "an
          // agent needs you"; waiting on a predecessor needs nothing from you at all.
          waiting && "border-dashed opacity-70",
        )}
      >
        {card.runtime ? (
          <AgentIcon agent={card.runtime.agent} className="size-9 shrink-0" />
        ) : (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted">
            <Layers className="size-4 text-muted-foreground" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 truncate">
            <span className="truncate font-medium">{card.title}</span>
            {paneName && <span className="truncate text-xs text-muted-foreground">· {paneName}</span>}
          </div>
          {dependency && (
            <div
              className={cn(
                "flex items-center gap-1 truncate text-xs",
                // Green once satisfied — a quiet confirmation, not an alert — amber/blocked-tinted
                // while it still holds the card back, so the colour alone answers "can I start this".
                dependency.met ? "text-status-done" : "text-status-blocked",
              )}
            >
              {dependency.met ? (
                <Check className="size-3 shrink-0" />
              ) : (
                <CornerDownRight className="size-3 shrink-0" />
              )}
              <span className="truncate">after “{dependency.title}”</span>
            </div>
          )}
          {/* Branch gets its OWN row: unbounded length, and packing it alongside cwd/sessionCount/
              ctx%/copilot below starved them of room (confirmed in a real browser at phone width —
              several of them got clipped with no ellipsis, not just visually tight). */}
          {card.branch && (
            <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              <GitBranch className="size-3 shrink-0" />
              <span className="truncate font-mono">{card.branch}</span>
            </div>
          )}
          <div className="flex items-center gap-2 truncate text-xs text-muted-foreground">
            {/* Only known once a pane backs the card — same restriction as ctx%, same reason. */}
            {card.runtime && <span className="truncate font-mono">{shortCwd(card.runtime.cwd)}</span>}
            {/* ctx% right after cwd, and shrink-0: it's the whole point of G1, so if the row is tight,
                cwd truncates (it already did, above) and sessionCount/copilotBusy get pushed off —
                not this. Confirmed in a real browser: with ctx% listed after sessionCount it was the
                one silently clipped. */}
            {card.session?.ctxPct != null && (
              <span className="shrink-0">· ctx {Math.round(card.session.ctxPct)}%</span>
            )}
            {card.sessionCount > 1 && <span>· {card.sessionCount} sessions</span>}
            {/* A card the copilot is holding looks identical to one it has abandoned — say which. */}
            {card.copilotBusy && <span className="animate-pulse">· copilot…</span>}
          </div>
        </div>

        {waiting ? (
          <Lock className="size-4 shrink-0 text-status-blocked" />
        ) : card.runtime ? (
          <StatusBadge status={card.runtime.agentStatus} />
        ) : (
          <CardStatusChip status={card.status} />
        )}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Card>
    </button>
  );
}
