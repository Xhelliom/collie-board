import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import { ChevronRight, ShieldCheck } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { AutonomySettings } from "@/components/autonomy-settings";
import { BoardTabs } from "@/components/board-tabs";
import { GateSheet } from "@/components/gate-sheet";
import { calm } from "@/components/kpi";
import { ShareSettings } from "@/components/share-settings";
import { SectionLabel } from "@/components/ui/section-label";
import { useT } from "@/i18n";
import { AUTONOMY_SECTION, fetchRepos, loadRepoScope, repoName, type RepoChoice } from "@/lib/board";
import { revealWhenRendered } from "@/lib/reveal";
import { setStatus } from "@/lib/status";

// The settings of ONE repo, a tab of the board beside Open PRs. Always rendered, card or not: a repo
// with no card yet is exactly where sharing has to be switched on to join a colleague's board.
export function RepoSettingsRoute() {
  const t = useT();
  const repo = useSearchParams()[0].get("repo") ?? loadRepoScope();
  const { hash, key } = useLocation();
  const [repos, setRepos] = useState<RepoChoice[]>([]);
  const [gating, setGating] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    fetchRepos({}, ac.signal)
      .then((r) => setRepos(r.repos))
      .catch(() => {});
    return () => ac.abort();
  }, []);

  // `#project-autonomy` (the orchestrator's link): scroll there once the block is rendered.
  useEffect(() => {
    if (!repo || hash !== `#${AUTONOMY_SECTION}`) return;
    return revealWhenRendered(
      AUTONOMY_SECTION,
      (el) => el.scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "start" }),
      () => setStatus(t("orch.autoMissing"), "error", null),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per arrival, not per render
  }, [key, hash, repo]);

  const gate = repos.find((r) => r.path === repo)?.gate ?? null;

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col lg:max-w-3xl">
      <AppHeader title={t("tabs.settings")} subtitle={repo ? repoName(repo) : undefined} />
      <BoardTabs repos={repos.map((r) => ({ path: r.path, name: repoName(r.path) }))} />
      <h1 className="sr-only">{t("tabs.settings")}</h1>
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 pb-24 lg:p-5">
        {!repo ? (
          <p className="px-2 py-16 text-center text-sm text-muted-foreground">{t("settings.repo.pick")}</p>
        ) : (
          <>
            <SectionLabel>{t("orch.auto")}</SectionLabel>
            <AutonomySettings repo={repo} />
            <SectionLabel>{t("project.share.fold")}</SectionLabel>
            <ShareSettings repo={repo} />
            <SectionLabel>{t("gate.control.title")}</SectionLabel>
            <button
              type="button"
              onClick={() => setGating(true)}
              className="flex min-h-12 w-full items-center gap-2 rounded-2xl border bg-card/40 px-4 py-2 text-left hover:bg-accent/50"
            >
              <ShieldCheck className="size-5 shrink-0 text-muted-foreground" />
              <span className="block min-w-0 flex-1 truncate font-mono text-xs">{gate ?? t("gate.none")}</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
            {gating && (
              <GateSheet
                open
                onClose={() => setGating(false)}
                repoPath={repo}
                gate={gate}
                onSaved={(g) => setRepos((rs) => rs.map((r) => (r.path === repo ? { ...r, gate: g ?? undefined } : r)))}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
