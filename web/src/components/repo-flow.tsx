import { useEffect, useState } from "react";

import { useT } from "@/i18n";
import { boardErrorMessage, fetchRepos, setRepoFlow } from "@/lib/board";
import { flowName, type Flow } from "@/lib/flows";
import { setStatus } from "@/lib/status";

// The repo's default flow (ADR 0032) on the project page: the last fallback when neither a card nor its
// phase names one. The same select as Settings (gate-control.tsx), one repo, one tap away from the roadmap.
// The repo's current `flowId` rides on the repos list, so it is read once here rather than on every poll.
export function RepoFlow({ repo, flows }: { repo: string; flows: Flow[] | null | undefined }) {
  const t = useT();
  const [flowId, setFlowId] = useState<string>("");

  useEffect(() => {
    const ac = new AbortController();
    fetchRepos({}, ac.signal)
      .then((r) => setFlowId(r.repos.find((x) => x.path === repo)?.flowId ?? ""))
      .catch(() => {});
    return () => ac.abort();
  }, [repo]);

  if (!flows) return null;

  async function pick(next: string) {
    const prev = flowId;
    setFlowId(next);
    try {
      await setRepoFlow(repo, next || null);
      setStatus(t("common.saved"), "success");
    } catch (e) {
      setFlowId(prev);
      setStatus(boardErrorMessage(e), "error", null);
    }
  }

  return (
    <label className="flex items-center gap-2 px-1 text-xs text-muted-foreground" title={t("flows.repo.hint")}>
      {t("flows.repo.label")}
      <select
        aria-label={t("flows.repo.label")}
        value={flowId}
        onChange={(e) => void pick(e.target.value)}
        className="h-7 min-w-0 rounded-md border border-border bg-background px-1.5 text-xs font-semibold text-foreground"
      >
        <option value="">{t("flows.picker.none")}</option>
        {flows.map((f) => (
          <option key={f.id} value={f.id}>
            {flowName(f)}
          </option>
        ))}
      </select>
    </label>
  );
}
