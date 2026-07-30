import { useState } from "react";
import { ChevronDown, ChevronRight, Layers } from "lucide-react";

import { cn } from "@/lib/utils";
import { CardTile } from "@/components/card-tile";
import { CardStatusChip } from "@/components/card-status-chip";
import { BOARD_COLUMNS, type CardView } from "@/lib/board";
import { dependencyInfo, groupOpenByDefault } from "@/lib/board-groups";

// A container card and the sub-tasks it was split into, as one entry on the board.
//
// The header is NOT a card tile and deliberately doesn't look like one: a container holds no work
// of its own and the bridge refuses to start it, so anything that invites a tap-to-start is a lie
// the server will answer with a 409. It opens the group; it does not open a card.
//
// The dictation that produced the split still lives on the container, though, so it has to stay
// reachable — that is what the title link is for.

export function CardGroup({
  container,
  subTasks,
  byId,
  onOpen,
}: {
  container: CardView;
  subTasks: CardView[];
  /** Every card on the board, for resolving a sub-task's predecessor by id. */
  byId: Map<string, CardView>;
  onOpen: (cardId: string) => void;
}) {
  // The default follows the column's job (see board-groups.ts); a tap overrides it for this
  // session only. Nothing is persisted: a preference that outlives the reason for it is worse than
  // no preference, and the column a group sits in changes on its own.
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? groupOpenByDefault(container.status);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-card/40",
        container.status === "blocked" && "border-status-blocked/40",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen(!expanded)}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse sub-tasks" : "Expand sub-tasks"}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground active:scale-95"
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>

        {/* The container is still a card — it holds the original dictation and the "reformulate the
            whole thing" action, so it must be openable even though it can't be started. */}
        <button
          type="button"
          onClick={() => onOpen(container.id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Layers className="size-3.5 shrink-0 text-muted-foreground" />
          {/* A container's title is a card title — same rung as the tiles it groups (R2). */}
          <span className="truncate text-base font-medium">{container.title}</span>
        </button>

        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {subTasks.length}
        </span>
        {!expanded && <GroupSummary cards={subTasks} />}
      </div>

      {expanded && (
        <div className="flex flex-col gap-2 border-t border-dashed px-2 pb-2 pt-2">
          {subTasks.map((child) => (
            <CardTile
              key={child.id}
              card={child}
              onClick={() => onOpen(child.id)}
              dependency={dependencyInfo(child, byId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}


/**
 * What a collapsed group says about itself: one chip per distinct sub-task status, most urgent
 * first. The point of collapsing is density, so this is counts and colour — not titles, which is
 * what expanding is for.
 */
function GroupSummary({ cards }: { cards: CardView[] }) {
  const counts = new Map<CardView["status"], number>();
  for (const c of cards) counts.set(c.status, (counts.get(c.status) ?? 0) + 1);
  // Ordered by BOARD_COLUMNS, not by insertion: a Map would otherwise follow the sub-tasks' own
  // order, and "1 done · 2 blocked" buries the only chip that matters behind the one that doesn't.
  const ordered = BOARD_COLUMNS.filter((s) => counts.has(s)).map((s) => [s, counts.get(s)!] as const);
  return (
    <span className="flex shrink-0 items-center gap-1">
      {ordered.map(([status, n]) => (
        <CardStatusChip key={status} status={status} className="px-1.5 tabular-nums">
          <span title={`${n} ${status}`}>{n}</span>
        </CardStatusChip>
      ))}
    </span>
  );
}
