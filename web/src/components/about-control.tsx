import { formatTokens } from "@/components/card-cost";
import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, RotateCw, X } from "lucide-react";

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

// The update's steps, in order (bridge/update-progress.ts); the version row carries the current one.
const STEPS = ["fetch", "build", "restart"] as const;
const UPDATE_KEYS = new Set(["updating", "failed", "failedNoReason"]);
const POLL_MS = 2_000;

const fetchAbout = () => apiRequest<{ rows: AboutRow[] }>("/api/about");

const DOT: Record<AboutState, string> = {
  ok: "bg-status-done",
  todo: "bg-status-blocked",
  down: "bg-destructive",
  off: "bg-status-idle/60",
};
const TINT: Record<AboutState, string> = {
  ok: "",
  todo: "bg-status-blocked/5",
  down: "bg-destructive/5",
  off: "",
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
  // While an update runs, follow it. A miss is the restart dropping the request: keep the last rows.
  const updating = rows?.some((r) => r.id === "version" && r.key === "updating");
  useEffect(() => {
    if (!updating) return;
    const id = setInterval(() => fetchAbout().then((r) => setRows(r.rows), () => {}), POLL_MS);
    return () => clearInterval(id);
  }, [updating]);

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
            const fix = (r.state === "todo" || r.state === "down") && r.key !== "updating" && (`about.${r.id}.${r.key}.fix` as MessageKey);
            return (
              <li key={r.id} className={cn("flex gap-3 px-4 py-3", TINT[r.state])}>
                <span aria-hidden className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", DOT[r.state])} />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{t(`about.${r.id}` as MessageKey)}</span>
                    <span className={cn("shrink-0 text-xs", r.state === "ok" || r.state === "off" ? "text-muted-foreground" : r.state === "todo" ? "text-status-blocked" : "text-destructive")}>
                      {r.key === "updating" ? t("about.state.updating") : t(`about.state.${r.state}`)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground break-words">
                    <Rich id={`about.${r.id}.${r.key}` as MessageKey} params={r.id === "cost" ? { n: formatTokens(Number(r.vars?.n)) } : stepParams(r, t)} />
                  </p>
                  {r.id === "version" && UPDATE_KEYS.has(r.key) && <UpdateSteps current={String(r.vars?.step)} failed={r.state === "down"} />}
                  {r.key === "failed" && r.vars?.reason && (
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">{r.vars.reason}</pre>
                  )}
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

/** The version row's step code, said in words. */
function stepParams(r: AboutRow, t: ReturnType<typeof useT>): AboutRow["vars"] {
  return r.vars?.step ? { ...r.vars, step: t(`about.step.${r.vars.step}` as MessageKey) } : r.vars;
}

// Fetch → build → restart: what is behind, where it is, and — when it stopped — where.
function UpdateSteps({ current, failed }: { current: string; failed: boolean }) {
  const t = useT();
  const at = STEPS.indexOf(current as (typeof STEPS)[number]);
  return (
    <ol aria-label={t("about.steps")} className="flex flex-wrap items-center gap-1.5 text-xs">
      {STEPS.map((step, i) => {
        const now = i === at;
        return (
          <li key={step} aria-current={now ? "step" : undefined}>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
                i < at && "border-transparent text-muted-foreground",
                now && !failed && "border-status-blocked/50 text-foreground",
                now && failed && "border-destructive/60 text-destructive",
                i > at && "border-dashed border-border text-muted-foreground/70",
              )}
            >
              {i < at ? (
                <Check className="size-3 text-status-done" />
              ) : now ? (
                failed ? <X className="size-3" /> : <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
              ) : null}
              {t(`about.step.${step}` as MessageKey)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
