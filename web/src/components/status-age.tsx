import { useT } from "@/i18n";
import { ago } from "@/lib/agents-page";
import { AGE_TONE_CLASS, ageTone } from "@/lib/status-age";
import { cn } from "@/lib/utils";
import type { Signal } from "./status-signal";

/** « depuis 3 h », « depuis plus de 3 h » for a lower bound — grey, or solid once a wait runs long. */
export function StatusAge({ since, atLeast = false, signal, className }: { since: number | null | undefined; atLeast?: boolean; signal: Signal; className?: string }) {
  const t = useT();
  if (since == null) return null;
  const now = Date.now();
  const duration = ago(now - since, { min: t("agents.unit.min"), h: t("agents.unit.h"), d: t("agents.unit.d") });
  const tone = ageTone(signal, since, now);
  return (
    <span className={cn("shrink-0 whitespace-nowrap text-xs tabular-nums", tone ? AGE_TONE_CLASS[tone] : "text-muted-foreground", className)}>
      {t(atLeast ? "age.sinceOver" : "age.since", { duration })}
    </span>
  );
}
