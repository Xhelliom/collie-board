import { useEffect, useState } from "react";
import { Workflow } from "lucide-react";

import { FlowsSheet } from "@/components/flows-sheet";
import { SettingsLoading } from "@/components/settings-loading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useFlows } from "@/hooks/use-flows";
import { useTemplates } from "@/hooks/use-templates";
import { useT } from "@/i18n";
import { boardErrorMessage, fetchRepos, repoName, setRepoFlow, type RepoChoice } from "@/lib/board";
import { flowName } from "@/lib/flows";
import { setStatus } from "@/lib/status";

// Settings: the flows (ADR 0032), one tap to manage — next to the templates they are made of, and
// each repo's default flow, the last fallback when neither the card nor its phase names one.
// Says "loading" until the bridge answers (an older bridge has no /api/flows).
export function FlowsControl() {
  const t = useT();
  const { flows, reload } = useFlows();
  const { data } = useTemplates();
  const [open, setOpen] = useState(false);
  const [repos, setRepos] = useState<RepoChoice[]>([]);

  useEffect(() => {
    const ac = new AbortController();
    fetchRepos({}, ac.signal)
      .then((r) => setRepos(r.repos))
      .catch(() => {});
    return () => ac.abort();
  }, []);

  async function pickFlow(path: string, flowId: string) {
    try {
      await setRepoFlow(path, flowId || null);
      setRepos((rs) => rs.map((r) => (r.path === path ? { ...r, flowId: flowId || undefined } : r)));
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    }
  }

  if (!flows || !data) return <SettingsLoading />;
  return (
    <Card className="gap-0 py-0">
      <div className="flex items-start gap-3 p-4">
        <Workflow className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm font-semibold">{t("flows.title")}</span>
          <span className="text-xs text-muted-foreground">{t("flows.hint")}</span>
          <span className="text-xs text-muted-foreground">{t("flows.count", { count: flows.length })}</span>
        </div>
        <Button variant="outline" className="h-9 shrink-0 px-3 text-sm" onClick={() => setOpen(true)}>
          {t("flows.manage")}
        </Button>
      </div>
      {repos.length > 0 && (
        <ul className="divide-y border-t">
          {repos.map((r) => (
            <li key={r.path}>
              <label className="flex items-center gap-3 px-4 py-2 text-sm" title={t("flows.repo.hint")}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{repoName(r.path)}</span>
                  <span className="block text-xs text-muted-foreground">{t("flows.repo.label")}</span>
                </span>
                <select
                  aria-label={`${t("flows.repo.label")} — ${repoName(r.path)}`}
                  value={r.flowId ?? ""}
                  onChange={(e) => void pickFlow(r.path, e.target.value)}
                  className="h-10 min-w-0 max-w-[55%] rounded-lg border border-border bg-background px-2 text-sm"
                >
                  <option value="">{t("flows.picker.none")}</option>
                  {flows.map((f) => (
                    <option key={f.id} value={f.id}>
                      {flowName(f)}
                    </option>
                  ))}
                </select>
              </label>
            </li>
          ))}
        </ul>
      )}
      <FlowsSheet open={open} onClose={() => setOpen(false)} flows={flows} templates={data.templates} onChanged={reload} />
    </Card>
  );
}
