import {
  Bot,
  Check,
  CornerDownRight,
  CornerLeftUp,
  GitBranch,
  Layers,
  ListChecks,
  Sparkles,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { AgentIcon } from "@/components/agent-icon";
import { TagChip } from "@/components/tag-chip";
import { CtxBar } from "@/components/ctx-bar";
import { paneDisplayName } from "@/lib/types";
import { CARD_STATUS_LABEL, type CardStatus, type CardView } from "@/lib/board";
import type { DependencyInfo } from "@/lib/board-groups";

// One card in a board column. Deliberately the same visual language as AgentCard (the pane row):
// the board is a second lens on the same herd, not a different app.
//
// Three rows, in priority order — status, then title, then repo/meta (redesign §2 "the core of the
// redesign"): a card in a live column tells you AT A GLANCE whether it needs you (loud: a solid
// chip, the whole card tinted), is merely running (named: a dot + a coloured label), or is settled
// (silent: no status chip at all — the column already says it, so the row instead names the repo).
// Ready/Backlog/Done cards end up near-blank; a blocked card is unmistakable. That contrast, not
// just the hue, is what makes the board scannable from across the room.
//
// The tile is a CONTAINER (`@container`), not a viewport reader. The same tile renders full-width on
// a phone, ~320px wide in a lane of the wide-screen board, and narrower still nested inside a
// CardGroup there — three different widths at ONE viewport size, which no `lg:` could tell apart.

/** Loud: a solid status chip, and the whole card tinted/bordered in the same tone. */
const LOUD_STATUS: Partial<Record<CardStatus, { chip: string; card: string }>> = {
  blocked: { chip: "bg-status-blocked", card: "border-status-blocked/45 bg-status-blocked/8" },
  orphaned: { chip: "bg-status-unknown", card: "border-status-unknown/45 bg-status-unknown/8" },
};

/** Named: a dot + the label in the tone, no fill — the card's own border stays plain. */
const NAMED_STATUS: Partial<Record<CardStatus, { dot: string; text: string }>> = {
  working: { dot: "bg-status-working", text: "text-status-working" },
  starting: { dot: "bg-status-working", text: "text-status-working" },
  review: { dot: "bg-status-done", text: "text-status-done" },
};

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
  source,
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
   * The card this one came out of — the reviewed card a follow-up was filed against, or the card
   * whose session filed it (ADR 0010). Either way its title is written as a note to that card
   * ("test the feature"), so on its own it is an orphan sentence; this is the half that makes it
   * readable. Absent for the overwhelming majority of cards, and then no caption renders at all.
   *
   * Text, not a link, for the same reason `parent` is: this tile is a `<button>`.
   */
  source?: string;
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
  const loud = LOUD_STATUS[card.status];
  const named = !loud ? NAMED_STATUS[card.status] : undefined;
  // Whether row 1 has a real status/repo signal to show. Without one, a lone tag chip floating
  // `ml-auto` in an otherwise-empty row reads as a blank gap — so with nothing else on it, the tag
  // rides the title row instead (row 2) rather than getting a row of its own.
  // `copilotBusy` counts: a card the copilot is writing is typically a bare title with no pane, no
  // branch and no criteria yet — i.e. exactly the card whose meta row does NOT render, which is
  // where this used to live and therefore never showed.
  // `origin` counts for the same reason as `copilotBusy`: an automatic card is a fresh backlog card
  // with no pane, no branch and no repo shown, i.e. exactly the tile whose row 1 doesn't render.
  const statusRow = Boolean(loud || named || repo || card.copilotBusy || card.origin);
  // Only when the pane has a name distinct from its bare agent slug — an icon already says "claude";
  // a real label or /rename name is the part worth repeating (UI_AUDIT.md G2: card title AND pane name).
  const paneName =
    card.runtime && (card.runtime.paneLabel || card.runtime.sessionName)
      ? paneDisplayName(card.runtime)
      : null;
  const ctxPct = card.session?.ctxPct;
  const hasMeta = Boolean(
    card.runtime || card.branch || ctxPct != null || card.sessionCount > 1 || card.acceptance.length > 0,
  );
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
          "gap-2 rounded-2xl border p-3.5 shadow-sm transition-colors hover:bg-muted/40 lg:p-3",
          loud ? loud.card : "border-border",
        )}
      >
        {/* 1. Status row — loud (a solid chip + the card's own tint), named (a dot + a coloured
            label), or silent (the repo name takes its place). The tag rides `ml-auto` here when the
            row exists; with nothing else to show, it moves to the title row instead (below). */}
        {statusRow && (
          <div className="flex items-center gap-2">
            {loud ? (
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-[3px] text-[length:var(--label-size)] font-bold uppercase tracking-[var(--label-tracking)] text-status-chip-foreground",
                  loud.chip,
                )}
              >
                {CARD_STATUS_LABEL[card.status]}
              </span>
            ) : named ? (
              <span
                className={cn(
                  "flex shrink-0 items-center gap-1.5 text-[length:var(--label-size)] font-bold uppercase tracking-[var(--label-tracking)]",
                  named.text,
                )}
              >
                <span className={cn("size-1.5 rounded-full", named.dot)} />
                {CARD_STATUS_LABEL[card.status]}
              </span>
            ) : null}
            {/* The repo, always — next to the status chip on a live card, alone in the row on a
                quiet one. A "To review" column that says four cards are waiting but not WHICH repo
                they came out of makes you open each one to find out; the chip and the repo answer
                different questions, so they share the row instead of taking turns. */}
            {repo && (
              <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                {repo}
              </span>
            )}
            {/* Same fact the open card states in full ("the copilot has this card"), same field —
                here it only has to answer "why is this one still a bare title" from across the
                board. Pulsing, because it ends on its own. */}
            {card.copilotBusy && (
              <span className="flex shrink-0 animate-pulse items-center gap-1 text-[length:var(--label-size)] font-bold uppercase tracking-[var(--label-tracking)] text-muted-foreground">
                <Sparkles className="size-3" />
                copilot
              </span>
            )}
            {/* "This card wrote itself" — the review filed it while you were elsewhere, and nothing
                else on the tile would say so. Suppressed while `copilotBusy` is up: two identical
                sparkles side by side, one of them pulsing, reads as one glitching badge. */}
            {card.origin === "copilot" && !card.copilotBusy && (
              <span className="flex shrink-0 items-center gap-1 text-[length:var(--label-size)] font-bold uppercase tracking-[var(--label-tracking)] text-muted-foreground">
                <Sparkles className="size-3" />
                auto
              </span>
            )}
            {/* Same sentence, the OTHER writer: a working session decided mid-turn there was
                something to record (ADR 0010). Its own badge rather than a second "auto", because
                the two lead somewhere different — the copilot's card came out of a review you can
                read, this one out of a session that is probably still running. Not suppressed by
                `copilotBusy`: a different icon beside the pulsing sparkle reads as two badges,
                which is what it is, and hiding it would credit the card to the copilot. */}
            {card.origin === "agent" && (
              <span className="flex shrink-0 items-center gap-1 text-[length:var(--label-size)] font-bold uppercase tracking-[var(--label-tracking)] text-muted-foreground">
                <Bot className="size-3" />
                agent
              </span>
            )}
            {card.tag && (
              <TagChip tag={card.tag} className="ml-auto shrink-0 px-[7px] py-px text-[10px] font-semibold" />
            )}
          </div>
        )}

        {/* 2. Title. Two lines allowed — no truncation, no clamp. A done card's title recedes with
            it: the work is over, so the title stops competing for attention. */}
        <div className="flex items-start gap-2">
          <div
            className={cn(
              "min-w-0 flex-1 text-base font-semibold leading-[1.3] tracking-[-0.01em] text-wrap-pretty lg:text-[15px]",
              card.status === "done" ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {card.title}
            {paneName && (
              <span className="ml-1 text-xs font-normal text-muted-foreground">· {paneName}</span>
            )}
          </div>
          {!statusRow && card.tag && (
            <TagChip tag={card.tag} className="mt-0.5 shrink-0 px-[7px] py-px text-[10px] font-semibold" />
          )}
        </div>

        {parent && (
          <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <Layers className="size-3 shrink-0" />
            <span className="truncate">{parent}</span>
          </div>
        )}
        {/* Where this one came from — the caption that turns "test the feature" back into a
            sentence. Same shape as the parent caption above it, a different arrow: `Layers` means
            "part of", this means "came out of". */}
        {source && (
          <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <CornerLeftUp className="size-3 shrink-0" />
            <span className="truncate">from “{source}”</span>
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

        {/* 3. Meta row — rendered only when there is something to say. cwd and the chevron are
            dropped on purpose: the branch already says where, and in a grid of clickable tiles
            "this opens" is not information. */}
        {hasMeta && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {card.runtime && <AgentIcon agent={card.runtime.agent} className="size-4 shrink-0" />}
            {card.branch && (
              <span className="flex min-w-0 items-center gap-1 truncate font-mono">
                <GitBranch className="size-3 shrink-0" />
                {card.branch}
              </span>
            )}
            {/* A quick "how much is riding on this" stat — the count only, not the criteria
                themselves; opening the card is what "the details" is for. */}
            {card.acceptance.length > 0 && (
              <span className="flex shrink-0 items-center gap-1">
                <ListChecks className="size-3 shrink-0" />
                {card.acceptance.length}
              </span>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {ctxPct != null && (
                <>
                  <CtxBar pct={ctxPct} />
                  <span className="tabular-nums">{Math.round(ctxPct)}%</span>
                </>
              )}
              {card.sessionCount > 1 && <span>· {card.sessionCount} sessions</span>}
            </span>
          </div>
        )}
      </Card>
    </button>
  );
}
