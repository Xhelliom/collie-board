import { cn } from "@/lib/utils";
import { Chip } from "@/components/ui/chip";
import { SectionLabel } from "@/components/ui/section-label";
import { TagChip } from "@/components/tag-chip";

/**
 * The board's phase filter (ADR 0022): a repo's phases as the coloured chips the tiles carry, with
 * their progress. The board stays the status axis — this only narrows it to one phase's cards.
 * Renders nothing when the repo has no phase (phases are per repo, so none outside a repo scope).
 */
export function PhaseFilter({
  phases,
  active,
  onPick,
}: {
  phases: { id: string; name: string; done: number; total: number }[];
  active: string | null;
  onPick: (id: string | null) => void;
}) {
  if (phases.length === 0) return null;
  return (
    <div className="flex snap-x scroll-px-3 items-center gap-2 overflow-x-auto px-3 py-2 [scrollbar-width:none] lg:flex-wrap lg:overflow-visible [&::-webkit-scrollbar]:hidden [&>*]:snap-start">
      <SectionLabel>Phases</SectionLabel>
      <Chip label="All" active={active === null} onClick={() => onPick(null)} />
      {phases.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onPick(active === p.id ? null : p.id)}
          aria-pressed={active === p.id}
          className="shrink-0 rounded-full transition-transform active:scale-95"
        >
          <TagChip
            tag={p.name}
            label={`${p.name} · ${p.done}/${p.total}`}
            className={cn(
              "px-3 py-1.5 text-sm",
              active === p.id && "ring-1 ring-current",
              active !== null && active !== p.id && "opacity-40",
            )}
          />
        </button>
      ))}
    </div>
  );
}
