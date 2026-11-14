import { formatTokens } from "@/components/card-cost";
import { useCallback, useEffect, useState } from "react";
import { Loader2, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useT, type MessageKey } from "@/i18n";
import { Rich } from "@/i18n/rich";
import { apiRequest } from "@/lib/api";
import { cn } from "@/lib/utils";

// Settings → About (bridge/about.ts): one line per moving part, a coloured state, and — when it is
// not green — what to do. The bridge sends codes; every sentence is ours to translate.
type AboutState = "ok" | "todo" | "down" | "off";
interface AboutRow {
  id: string;
  state: AboutState;
  key: string;
  vars?: Record<string, string | number>;
}

const fetchAbout = () => apiRequest<{ rows: AboutRow[] }>("/api/about");

const DOT: Record<AboutState, string> = {
  ok: "bg-status-done",
  todo: "bg-status-blocked",
  down: "bg-destructive",
  off: "bg-status-idle/60",
};
const EDGE: Record<AboutState, string> = {
  ok: "border-l-transparent",
  todo: "border-l-status-blocked",
  down: "border-l-destructive",
  off: "border-l-transparent",
};

export function AboutControl() {
  const t = useT();
  const [rows, setRows] = useState<AboutRow[] | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    setError(false);
    fetchAbout()
      .then((r) => setRows(r.rows))
      .catch(() => setError(true));
  }, []);
  useEffect(load, [load]);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex items-start justify-between gap-3 p-4">
        <p className="text-sm text-muted-foreground">{t("about.hint")}</p>
        <Button variant="ghost" size="icon" onClick={load} aria-label={t("about.retry")} title={t("about.retry")}>
          <RotateCw className="size-4" />
        </Button>
      </div>
      {error ? (
        <p className="border-t border-border/60 px-4 py-3 text-sm text-destructive">{t("about.error")}</p>
      ) : !rows ? (
        <div className="flex justify-center border-t border-border/60 p-4">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <ul className="divide-y divide-border/60 border-t border-border/60">
          {rows.map((r) => {
            const fix = (r.state === "todo" || r.state === "down") && (`about.${r.id}.${r.key}.fix` as MessageKey);
            return (
              <li key={r.id} className={cn("flex gap-3 border-l-[3px] px-4 py-3", EDGE[r.state])}>
                <span aria-hidden className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", DOT[r.state])} />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{t(`about.${r.id}` as MessageKey)}</span>
                    <span className={cn("shrink-0 text-xs", r.state === "ok" || r.state === "off" ? "text-muted-foreground" : r.state === "todo" ? "text-status-blocked" : "text-destructive")}>
                      {t(`about.state.${r.state}`)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground break-words">
                    <Rich id={`about.${r.id}.${r.key}` as MessageKey} params={r.id === "cost" ? { n: formatTokens(Number(r.vars?.n)) } : r.vars} />
                  </p>
                  {fix && (
                    <p className="text-sm break-words">
                      <Rich id={fix} params={r.vars} />
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
