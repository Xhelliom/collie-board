import { useEffect, useState } from "react";
import { ListFilter, Undo2 } from "lucide-react";

import { MENU_ITEM, MoreActions } from "@/components/project-more";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { useT } from "@/i18n";
import { boardErrorMessage } from "@/lib/board";
import { ago } from "@/lib/project-facts";
import { applyTriage, fetchTriage, type Triage } from "@/lib/recette";
import { setStatus } from "@/lib/status";

// The Recette's « ⋯ »: a triage an exploration card proposed (bridge/recette-triage.ts), applied or
// undone by the operator after reading what it does. Absent when no triage was proposed for the repo.

export function TriageMenu({ repo, onChange }: { repo: string; onChange: () => Promise<void> }) {
  const t = useT();
  const [triage, setTriage] = useState<Triage | null>(null);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = async (signal?: AbortSignal) => setTriage(await fetchTriage(repo, signal).catch(() => null)); // an older bridge: no menu
  useEffect(() => {
    const ctl = new AbortController();
    void load(ctl.signal);
    return () => ctl.abort();
  }, [repo]); // `load` reads `repo` only
  if (!triage) return null;
  const applied = !!triage.applied;
  const s = triage.summary;

  async function run() {
    setBusy(true);
    try {
      await applyTriage(repo, applied);
      setStatus(t(applied ? "recette.triage.undone" : "recette.triage.done"), "success");
      setSheet(false);
      await Promise.all([load(), onChange()]);
    } catch (err) {
      setStatus(boardErrorMessage(err), "error", null);
    } finally {
      setBusy(false);
    }
  }

  const label = t(applied ? "recette.triage.undo" : "recette.triage.apply");
  const Icon = applied ? Undo2 : ListFilter;
  const figure = (n: number, text: string) =>
    n > 0 && (
      <li className="grid grid-cols-[3rem_minmax(0,1fr)] items-baseline gap-3">
        <span className="text-right text-2xl font-semibold tabular-nums">{n}</span>
        <span className="text-sm">{text}</span>
      </li>
    );

  return (
    <>
      <MoreActions label={t("recette.more")}>
        <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => setSheet(true)}>
          <Icon className="size-4 text-muted-foreground" aria-hidden />
          {label}
        </button>
      </MoreActions>
      <BottomSheet
        open={sheet}
        onClose={() => setSheet(false)}
        title={label}
        footer={
          <Button className="w-full" variant={applied ? "secondary" : "brand"} disabled={busy} onClick={() => void run()}>
            <Icon aria-hidden />
            {label}
          </Button>
        }
      >
        <div className="flex flex-col gap-4 pb-2">
          <p className="text-sm text-muted-foreground">
            {applied
              ? t("recette.triage.applied", { by: triage.applied!.by, ago: ago(triage.applied!.at) })
              : t("recette.triage.proposed", { by: triage.proposedBy, ago: ago(triage.proposedAt) })}
          </p>
          {applied ? (
            <p className="text-sm">{t("recette.triage.undoWhat", { count: triage.applied!.skipped })}</p>
          ) : (
            <>
              <ul className="flex flex-col gap-2.5">
                {figure(s.obsolete, t("recette.triage.obsolete", { count: s.obsolete }))}
                {figure(s.groups, t("recette.triage.groups", { count: s.groups, grouped: s.grouped }))}
                {figure(s.obsoleteSteps, t("recette.triage.obsoleteSteps", { count: s.obsoleteSteps }))}
              </ul>
              <p className="text-sm text-muted-foreground">{t("recette.triage.keep")}</p>
            </>
          )}
        </div>
      </BottomSheet>
    </>
  );
}
