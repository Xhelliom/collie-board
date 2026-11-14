import { useEffect, useState } from "react";

import { useT } from "@/i18n";
import { fetchCardCost, type CardCost } from "@/lib/board";

/** 1 234 → "1,2 k", 1 200 000 → "1,2 M" (locale decimal); under a thousand, the bare number. Pure. */
export function formatTokens(n: number, locale = navigator.language): string {
  const f = (v: number) => v.toLocaleString(locale, { maximumFractionDigits: 1 });
  return n >= 1e6 ? `${f(n / 1e6)} M` : n >= 1e3 ? `${f(n / 1e3)} k` : f(n);
}

/**
 * « Consommé : 1,2 M tokens · Opus » on the card's fiche, the per-model, per-type detail at the tap.
 * `known:false` reads « inconnu » — an unverified agent is never shown as 0.
 */
export function CardCostLine({ cardId }: { cardId: string }) {
  const t = useT();
  const [cost, setCost] = useState<CardCost | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    fetchCardCost(cardId, ctl.signal).then(setCost, () => {});
    return () => ctl.abort();
  }, [cardId]);
  if (!cost) return null;
  const total = cost.tokens.input + cost.tokens.output + cost.tokens.cacheWrite + cost.tokens.cacheRead;
  const kinds = ["input", "output", "cacheWrite", "cacheRead"] as const;
  return (
    <details className="text-[13px]" data-testid="card-cost">
      <summary className="cursor-pointer select-none">
        <span className="font-semibold">{t("cost.label")} : </span>
        {cost.known ? (
          <>
            {t("cost.tokens", { n: formatTokens(total) })}
            {cost.partial && ` · ${t("cost.partial", { counted: cost.counted, sessions: cost.sessions })}`}
            {cost.byModel.length > 0 && ` · ${cost.byModel.map((m) => m.label).join(", ")}`}
          </>
        ) : (
          <span className="text-muted-foreground">{t("cost.unknown")}</span>
        )}
      </summary>
      {cost.known && (
        <div className="mt-1.5 flex flex-col gap-1.5 text-xs text-muted-foreground">
          {cost.byModel.map((m) => (
            <div key={m.model}>
              <div className="font-semibold text-foreground">{m.label}</div>
              <div className="grid grid-cols-[1fr_auto] gap-x-4">
                {kinds.map((k) => (
                  <div key={k} className="contents">
                    <span>{t(`cost.${k}`)}</span>
                    <span className="text-right tabular-nums">{m.tokens[k].toLocaleString(navigator.language)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </details>
  );
}
