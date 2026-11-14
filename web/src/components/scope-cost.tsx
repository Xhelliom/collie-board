import { useEffect, useState } from "react";

import { formatTokens } from "@/components/card-cost";
import { useT } from "@/i18n";
import { fetchScopeCost, type ScopeCostData } from "@/lib/board";
import { cn } from "@/lib/utils";

const sum = (t: { input: number; output: number; cacheWrite: number; cacheRead: number }) => t.input + t.output + t.cacheWrite + t.cacheRead;

/**
 * « 1,2 M tokens » for a lot, a phase or a whole project, the detail (per model, the orchestrator's
 * share, the period) at the tap. A card with no figure (a non-Claude agent) is said — « + 2 cartes
 * inconnues » — never added as 0; with nothing known at all the figure reads « inconnu ».
 */
export function ScopeCost({ repo, runId, phaseId, className }: { repo: string; runId?: string; phaseId?: string; className?: string }) {
  const t = useT();
  const [period, setPeriod] = useState<"week" | "all">("all");
  const [data, setData] = useState<ScopeCostData | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    fetchScopeCost({ repo, period, ...(runId && { runId }), ...(phaseId && { phaseId }) }, ctl.signal).then(setData, () => {});
    return () => ctl.abort();
  }, [repo, runId, phaseId, period]);
  if (!data || data.cards === 0) return null; // nothing ever started here: nothing to say
  return (
    <details className={cn("text-xs text-muted-foreground", className)} data-testid="scope-cost">
      <summary className="inline-flex min-h-6 cursor-pointer select-none items-center gap-1.5">
        {data.known && data.tokens ? <span className="tabular-nums">{t("cost.tokens", { n: formatTokens(sum(data.tokens)) })}</span> : <span>{t("cost.unknown")}</span>}
        {data.unknownCards > 0 && data.known && <span>· {t("cost.unknownCards", { count: data.unknownCards })}</span>}
      </summary>
      <div className="mt-1.5 flex flex-col gap-1.5">
        <div role="group" className="flex gap-1">
          {(["week", "all"] as const).map((p) => (
            <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)} className={cn("rounded-sm px-2 py-1", period === p ? "bg-muted font-semibold text-foreground" : "hover:bg-muted/50")}>
              {t(`cost.${p}`)}
            </button>
          ))}
        </div>
        {!data.known && data.unknownCards > 0 && <span>{t("cost.unknownCards", { count: data.unknownCards })}</span>}
        {data.byModel.map((m) => (
          <span key={m.model} className="tabular-nums">
            <b className="font-semibold text-foreground">{m.label}</b> · {formatTokens(sum(m.tokens))}
          </span>
        ))}
        {data.orchestrator?.known && <span className="tabular-nums">{t("cost.orchestrator")} · {formatTokens(sum(data.orchestrator.tokens))}</span>}
      </div>
    </details>
  );
}
