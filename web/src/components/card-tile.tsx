import { useT } from "@/i18n";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { AgentIcon } from "@/components/agent-icon";
import { useStateSaid } from "@/components/agent-line";
import { agentIdentity, stateOf } from "@/lib/agent-identity";
import type { AgentView } from "@/lib/types";
import type { Awaiting, CardView } from "@/lib/board";
import type { DependencyInfo } from "@/lib/board-groups";
import type { LotHold } from "@/lib/lot-hold";
import type { CardFacts } from "@/lib/project-facts";
import { tileState, type TileTone } from "@/lib/tile-state";

// One card in a board column, in three lines: its title, its phase, and ONE readable state computed
// from what the card already knows (lib/tile-state.ts). Everything else — origin, branch, criteria,
// people, milestones — lives on the card's own page: a tile answers "where is this", not "what is it".
// Red means blocked and nothing else; a card waiting on you is loud in weight, not in colour.

const TONE: Record<TileTone, string> = {
  bad: "text-status-blocked",
  good: "text-status-done",
  strong: "font-medium text-foreground",
  plain: "text-muted-foreground",
  quiet: "text-muted-foreground/75",
};

/** « travaille depuis 7 min » — the same words and icon as the Agents page (agent-identity). */
function AgentState({ card, agent }: { card: CardView; agent?: AgentView }) {
  const t = useT();
  const runtime = card.runtime!;
  // The herd's own line when the snapshot has the pane; the card's runtime mirror (no age) otherwise.
  const id = agent
    ? agentIdentity(agent, t("agents.orchestrator"))
    : { word: stateOf({ status: runtime.agentStatus }), since: null };
  const said = useStateSaid(id);
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1.5",
        id.word === "needs" ? TONE.strong : id.word === "working" ? "text-status-working" : TONE.plain,
      )}
    >
      <AgentIcon agent={runtime.agent} className="size-4 shrink-0" />
      <span className="truncate">{said}</span>
    </span>
  );
}

/**
 * The card that flies with the cursor.
 *
 * HTML5 drag always carries an image — the browser snapshots the source element, washed out and
 * flat, anchored wherever the tile happened to be grabbed. `setDragImage` replaces it, and a CLONE
 * is what makes that worth doing: same markup, same classes, so it looks like the tile rather than
 * like a picture of it, but opaque, lifted on a real shadow and tilted a couple of degrees. Tilt is
 * the whole trick — a rectangle at exactly 0° reads as part of the layout; two degrees off reads as
 * held.
 *
 * The clone has to be IN the document to be painted, so it sits off-screen for the one frame the
 * browser needs to take its picture, then goes. The snapshot is frozen at that instant, which is
 * also the limit of this approach: nothing about the flying card can animate afterwards. A card
 * that scales as you lift it, or eases into its slot on release, is a library (or a pointer-event
 * drag of our own) — this is the 15-line version of the same idea.
 */
function flyingCard(el: HTMLElement, e: React.DragEvent): void {
  const rect = el.getBoundingClientRect();
  const clone = el.cloneNode(true) as HTMLElement;
  clone.style.cssText = `position:fixed;top:-9999px;left:0;width:${rect.width}px;pointer-events:none;border-radius:0.75rem;transform:rotate(-2deg);box-shadow:0 16px 32px -8px rgb(0 0 0 / 0.35)`;
  document.body.appendChild(clone);
  // Grab offset, so the card stays under the exact point it was picked up by rather than jumping
  // to a corner.
  e.dataTransfer.setDragImage(clone, e.clientX - rect.left, e.clientY - rect.top);
  requestAnimationFrame(() => clone.remove());
}

export function CardTile({
  card,
  onClick,
  dependency,
  phase,
  parent,
  repo,
  drag,
  selected,
  lot,
  awaiting,
  facts,
  agent,
}: {
  card: CardView;
  onClick: () => void;
  /** The card's declared predecessor: « attend : <title> » while it is not done. */
  dependency?: DependencyInfo;
  /** The phase this card belongs to (ADR 0022); null reads « Hors phase », undefined says nothing (unknown). */
  phase?: { name: string } | null;
  /** The dictation this was split out of: its container takes no tile, so the sub-task names it (ADR 0022). */
  parent?: string;
  /** The repo, named — only in the all-repos view with more than one in play. */
  repo?: string;
  /** Its launched lot, while it runs: the lot's step stands in for « à relire ». */
  lot?: LotHold | null;
  /** The orchestrator's open question about this card. */
  awaiting?: Awaiting;
  /** What the journal knows of it (its PR above all). */
  facts?: CardFacts;
  /** The herd's view of its pane, for the agent's state and age. */
  agent?: AgentView;
  /**
   * Makes the tile a drag source. Absent = not draggable, which is what a phone always gets: HTML5
   * drag needs a long-press on touch, a gesture this app spends elsewhere.
   */
  drag?: { onStart: () => void; onEnd: () => void };
  /** Selection mode (a run's set, ADR 0017): true/false makes the tile a toggle; absent = a link. */
  selected?: boolean;
}) {
  const t = useT();
  const state = tileState(card, { facts, dependency, lot, awaiting });
  const where = [repo, phase === null ? t("tile.offPhase") : phase?.name, parent].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      draggable={drag ? true : undefined}
      onDragStart={
        drag &&
        ((e) => {
          // Firefox starts no drag at all without payload on the transfer.
          e.dataTransfer.setData("text/plain", card.id);
          e.dataTransfer.effectAllowed = "move";
          flyingCard(e.currentTarget, e);
          drag.onStart();
        })
      }
      onDragEnd={drag && (() => drag.onEnd())}
      className={cn(
        "w-full text-left transition-transform active:scale-[0.99]",
        drag && "cursor-grab active:cursor-grabbing",
        selected && "rounded-2xl ring-2 ring-brand ring-offset-2 ring-offset-background",
      )}
    >
      <Card
        className={cn(
          "gap-1.5 rounded-2xl border p-3.5 shadow-sm transition-colors hover:bg-muted/40 lg:p-3",
          !state.agent && state.tone === "bad" ? "border-status-blocked/45 bg-status-blocked/8" : "border-border",
        )}
      >
        <div
          className={cn(
            "text-base font-semibold leading-[1.3] tracking-[-0.01em] text-wrap-pretty lg:text-[15px]",
            card.status === "done" ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {card.title}
        </div>
        {where && <div className="truncate text-[13px] text-muted-foreground">{where}</div>}
        <div className="flex min-w-0 text-[13px]">
          {state.agent ? (
            <AgentState card={card} agent={agent} />
          ) : (
            <span className={cn("truncate", TONE[state.tone])}>{state.text}</span>
          )}
        </div>
      </Card>
    </button>
  );
}
