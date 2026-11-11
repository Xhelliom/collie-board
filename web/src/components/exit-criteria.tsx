import { useEffect, useState } from "react";

import { Fold, useStoredFold } from "@/components/fold";
import { Switch } from "@/components/ui/switch";
import { useLocale, useT } from "@/i18n";
import { boardErrorMessage } from "@/lib/board";
import { fetchExitCriteria, tickExitCriterion, type ExitView } from "@/lib/peers";
import { cn } from "@/lib/utils";

/**
 * The four exit criteria of ADR 0052 §8 (phase 5, leaving herdr 0.9), each held or not. The first two
 * are read by the bridge; the last two are the operator's word, ticked here and kept in the board.
 */
export function ExitCriteria() {
  const t = useT();
  const locale = useLocale();
  const fold = useStoredFold("project-exit");
  const [view, setView] = useState<ExitView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetchExitCriteria(ac.signal).then(setView, () => {});
    return () => ac.abort();
  }, []);
  if (!view) return null;

  const tick = (patch: Parameters<typeof tickExitCriterion>[0]) => {
    setError(null);
    tickExitCriterion(patch).then(setView, (e) => setError(boardErrorMessage(e)));
  };
  const day = (ms: number | null) => (ms === null ? "" : new Date(ms).toLocaleDateString(locale, { dateStyle: "medium" }));
  const p = view.protocol;
  const rows: { id: string; label: string; held: boolean; note?: string; onTick?: (on: boolean) => void }[] = [
    {
      id: "protocol",
      label: t("project.exit.protocol"),
      held: p.held,
      note:
        p.generation === null
          ? t("project.exit.protocol.never")
          : t("project.exit.protocol.since", { generation: p.generation, version: p.version ? `hc ${p.version}` : "hc", since: day(p.since), due: day(p.due) }),
    },
    {
      id: "machines",
      label: t("project.exit.machines", { onHc: view.machines.onHc, total: view.machines.total }),
      held: view.machines.held,
      note: view.machines.list.map((m) => `${m.name} : ${m.engine === "hc" ? "herdr-core" : m.engine === "herdr09" ? "herdr 0.9" : t("peers.engine.unknown")}`).join(" · "),
    },
    { id: "harnesses", label: t("project.exit.harnesses"), held: view.harnesses.held, note: t("project.exit.manual"), onTick: (on) => tick({ harnesses: on }) },
    { id: "herdr09", label: t("project.exit.herdr09"), held: view.herdr09.held, note: t("project.exit.manual"), onTick: (on) => tick({ herdr09Frozen: on }) },
  ];

  return (
    <Fold title={t("project.exit.title", { held: rows.filter((r) => r.held).length })} state={fold}>
      <ol className="flex flex-col divide-y rounded-lg border">
        {rows.map((r, i) => (
          <li key={r.id} data-testid={`exit-${r.id}`} className="flex items-center gap-3 px-3 py-2.5">
            <span className="w-4 shrink-0 text-sm text-muted-foreground tabular-nums">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm">{r.label}</div>
              {r.note && <div className="text-xs text-muted-foreground">{r.note}</div>}
            </div>
            {r.onTick && <Switch checked={r.held} onCheckedChange={r.onTick} aria-label={r.label} />}
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", r.held ? "bg-status-done/15 text-status-done" : "bg-muted text-muted-foreground")}>
              {t(r.held ? "project.exit.held" : "project.exit.notHeld")}
            </span>
          </li>
        ))}
      </ol>
      {error && <p className="text-sm text-status-blocked">{error}</p>}
    </Fold>
  );
}
