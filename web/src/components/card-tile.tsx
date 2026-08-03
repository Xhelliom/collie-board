import {
  Check,
  ChevronRight,
  CornerDownRight,
  FolderGit2,
  GitBranch,
  Layers,
  Lock,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { AgentIcon } from "@/components/agent-icon";
import { StatusBadge } from "@/components/status-badge";
import { CardStatusChip } from "@/components/card-status-chip";
import { TagChip } from "@/components/tag-chip";
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
//
// The tile is a CONTAINER (`@container`), not a viewport reader. The same tile renders full-width on
// a phone, ~320px wide in a lane of the wide-screen board, and narrower still nested inside a
// CardGroup there — three different widths at ONE viewport size, which no `lg:` could tell apart.
// So what it drops when it gets tight is asked of its own box: `@max-sm` is a container narrower
// than 24rem, which the phone's full-width tile never is.
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
  parent,
  repo,
  drag,
}: {
  card: CardView;
  onClick: () => void;
  /**
   * The card's declared predecessor, if any — shown on the TILE rather than left for the Start
   * button to reject (a 409 toast is a round trip for something the row already knew), and shown
   * even once satisfied so "why does this depend on that" doesn't require opening the editor.
   */
  dependency?: DependencyInfo;
  /**
   * The container this card was split out of, when the board is showing sub-tasks in their own
   * columns rather than folded under their parent. Without it a scattered sub-task is a title with
   * no provenance — and a dictation that produced eight of them reads as eight unrelated cards.
   *
   * Text, not a link: this tile is already a `<button>`, and a button inside a button is invalid
   * HTML whose inner click also fires the outer one. Opening the card gets you a real link to the
   * parent, at the top of its page.
   */
  parent?: string;
  /**
   * The repo this card belongs to, named — only when the board is showing every repo at once and
   * more than one is in play. Under a repo scope the strip above says it once for the whole board,
   * and repeating it on every tile would be a column of the same word.
   */
  repo?: string;
  /**
   * Makes the tile a drag source. Absent = not draggable, which is the default and what a phone
   * always gets: HTML5 drag needs a long-press on touch, and a long-press on a card tile is a
   * gesture this app spends elsewhere.
   *
   * No "am I the one being dragged" flag: the board hides the held tile and renders a ghost of it in
   * the slot it would land in, so the tile itself never needs to look any different.
   */
  drag?: { onStart: () => void; onEnd: () => void };
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
      draggable={drag ? true : undefined}
      onDragStart={
        drag &&
        ((e) => {
          // Firefox starts no drag at all without payload on the transfer; the id is also what makes
          // the drag legible to anything outside this component.
          e.dataTransfer.setData("text/plain", card.id);
          e.dataTransfer.effectAllowed = "move";
          flyingCard(e.currentTarget, e);
          drag.onStart();
        })
      }
      onDragEnd={drag && (() => drag.onEnd())}
      className={cn(
        "@container w-full text-left transition-transform active:scale-[0.99]",
        drag && "cursor-grab active:cursor-grabbing",
      )}
    >
      <Card
        className={cn(
          "flex-row items-center gap-3 rounded-xl px-3.5 py-3 shadow-sm @max-sm:gap-2.5 @max-sm:px-3 @max-xs:flex-wrap",
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
            {/* Before the title, and shrink-0: a tag is what the eye scans a column FOR, so it must
                not be the thing that truncates. Most cards have none and this row is unchanged. */}
            {card.tag && <TagChip tag={card.tag} />}
            <span className="truncate font-medium">{card.title}</span>
            {paneName && <span className="truncate text-xs text-muted-foreground">· {paneName}</span>}
          </div>
          {parent && (
            <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              <Layers className="size-3 shrink-0" />
              <span className="truncate">{parent}</span>
            </div>
          )}
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
            {/* First, and shrink-0: in the global view this is the answer to "whose card is this",
                which is the one thing the strip above is not saying. Its icon doubles as the
                separator from the cwd that may follow it. */}
            {repo && (
              <span className="flex shrink-0 items-center gap-1">
                <FolderGit2 className="size-3 shrink-0" />
                {repo}
              </span>
            )}
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

        {/* Under 20rem of container — a board lane on a 1280px laptop, or a lane's nested CardGroup —
            the badge drops onto its own line under the title instead of eating a third of it. Same
            badge, same information, indented to the title's column so it still reads as belonging to
            it. This is the case that makes the container query worth having: at ONE viewport width
            the phone's full-width tile keeps the badge inline and the lane's tile does not. */}
        <span className="shrink-0 @max-xs:order-last @max-xs:w-full @max-xs:pl-[3rem]">
          {waiting ? (
            <Lock className="size-4 shrink-0 text-status-blocked" />
          ) : card.runtime ? (
            <StatusBadge status={card.runtime.agentStatus} />
          ) : (
            <CardStatusChip status={card.status} />
          )}
        </span>
        {/* The one thing that goes when the box is narrow: 16px of icon plus its gap is 11% of a
            320px lane, and it is the only element here carrying no information — in a lane of
            clickable tiles, "this opens" is not news. The badge beside it IS information, so it
            stays. */}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground @max-sm:hidden" />
      </Card>
    </button>
  );
}
