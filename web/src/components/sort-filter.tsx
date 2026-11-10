import { useT } from "@/i18n";
import { Chip } from "@/components/ui/chip";
import { SectionLabel } from "@/components/ui/section-label";
import type { CardSort } from "@/lib/board";

/**
 * « Tout » / « Code » / « Business » — the same strip as {@link AssigneeFilter}, one axis over.
 * Drawn only when a business card is in scope, or when it is on: a filter that is on and not drawn
 * is a board that has silently lost cards.
 */
export function SortFilter({ has, active, onPick }: { has: boolean; active: CardSort | null; onPick: (sort: CardSort | null) => void }) {
  const t = useT();
  if (!has && !active) return null;
  return (
    <div className="flex snap-x scroll-px-3 items-center gap-2 overflow-x-auto px-3 py-2 [scrollbar-width:none] lg:flex-wrap lg:overflow-visible [&::-webkit-scrollbar]:hidden [&>*]:snap-start">
      <SectionLabel>{t("filter.sort")}</SectionLabel>
      <Chip label={t("filter.all")} active={!active} onClick={() => onPick(null)} />
      <Chip label={t("filter.code")} active={active === "code"} onClick={() => onPick("code")} />
      <Chip label={t("filter.business")} active={active === "business"} onClick={() => onPick("business")} />
    </div>
  );
}
