import { useEffect, useState } from "react";

import { useT } from "@/i18n";
import { Switch } from "@/components/ui/switch";
import { boardErrorMessage, fetchAutonomy, saveAutonomy, type Autonomy } from "@/lib/board";
import { setStatus } from "@/lib/status";

// How far the project's orchestrator may go without the operator (ADR 0030). The operator's screen
// alone: the bridge refuses this write from any agent pane. Off by default; the bounds are prudent
// (one lot, stop on red). Data below the header is `data-vaul-no-drag` like the rest of the panel.
export function AutonomySettings({ repo }: { repo: string }) {
  const t = useT();
  const [a, setA] = useState<Autonomy | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setA(null);
    fetchAutonomy(repo, ac.signal)
      .then((r) => setA(r.autonomy))
      .catch(() => {});
    return () => ac.abort();
  }, [repo]);

  if (!a) return null;

  async function save(patch: Partial<Pick<Autonomy, "enabled" | "maxChain" | "stopOnRed">>) {
    try {
      setA((await saveAutonomy(repo, patch)).autonomy);
      setStatus(t("orch.autoSaved"), "success", 2000);
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    }
  }

  return (
    <details data-vaul-no-drag className="rounded-lg border bg-card/40 px-2.5 py-1.5 text-sm">
      <summary className="cursor-pointer select-none text-xs font-semibold text-muted-foreground">
        {t("orch.auto")}
      </summary>
      <div className="mt-2 flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3">
          <span>{t("orch.autoOn")}</span>
          <Switch checked={a.enabled} onCheckedChange={(enabled) => void save({ enabled })} aria-label={t("orch.autoOn")} />
        </div>
        <p className="text-xs text-muted-foreground">{t("orch.autoHint")}</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="auto-chain">{t("orch.autoChain")}</label>
          <span className="flex items-center gap-2">
            <input
              id="auto-chain"
              type="number"
              min={1}
              disabled={a.maxChain === null}
              value={a.maxChain ?? ""}
              onChange={(e) => {
                const n = Math.floor(Number(e.target.value));
                if (n >= 1) void save({ maxChain: n });
              }}
              className="h-8 w-16 rounded-md border border-border bg-background px-2 text-sm disabled:opacity-50"
            />
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={a.maxChain === null} onChange={(e) => void save({ maxChain: e.target.checked ? null : 1 })} />
              {t("orch.autoUnlimited")}
            </label>
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>{t("orch.autoRed")}</span>
          <Switch checked={a.stopOnRed} onCheckedChange={(stopOnRed) => void save({ stopOnRed })} aria-label={t("orch.autoRed")} />
        </div>
      </div>
    </details>
  );
}
