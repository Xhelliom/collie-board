import { useEffect, useState } from "react";
import { useRevalidator, useRouteLoaderData } from "react-router";
import { ArrowRightLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { usePendingConfirm } from "@/hooks/use-pending-confirm";
import { useT } from "@/i18n";
import { isHcPaneId, projectOf } from "@/lib/agent-groups";
import { migrateHcAvailability, migratePaneToHc, repoName } from "@/lib/board";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";

/**
 * « Migrer vers herdr-core » — offered only when the bridge says so (a Claude agent at rest under 0.9,
 * hc reachable: bridge/migrate-hc.ts), for any pane: a card's, an orchestrator's, one opened by hand.
 * Two taps: it closes the agent's terminal.
 */
export function MigrateHcButton({
  paneId,
  watch,
  onDone,
}: {
  paneId: string | null;
  /** Whatever says the agent may have come to rest (a card's column, a pane's status): the bridge is re-asked when it moves. */
  watch?: unknown;
  /** `newPaneId` is where the agent runs now, on success. */
  onDone: (message: string, ok: boolean, newPaneId?: string) => void;
}) {
  const t = useT();
  const { confirm, pending } = usePendingConfirm();
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // An hc pane needs no asking.
    if (!paneId || isHcPaneId(paneId)) return setAvailable(false);
    const ctl = new AbortController();
    migrateHcAvailability(paneId, ctl.signal).then(
      (r) => setAvailable(r.available),
      () => setAvailable(false),
    );
    return () => ctl.abort();
  }, [paneId, watch]);

  if (!available || !paneId) return null;
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        className="h-11 w-full gap-2"
        disabled={busy}
        onClick={async () => {
          if (!confirm(paneId)) return;
          setBusy(true);
          try {
            const r = await migratePaneToHc(paneId);
            onDone(t("card.toast.migrateHc"), true, r.paneId);
          } catch (e) {
            onDone((e as Error).message, false);
          } finally {
            setBusy(false);
            setAvailable(false);
          }
        }}
      >
        <ArrowRightLeft className="size-4" />
        {busy ? t("card.migrateHc.running") : pending === paneId ? t("card.migrateHc.confirm") : t("card.migrateHc.do")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("card.migrateHc.hint")}</p>
    </div>
  );
}

/**
 * « Tout migrer » on a Project page: this repo's Claude agents still under herdr 0.9, one at a time.
 * The bridge decides each (at rest, conversation known…); what it refused is listed with its reason.
 */
export function MigrateAllHc({ repo }: { repo: string }) {
  const t = useT();
  const root = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData | undefined;
  const revalidator = useRevalidator();
  const { confirm, pending } = usePendingConfirm();
  const [done, setDone] = useState<number | null>(null);
  const [bilan, setBilan] = useState<{ ok: number; refused: Array<{ name: string; why: string }> } | null>(null);

  const todo = (root?.agents ?? []).filter((a) => a.agent === "claude" && !isHcPaneId(a.paneId) && !a.paneId.includes("@") && projectOf(a.cwd) === repoName(repo));
  if (todo.length === 0 && !bilan) return null;
  const count = todo.length;

  const run = async () => {
    if (!confirm(repo)) return;
    const out = { ok: 0, refused: [] as Array<{ name: string; why: string }> };
    // One at a time: each closes a terminal and waits for its agent to come back.
    for (const [i, a] of todo.entries()) {
      setDone(i);
      try {
        await migratePaneToHc(a.paneId);
        out.ok++;
      } catch (e) {
        out.refused.push({ name: a.paneLabel ?? a.workspaceLabel, why: (e as Error).message });
      }
    }
    setDone(null);
    setBilan(out);
    void revalidator.revalidate();
  };

  return (
    <div className="flex flex-col items-end gap-1">
      {count > 0 && (
        <Button variant="outline" size="sm" disabled={done !== null} onClick={() => void run()}>
          <ArrowRightLeft className="size-4" />
          {done !== null
            ? t("project.migrateAll.running", { done: done + 1, count })
            : t(pending === repo ? "project.migrateAll.confirm" : "project.migrateAll.do", { count })}
        </Button>
      )}
      {bilan && (
        <div role="status" className="text-right text-xs text-muted-foreground">
          <p>{t("project.migrateAll.done", { ok: bilan.ok })}</p>
          {bilan.refused.length > 0 && (
            <>
              <p>{t("project.migrateAll.refused")}</p>
              <ul>
                {bilan.refused.map((r, i) => (
                  <li key={i}>
                    {r.name} — {r.why}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
