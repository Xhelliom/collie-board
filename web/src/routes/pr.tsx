import { useState } from "react";
import { Link, useLoaderData, useNavigate, useRevalidator } from "react-router";
import { ChevronDown, ChevronRight, ExternalLink, GitBranch, GitMerge, RotateCw, X } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { lineClass } from "@/components/card-diff";
import { Panel } from "@/components/card-panel";
import { MarkdownText } from "@/components/markdown-text";
import { StatusSignal } from "@/components/status-signal";
import { MENU_ITEM, MoreActions } from "@/components/project-more";
import { buttonVariants } from "@/components/ui/button";
import { usePendingConfirm } from "@/hooks/use-pending-confirm";
import { useT } from "@/i18n";
import { boardErrorMessage, cardPath, integrateCard, prGesture, rerunPrChecks, type MergeMode, type PrCheck, type PrDetail } from "@/lib/board";
import type { PrSheetData } from "@/lib/board-loaders";
import { ago } from "@/lib/project-facts";
import { setStatus } from "@/lib/status";
import { cn } from "@/lib/utils";
import { laneOf } from "@/routes/prs";

// One PR, read without leaving Collie: who, what, which files, the patch. Merge / Close are the list's
// own gestures (same calls, same confirmation); « Open on GitHub » waits in the ⋯.
// Every string — the description included — reaches the DOM as a text node (MarkdownText, no innerHTML).

export function PrRoute() {
  const t = useT();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const { repo, detail, error } = useLoaderData() as PrSheetData;
  const confirm = usePendingConfirm(4000);
  const [busy, setBusy] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [picked, setPicked] = useState<MergeMode | null>(null);
  const back = () => navigate(`/board/prs?repo=${encodeURIComponent(repo)}`);

  if (!detail) {
    return (
      <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col">
        <AppHeader title={t("pr.back")} onBack={back} />
        <p className="p-4 text-sm text-destructive">{t("pr.error", { error: error ?? "" })}</p>
      </div>
    );
  }

  // The verdict reads the checks the way the list does: a failure is red, a running one pending.
  const failed = detail.checks.filter((c) => c.state === "failure" || c.state === "cancelled");
  const checks = failed[0]
    ? { state: "red" as const, name: failed[0].name }
    : detail.checks.some((c) => c.state === "pending")
      ? { state: "pending" as const }
      : detail.checks.length
        ? { state: "green" as const }
        : undefined;
  const verdict = laneOf(
    { state: detail.state, url: detail.url, mergedAt: null, conflicting: detail.conflicting, mergeable: detail.mergeable },
    { draft: detail.isDraft, checks } as Parameters<typeof laneOf>[1],
  );
  const rerun = async (runIds: string[]) => {
    setBusy(true);
    try {
      for (const id of runIds) await rerunPrChecks(repo, detail.number, id);
      setStatus(t("pr.rerunning"), "success");
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    } finally {
      setBusy(false);
      revalidator.revalidate();
    }
  };
  // Several failed jobs often share one run: re-run each run once.
  const failedRuns = [...new Set(failed.flatMap((c) => (c.runId ? [c.runId] : [])))];
  const stateLabel = detail.state === "merged" ? t("pr.state.merged") : detail.state === "closed" ? t("pr.state.closed") : verdict.why;
  const mode = picked && detail.modes.includes(picked) ? picked : detail.modes[0];
  const blockedWhy = detail.blocker
    ? t(`pr.block.${detail.blocker}`, { base: detail.base, name: failed[0]?.name ?? "" })
    : verdict.lane !== "ready"
      ? verdict.why
      : null;
  const act = async (what: "merge" | "close") => {
    if (what === "close" && !confirm.confirm("close")) return;
    setBusy(true);
    try {
      // A card's PR merges through its card (lock, 409 while the agent works, landing journaled), as in the list.
      await (what === "merge" && detail.card ? integrateCard(detail.card.id, "merge", false, undefined, mode) : prGesture(repo, detail.number, what, what === "merge" ? mode : undefined));
      setStatus(what === "merge" ? t("prs.mergedNow", { count: 1 }) : t("prs.closedNow"), "success");
      back();
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
      revalidator.revalidate();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col lg:max-w-3xl">
      <AppHeader
        title={t("pr.title", { n: detail.number })}
        subtitle={detail.author ? t("pr.by", { author: detail.author, ago: ago(detail.createdAt ?? 0) }) : undefined}
        onBack={back}
        backLabel={t("pr.back")}
        rightTrail={
          <MoreActions label={t("prs.more")}>
            <a role="menuitem" href={detail.url} target="_blank" rel="noreferrer" className={MENU_ITEM}>
              <ExternalLink className="size-4" />
              {t("prs.github")}
            </a>
          </MoreActions>
        }
      />
      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 pb-24">
        <h1 className="text-lg font-semibold leading-snug">{detail.title}</h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {stateLabel && (
            <span className={cn("font-medium", verdict.lane === "ready" && "text-status-done", verdict.lane === "blocked" && "text-status-blocked")}>{stateLabel}</span>
          )}
          <span className="inline-flex items-center gap-1">
            <GitBranch className="size-3.5" />
            <span className="break-all">{t("pr.branches", { head: detail.head, base: detail.base })}</span>
          </span>
        </p>
        {detail.card && (
          <Link to={cardPath(detail.card.id)} className="flex min-h-11 items-center gap-1 rounded-lg border px-3 text-sm font-medium">
            <span className="min-w-0 flex-1 truncate">{t("pr.card", { title: detail.card.title })}</span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        )}

        <Panel title={t("pr.checks")} count={detail.checks.length}>
          {detail.checks.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("pr.noChecks")}</p>
          ) : (
            <ul className="flex flex-col">
              {detail.checks.map((c, i) => (
                <CheckRow key={`${c.name}-${i}`} check={c} busy={busy} onRerun={(id) => void rerun([id])} />
              ))}
            </ul>
          )}
          {failedRuns.length > 1 && detail.state === "open" && (
            <button type="button" disabled={busy} onClick={() => void rerun(failedRuns)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-2 h-11 w-full text-sm")}>
              <RotateCw className="size-4" />
              {t("pr.rerunAll")}
            </button>
          )}
        </Panel>

        <Panel title={t("pr.description")}>
          {detail.body.trim() ? <MarkdownText text={detail.body} className="text-sm leading-[1.6]" /> : <p className="text-sm text-muted-foreground">{t("pr.noBody")}</p>}
        </Panel>

        <Panel title={t("pr.files")} count={detail.files.length}>
          {detail.files.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("pr.noFiles")}</p>
          ) : (
            <ul className="flex flex-col">
              {detail.files.map((f) => (
                <li key={f.path} className="flex items-center gap-3 border-t border-border/60 py-1.5 text-xs first:border-t-0">
                  <span className="min-w-0 flex-1 break-all font-mono">{f.path}</span>
                  <span className="shrink-0 tabular-nums text-status-done">+{f.additions}</span>
                  <span className="shrink-0 tabular-nums text-destructive">−{f.deletions}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t("pr.diff")}>
          <button
            type="button"
            aria-expanded={showDiff}
            onClick={() => setShowDiff((v) => !v)}
            className="inline-flex min-h-11 items-center gap-1 text-sm font-medium"
          >
            <ChevronDown className={cn("size-4 transition-transform", !showDiff && "-rotate-90")} />
            {showDiff ? t("pr.diffHide") : t("pr.diffShow")}
          </button>
          {showDiff && <DiffBlock detail={detail} />}
        </Panel>

        {detail.state === "open" && (
          <div className="flex flex-wrap gap-2">
            {detail.modes.length > 1 && !blockedWhy && (
              <div role="radiogroup" aria-label={t("pr.mode.label")} className="flex w-full gap-1 rounded-lg border p-1">
                {detail.modes.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={m === mode}
                    onClick={() => setPicked(m)}
                    className={cn("min-h-11 flex-1 rounded-md text-sm font-medium", m === mode ? "bg-secondary text-foreground" : "text-muted-foreground")}
                  >
                    {t(`pr.mode.${m}`)}
                  </button>
                ))}
              </div>
            )}
            <button type="button" disabled={busy || !!blockedWhy} onClick={() => void act("merge")} className={cn(buttonVariants({ variant: "success", size: "sm" }), "h-11 flex-1 text-sm")}>
              <GitMerge className="size-4" />
              {busy ? t("prs.merging") : t("prs.merge")}
            </button>
            {blockedWhy && <p className="w-full text-sm text-destructive">{blockedWhy}</p>}
            <button type="button" disabled={busy} onClick={() => void act("close")} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "h-11 flex-1 text-sm text-destructive")}>
              <X className="size-4" />
              {confirm.pending === "close" ? t("prs.closeConfirm") : t("prs.close")}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

// Each line a text node, coloured by its prefix — the same lines as a card's patch (card-diff.tsx).
function DiffBlock({ detail }: { detail: PrDetail }) {
  const t = useT();
  return (
    <>
      <div className="max-h-[60vh] overflow-auto rounded-lg border bg-background">
        <pre className="p-2 font-mono text-xs leading-snug sm:min-w-max">
          {detail.diff.split("\n").map((line, i) => (
            <div key={i} className={cn("whitespace-pre-wrap break-all sm:whitespace-pre sm:break-normal", lineClass(line))}>
              {line || " "}
            </div>
          ))}
        </pre>
      </div>
      {detail.diffTruncated && <p className="pt-2 text-xs text-muted-foreground">{t("pr.diffTruncated")}</p>}
    </>
  );
}

const checkSignal = (s: PrCheck["state"]) => (s === "success" ? "done" : s === "pending" ? "working" : s === "failure" ? "stuck" : "idle");

/** « 2m 5s », or "" while it has not both ends. */
export function checkDuration(c: PrCheck): string {
  if (c.startedAt == null || c.completedAt == null || c.completedAt < c.startedAt) return "";
  const s = Math.round((c.completedAt - c.startedAt) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function CheckRow({ check, busy, onRerun }: { check: PrCheck; busy: boolean; onRerun: (runId: string) => void }) {
  const t = useT();
  return (
    <li className="flex items-center gap-3 border-t border-border/60 py-1.5 text-xs first:border-t-0">
      <StatusSignal status={checkSignal(check.state)} label={check.state} />
      <span className="min-w-0 flex-1 break-all">{check.name}</span>
      <span className="shrink-0 tabular-nums text-muted-foreground">{checkDuration(check)}</span>
      {check.state === "failure" && check.runId && (
        <button type="button" disabled={busy} onClick={() => onRerun(check.runId!)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "h-9 shrink-0 text-xs")}>
          {t("pr.rerun")}
        </button>
      )}
      {check.url && (
        <MoreActions label={t("prs.more")}>
          <a role="menuitem" href={check.url} target="_blank" rel="noreferrer" className={MENU_ITEM}>
            <ExternalLink className="size-4" />
            {t("pr.checkLog")}
          </a>
        </MoreActions>
      )}
    </li>
  );
}
