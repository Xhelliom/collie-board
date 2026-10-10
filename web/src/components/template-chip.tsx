import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

// "Which role runs this card?" at a glance. Plain when the card carries it, dashed and dimmer when it
// only inherits it from its phase — the title says so, since a chip is no place for a sentence.
export function TemplateChip({ name, inherited, className }: { name: string; inherited: boolean; className?: string }) {
  const t = useT();
  return (
    <span
      title={inherited ? t("templates.chip.inherited") : undefined}
      className={cn(
        "inline-flex items-center rounded-full border px-[7px] py-px text-[10px] font-semibold",
        inherited ? "border-dashed border-border text-muted-foreground" : "border-brand/35 bg-brand/10 text-brand",
        className,
      )}
    >
      {name}
    </span>
  );
}
