import { useState } from "react";
import { Link, useLoaderData, useNavigate, useRevalidator } from "react-router";
import { ChevronDown, ChevronRight, ExternalLink, GitBranch, GitMerge, X } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { lineClass } from "@/components/card-diff";
import { Panel } from "@/components/card-panel";
import { MarkdownText } from "@/components/markdown-text";
import { MENU_ITEM, MoreActions } from "@/components/project-more";
import { buttonVariants } from "@/components/ui/button";
import { usePendingConfirm } from "@/hooks/use-pending-confirm";
import { useT } from "@/i18n";
import { boardErrorMessage, cardPath, integrateCard, prGesture, type PrDetail } from "@/lib/board";
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
  const back = () => navigate(`/board/prs?repo=${encodeURIComponent(repo)}`);

  if (!detail) {
    return (
      <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col">
        <AppHeader title={t("pr.back")} onBack={back} />
        <p className="p-4 text-sm text-destructive">{t("pr.error", { error: error ?? "" })}</p>
      </div>
    );
  }

  const verdict = laneOf(
    { state: detail.state, url: detail.url, mergedAt: null, conflicting: detail.conflicting, mergeable: detail.mergeable },
    { draft: detail.isDraft } as Parameters<typeof laneOf>[1],
  );
  const stateLabel = detail.state === "merged" ? t("pr.state.merged") : detail.state === "closed" ? t("pr.state.closed") : verdict.why;
  const act = async (what: "merge" | "close") => {
    if (what === "close" && !confirm.confirm("close")) return;
    setBusy(true);
    try {
      // A card's PR merges through its card (the landing is journaled there), as in the list.
      await (what === "merge" && detail.card ? integrateCard(detail.card.id, "merge") : prGesture(repo, detail.number, what));
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
            {verdict.lane === "ready" && (
              <button type="button" disabled={busy} onClick={() => void act("merge")} className={cn(buttonVariants({ variant: "success", size: "sm" }), "h-11 flex-1 text-sm")}>
                <GitMerge className="size-4" />
                {busy ? t("prs.merging") : t("prs.merge")}
              </button>
            )}
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
