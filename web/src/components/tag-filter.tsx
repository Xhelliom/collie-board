import { cn } from "@/lib/utils";
import { Chip } from "@/components/ui/chip";
import { SectionLabel } from "@/components/ui/section-label";
import { TagChip } from "@/components/tag-chip";

/**
 * The board's tag filter: the tags actually in use, as the same coloured chips the tiles carry.
 *
 * It sits ABOVE the board's scroller rather than inside it, and that placement is the acceptance
 * criterion "a filtered board is visibly filtered" — a filter that scrolls away leaves you looking
 * at a short board with no visible reason for it, which reads as a board that lost its cards.
 *
 * Two ways out, both one tap: "All", which is always there and is the obvious one, or tapping the
 * active tag again. No separate ✕ affordance — the leading chip already IS the escape, and it is
 * the pattern the space and tab strips already use on this app's other filter rows.
 *
 * Renders nothing when no tag exists anywhere: a row of one "All" chip filters nothing, and most
 * boards have no tags at all.
 */
export function TagFilter({
  tags,
  active,
  onPick,
}: {
  /** Tags to offer, in `tagsOf` order — most recently touched first. */
  tags: string[];
  active: string | null;
  onPick: (tag: string | null) => void;
}) {
  if (tags.length === 0) return null;
  return (
    <div className="flex snap-x scroll-px-3 items-center gap-2 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:snap-start">
      <SectionLabel>Tags</SectionLabel>
      <Chip label="All" active={active === null} onClick={() => onPick(null)} />
      {tags.map((tag) => (
        <button
          key={tag}
          type="button"
          onClick={() => onPick(active === tag ? null : tag)}
          aria-pressed={active === tag}
          className="shrink-0 rounded-full transition-transform active:scale-95"
        >
          {/* Sized up to the strip's pill rung — the tile's chip is a label read in passing, this
              one is a target a thumb has to hit. Colour and shape stay the tile's, which is what
              makes the row scannable at all. The unpicked tags fade rather than hide: which tags
              exist is still information while one of them is on. */}
          <TagChip
            tag={tag}
            className={cn(
              "px-3 py-1.5 text-sm",
              active === tag && "ring-1 ring-current",
              active !== null && active !== tag && "opacity-40",
            )}
          />
        </button>
      ))}
    </div>
  );
}
