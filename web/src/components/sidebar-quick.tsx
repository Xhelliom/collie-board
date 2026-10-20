import { useNavigate } from "react-router";

import { useT } from "@/i18n";
import { isOrchestrator } from "@/lib/agent-groups";
import { useIsDesktop } from "@/hooks/use-media-query";
import { cardPath, projectPath, repoName } from "@/lib/board";
import { panePath } from "@/lib/nav";
import { useQuickAccess, type QuickAccess } from "@/lib/quick-access";
import type { HomeData } from "@/lib/loaders";
import { paneDisplayName } from "@/lib/types";
import { cn } from "@/lib/utils";

// The sidebar's quick access, on every screen (desktop): the projects — a lot in flight first, then a
// lot that finished lately — and under them what waits for you. Above them, each live project's
// orchestrator, the conversation the operator returns to most; its dot says it waits on you. Fetched only where it shows (desktop).
export function SidebarQuick({ data }: { data: HomeData }) {
  const q = useQuickAccess(data, useIsDesktop());
  return <QuickList q={q} data={data} />;
}

const ROW = "flex min-w-0 flex-col rounded-[10px] px-2.5 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground";
const HEADING = "px-2.5 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70";

export function QuickList({ q, data }: { q: QuickAccess | null; data: HomeData }) {
  const t = useT();
  const navigate = useNavigate();
  const orchs = data.agents.filter(isOrchestrator);
  // An orchestrator already wears its own dot up top: not listed a second time below.
  const blocked = data.agents.filter((a) => a.status === "blocked" && !isOrchestrator(a));
  const waiting = q?.waiting ?? [];
  if (!orchs.length && !q?.projects.length && !waiting.length && !blocked.length) return null;

  return (
    <>
      {orchs.length > 0 && (
        <div className="mt-4 flex flex-col gap-0.5 border-t border-border/60 pt-4">
          <span className={HEADING}>{t("quick.orchestrators")}</span>
          {orchs.map((a) => {
            const waits = a.status === "blocked" || waiting.some((w) => w.repoPath === a.cwd);
            return (
              <button key={a.paneId} type="button" onClick={() => navigate(panePath(a.paneId, data.session))} className={ROW}>
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-medium text-foreground">{repoName(a.cwd)}</span>
                  {waits && <span className="size-2 shrink-0 rounded-full bg-status-blocked" role="img" aria-label={t("quick.orchWaits")} />}
                </span>
                <span className={cn("truncate text-xs", a.status === "blocked" && "text-status-blocked")}>{t(`quick.orch.${a.status}`)}</span>
              </button>
            );
          })}
        </div>
      )}
      {!!q?.projects.length && (
        <div className="mt-4 flex flex-col gap-0.5 border-t border-border/60 pt-4">
          <span className={HEADING}>{t("quick.projects")}</span>
          {q.projects.map((p) => (
            <button key={p.repoPath} type="button" onClick={() => navigate(projectPath(p.repoPath))} className={ROW}>
              <span className="flex items-center gap-1.5">
                <span className="truncate font-medium text-foreground">{repoName(p.repoPath)}</span>
                {p.lot.blocked && (
                  <span className="size-2 shrink-0 rounded-full bg-status-blocked" role="img" aria-label={t("quick.blocked")} />
                )}
              </span>
              <span className={cn("flex gap-1 text-xs", p.lot.finished && "text-muted-foreground/70")}>
                <span className="truncate">{p.lot.name ?? t("quick.lot")}</span>
                <span className="shrink-0 tabular-nums">
                  {p.lot.finished ? t("quick.finished") : t("quick.progress", { done: p.lot.done, total: p.lot.total })}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      {(waiting.length > 0 || blocked.length > 0) && (
        <div className="mt-4 flex flex-col gap-0.5 border-t border-border/60 pt-4">
          <span className={HEADING}>{t("quick.waiting")}</span>
          {waiting.map((w) => (
            <button key={w.cardId} type="button" onClick={() => navigate(cardPath(w.cardId))} className={ROW} title={w.text}>
              <span className="truncate text-foreground">{w.title}</span>
              <span className="truncate text-xs text-brand">{t("quick.decision", { repo: repoName(w.repoPath) })}</span>
            </button>
          ))}
          {blocked.map((a) => (
            <button key={a.paneId} type="button" onClick={() => navigate(panePath(a.paneId, data.session))} className={ROW}>
              <span className="truncate text-foreground">{paneDisplayName(a)}</span>
              <span className="truncate text-xs text-status-blocked">{t("quick.agentBlocked", { space: a.workspaceLabel })}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
