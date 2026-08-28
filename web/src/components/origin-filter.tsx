import { Chip } from "@/components/ui/chip";
import { SectionLabel } from "@/components/ui/section-label";

/**
 * The board's third filter: cards that got filed without anyone asking, or everything.
 *
 * The same strip as {@link RepoFilter}, and deliberately NOT a row in the tag filter. Provenance is
 * a different axis from what-kind-of-work (ADR 0005 — a card carries one tag, and it isn't this),
 * so it gets its own row and its own `?origin=` — the two compose, exactly like repo × tag.
 *
 * Two chips, not a switch: "All" is the same escape every strip on this app leads with, and a lone
 * toggle in a sheet of strips would be the one control that doesn't say what its off state means.
 *
 * ONE "Auto" chip for both writers — the copilot and a working session (ADR 0010) — because the
 * question this strip asks is "what appeared while I was elsewhere?", and that has one answer. The
 * tile's own badge is where the two are told apart, on the card that raises the question.
 *
 * Renders nothing when no card on the board is automatic — which is every board with the follow-up
 * switch off and no agent filing anything, i.e. the default. Except when the filter is already on:
 * a board narrowed by a strip that isn't drawn is a board that has silently lost cards.
 */
export function OriginFilter({
  has,
  active,
  onPick,
}: {
  /** Whether any card in scope has an origin. Derived from the cards on screen — no request. */
  has: boolean;
  active: boolean;
  onPick: (auto: boolean) => void;
}) {
  if (!has && !active) return null;
  return (
    <div className="flex snap-x scroll-px-3 items-center gap-2 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:snap-start">
      <SectionLabel>Source</SectionLabel>
      <Chip label="All" active={!active} onClick={() => onPick(false)} />
      <Chip label="Auto" active={active} onClick={() => onPick(!active)} />
    </div>
  );
}
