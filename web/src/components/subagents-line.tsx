import { Workflow } from "lucide-react";

import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

/** "2 subagents running · Relecture · Inventaire" — one truncated line, the full list on hover.
 *  Renders nothing when the bridge reports none (bridge `subagents.ts`: Claude panes only). */
export function SubagentsLine({ subagents, className }: { subagents?: string[]; className?: string }) {
  const t = useT();
  if (!subagents?.length) return null;
  const names = subagents.filter(Boolean);
  return (
    <div
      className={cn("flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground", className)}
      title={names.join("\n")}
    >
      <Workflow className="size-3 shrink-0" />
      <span className="truncate">
        <span className="text-foreground/80">{t("pane.subagents", { count: subagents.length })}</span>
        {names.length > 0 && ` · ${names.join(" · ")}`}
      </span>
    </div>
  );
}
