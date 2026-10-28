import { useT } from "@/i18n";
import { Chip } from "@/components/ui/chip";
import { SectionLabel } from "@/components/ui/section-label";

/**
 * « À moi » / « Tout le monde » (ADR 0048 §5) — the same strip as {@link OriginFilter}, one axis over.
 * Drawn only when a shared repo is in scope, or when it is on: a filter that is on and not drawn is a
 * board that has silently lost cards.
 */
export function AssigneeFilter({ has, active, onPick }: { has: boolean; active: boolean; onPick: (mine: boolean) => void }) {
  const t = useT();
  if (!has && !active) return null;
  return (
    <div className="flex snap-x scroll-px-3 items-center gap-2 overflow-x-auto px-3 py-2 [scrollbar-width:none] lg:flex-wrap lg:overflow-visible [&::-webkit-scrollbar]:hidden [&>*]:snap-start">
      <SectionLabel>{t("people.filter")}</SectionLabel>
      <Chip label={t("people.everyone")} active={!active} onClick={() => onPick(false)} />
      <Chip label={t("people.toMe")} active={active} onClick={() => onPick(!active)} />
    </div>
  );
}
