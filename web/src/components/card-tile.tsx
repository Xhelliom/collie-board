import { ChevronRight, CornerDownRight, GitBranch, Layers, Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { AgentIcon } from "@/components/agent-icon";
import { StatusBadge } from "@/components/status-badge";
import { CardStatusChip } from "@/components/card-status-chip";
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
  waitingOn,
}: {
  card: CardView;
  onClick: () => void;
  /**
   * The unfinished predecessor holding this card back, if any. Shown on the TILE rather than left
   * for the Start button to reject: a 409 toast is a round trip for something the row already knew.
   */
  waitingOn?: string;
}) {
  const urgent = card.status === "blocked";
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
          waitingOn && "border-dashed opacity-70",
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
          <div className="truncate font-medium">{card.title}</div>
          {waitingOn && (
            <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              <CornerDownRight className="size-3 shrink-0" />
              <span className="truncate">after “{waitingOn}”</span>
            </div>
          )}
          <div className="flex items-center gap-2 truncate text-xs text-muted-foreground">
            {card.branch && (
              <span className="flex min-w-0 items-center gap-1">
                <GitBranch className="size-3 shrink-0" />
                <span className="truncate font-mono">{card.branch}</span>
              </span>
            )}
            {card.sessionCount > 1 && <span>· {card.sessionCount} sessions</span>}
            {card.session?.ctxPct != null && <span>· ctx {Math.round(card.session.ctxPct)}%</span>}
          </div>
        </div>

        {waitingOn ? (
          <Lock className="size-4 shrink-0 text-muted-foreground" />
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
