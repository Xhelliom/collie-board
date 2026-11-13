import { useEffect, useState, type ReactNode } from "react";
import { Link, useLoaderData, useNavigate, useSearchParams } from "react-router";
import { Check, ChevronRight, Clock, ExternalLink, GitMerge, Play, RefreshCw, X } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { BoardTabs, RepoTitle } from "@/components/board-tabs";
import { Panel, PanelLink } from "@/components/card-panel";
import { t, useT, type MessageKey } from "@/i18n";
import { buttonVariants, Button } from "@/components/ui/button";
import { usePendingConfirm } from "@/hooks/use-pending-confirm";
import {
  boardErrorMessage,
  cardPath,
  fetchOpenPrs,
  integrateCard,
  loadRepoScope,
  prGesture,
  repoName,
  type GhPr,
  type OpenPr,
  type PrsReading,
} from "@/lib/board";
import { ago } from "@/lib/project-facts";
import { setStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

// The pull requests still open — the cards', and the board's own off-card ones (`docs(plan)`).
//
// The loader paints the journal at once (bridge/prs.ts); the screen then reads GitHub ONCE on open,
// and again only on « Re-read » — never on a timer, never on the poll tick (ADR 0014), so the route
// opts out of revalidation. The bridge shares two reads closer than its floor. A read journals the
// PRs that are over, which is how they leave. Every write to GitHub is a tap here.

export type PrVerdict = "unchecked" | "unknown" | "conflict" | "mergeable" | "pending" | "merged" | "closed";

/** What a row can say about its PR. Pure + exported for the test. */
export function prVerdict(pr: OpenPr["pr"]): PrVerdict {
  if (pr === undefined) return "unchecked";
  if (pr === null) return "unknown";
  if (pr.state !== "open") return pr.state;
  if (pr.conflicting) return "conflict";
  // Neither: GitHub computes mergeability on demand, and says UNKNOWN until it has.
  return pr.mergeable ? "mergeable" : "pending";
}

export type Lane = "ready" | "waiting" | "blocked" | "over" | "unread";

/** One row of the screen, card or not. */
export interface PrRow {
  key: string;
  number: number | null;
  title: string;
  url: string | null;
  repoPath: string | null;
  card: OpenPr["card"] | null;
  origin: "card" | "plan" | "other";
  /** A superseded `docs(plan)` PR: the rolling one's number. */
  replacedBy?: number;
  openedAt: number;
  lane: Lane;
  /** Why it waits, or why it is stuck — in the reader's words. */
  why: string;
  autoMerge?: "armed" | "refused";
  conflict: boolean;
  mergedAt?: number | null;
}

const prNumber = (url: string | null) => Number(/\/pull\/(\d+)/.exec(url ?? "")?.[1]) || null;

/** Where a PR stands, from what GitHub said. Pure + exported for the test. */
export function laneOf(pr: OpenPr["pr"], gh?: GhPr): { lane: Lane; why: string } {
  const v = prVerdict(pr);
  if (v === "unchecked") return { lane: "unread", why: "" };
  if (v === "merged" || v === "closed") return { lane: "over", why: "" };
  if (v === "unknown") return { lane: "waiting", why: t("prs.chip.unknown") };
  if (v === "conflict") return { lane: "blocked", why: t("prs.chip.conflict") };
  if (gh?.checks?.state === "red") return { lane: "blocked", why: t("prs.why.red", { name: gh.checks.name }) };
  if (gh?.review === "changes") return { lane: "blocked", why: t("prs.why.changes") };
  if (gh?.review === "required") return { lane: "blocked", why: t("prs.why.review") };
  if (gh?.draft) return { lane: "blocked", why: t("prs.why.draft") };
  if (gh?.checks?.state === "pending") return { lane: "waiting", why: t("prs.why.running") };
  if (v === "pending") return { lane: "waiting", why: t("prs.chip.pending") };
  return { lane: "ready", why: gh?.checks?.state === "green" ? t("prs.why.green") : t("prs.chip.mergeable") };
}

/** The journal rows and GitHub's off-card ones, as one list. Pure + exported for the test. */
export function rowsOf(reading: PrsReading): PrRow[] {
  const cards: PrRow[] = reading.prs.map((r) => ({
    key: r.card.id,
    number: r.github?.number ?? prNumber(r.url),
    title: r.card.title,
    url: r.github?.url ?? r.url,
    repoPath: r.card.repoPath,
    card: r.card,
    origin: "card",
    openedAt: r.openedAt,
    ...laneOf(r.pr, r.github),
    ...(r.autoMerge ? { autoMerge: r.autoMerge } : {}),
    conflict: !!r.pr?.conflicting,
    ...(r.pr?.state === "merged" ? { mergedAt: r.pr.mergedAt } : {}),
  }));
  const others: PrRow[] = (reading.others ?? []).map((p) => ({
    key: p.url,
    number: p.number,
    title: p.title,
    url: p.url,
    repoPath: p.repoPath,
    card: null,
    origin: p.origin,
    ...(p.replacedBy ? { replacedBy: p.replacedBy } : {}),
    openedAt: p.createdAt ?? 0,
    ...laneOf({ state: "open", url: p.url, mergedAt: null, conflicting: p.conflicting, mergeable: p.mergeable }, p),
    conflict: p.conflicting,
  }));
  return [...cards, ...others].sort((a, b) => b.openedAt - a.openedAt);
}

const ORIGIN: Record<PrRow["origin"], MessageKey> = { card: "prs.origin.card", plan: "prs.origin.plan", other: "prs.origin.other" };

const LANE_TONE: Partial<Record<Lane, string>> = {
  ready: "text-status-done",
  blocked: "text-status-blocked",
};

/** The action on a row — a secondary button, the same look as a panel header's. */
function RowAction({ onClick, disabled, children, danger, success }: { onClick: () => void; disabled?: boolean; children: ReactNode; danger?: boolean; success?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(buttonVariants({ variant: success ? "success" : "secondary", size: "sm" }), "text-[13px]", danger && "text-destructive")}
    >
      {children}
    </button>
  );
}

export function PrsRoute() {
  const t = useT();
  const navigate = useNavigate();
  const [reading, setReading] = useState<PrsReading>({ prs: useLoaderData() as OpenPr[] });
  const scope = useSearchParams()[0].get("repo") ?? loadRepoScope();
  const all = rowsOf(reading);
  const rows = scope ? all.filter((r) => r.repoPath === scope) : all;
  const repos = [...new Set(all.map((r) => r.repoPath).filter((p): p is string => !!p))].map((path) => ({ path, name: repoName(path) }));
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showMerged, setShowMerged] = useState(false);
  const confirm = usePendingConfirm(4000);

  async function check() {
    setChecking(true);
    try {
      setReading(await fetchOpenPrs(true));
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    } finally {
      setChecking(false);
    }
  }

  // Once, on open: the list a reader trusts is GitHub's, not a journal that missed a merge.
  useEffect(() => {
    void check();
  }, []);

  // The card screen takes it from there: the wait for the agent, then Update the PR.
  async function reopen(cardId: string) {
    setBusy(cardId);
    try {
      await integrateCard(cardId, "reopen");
      setStatus(t("prs.reopened"), "success");
      navigate(cardPath(cardId));
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    } finally {
      setBusy(null);
    }
  }

  /** A card's PR merges through its card (the landing is journaled there); any other by number. */
  const mergeOne = (r: PrRow) => (r.card ? integrateCard(r.card.id, "merge") : prGesture(r.repoPath!, r.number!, "merge"));

  async function merge(rs: PrRow[]) {
    setBusy(rs.length > 1 ? "all" : rs[0]!.key);
    let failed = 0;
    // One at a time: each merge moves the base the next one is checked against.
    for (const r of rs) {
      try {
        await mergeOne(r);
      } catch (e) {
        failed++;
        setStatus(boardErrorMessage(e), "error", null);
      }
    }
    if (!failed) setStatus(t("prs.mergedNow", { count: rs.length }), "success");
    setBusy(null);
    await check();
  }

  async function close(r: PrRow) {
    if (!confirm.confirm(`close:${r.key}`)) return;
    setBusy(r.key);
    try {
      await prGesture(r.repoPath!, r.number!, "close");
      setStatus(t("prs.closedNow"), "success");
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    } finally {
      setBusy(null);
    }
    await check();
  }

  const lane = (l: Lane) => rows.filter((r) => r.lane === l);
  const ready = lane("ready").filter((r) => r.card || (r.repoPath && r.number));
  const waiting = lane("waiting");
  const blocked = lane("blocked");
  const unread = lane("unread");
  const over = lane("over");
  const open = rows.length - over.length;
  const merged = (reading.merged ?? []).filter((m) => !scope || m.repoPath === scope).slice(0, 10);
  const subtitle =
    t("prs.count", { count: open }) +
    (reading.checkedAt ? t("prs.checkedAgo", { ago: ago(reading.checkedAt) }) : checking ? t("prs.reading") : "");

  // A render function, not a component: defined here, a component would remount every row on each render.
  function row(r: PrRow, children?: ReactNode) {
    const title = <span className="min-w-0 truncate text-sm font-semibold leading-snug">{r.title}</span>;
    return (
      <li key={r.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 py-2 first:border-t-0 first:pt-0 lg:flex-nowrap">
        <span className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">{r.number ? `#${r.number}` : "—"}</span>
        {r.card ? (
          <Link to={cardPath(r.card.id)} className="flex min-w-0 flex-1 basis-48 items-center gap-1">
            {title}
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        ) : (
          <a href={r.url ?? undefined} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 basis-48 items-center">
            {title}
          </a>
        )}
        <span className="shrink-0 text-xs text-muted-foreground">
          {t(ORIGIN[r.origin])}
          {r.replacedBy ? ` · ${t("prs.replacedBy", { n: r.replacedBy })}` : ""}
          {r.repoPath && !scope && repos.length > 1 ? ` · ${repoName(r.repoPath)}` : ""} · {ago(r.openedAt)}
        </span>
        {r.why && (
          <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs font-medium", LANE_TONE[r.lane] ?? "text-muted-foreground")}>
            {r.lane === "ready" && <Check className="size-3" />}
            {r.lane === "waiting" && <Clock className="size-3" />}
            {r.why}
          </span>
        )}
        {r.autoMerge && (
          <span
            className="shrink-0 text-xs text-muted-foreground"
            title={t(r.autoMerge === "armed" ? "prs.auto.armed" : "prs.auto.refused")}
          >
            {t(r.autoMerge === "armed" ? "prs.auto.armedShort" : "prs.auto.refusedShort")}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-3">{children}</span>
      </li>
    );
  }

  const gh = (r: PrRow) =>
    r.url && (
      <a href={r.url} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "text-[13px]")}>
        <ExternalLink className="size-3.5" />
        {t("prs.github")}
      </a>
    );

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col lg:max-w-none">
      <AppHeader
        children={<RepoTitle repos={repos} subtitle={subtitle} />}
        rightTrail={
          <Button variant="brand" className="h-9 gap-1.5 rounded-sm px-3 text-sm font-semibold" disabled={checking} onClick={() => void check()}>
            <RefreshCw className={cn("size-4", checking && "animate-spin")} />
            {checking ? t("prs.checking") : t("prs.check")}
          </Button>
        }
      />
      <BoardTabs />
      <h1 className="sr-only">{t("prs.title")}</h1>

      <main className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-3 overflow-y-auto p-3 pb-24 lg:p-5">
        {rows.length === 0 && !checking ? (
          <p className="px-2 py-16 text-center text-sm text-muted-foreground">{scope ? t("prs.emptyRepo", { repo: repoName(scope) }) : t("prs.empty")}</p>
        ) : (
          <>
            {ready.length > 0 && (
              <Panel
                title={t("prs.lane.ready")}
                count={ready.length}
                tone="good"
                actions={
                  ready.length > 1 && (
                    <PanelLink success disabled={busy !== null} onClick={() => confirm.confirm("merge-all") && void merge(ready)}>
                      <GitMerge className="size-3.5" />
                      {confirm.pending === "merge-all" ? t("prs.mergeAllConfirm", { count: ready.length }) : t("prs.mergeAll", { count: ready.length })}
                    </PanelLink>
                  )
                }
              >
                <ul>
                  {ready.map((r) => (
                    row(
                      r,
                      <>
                      <RowAction success disabled={busy !== null} onClick={() => void merge([r])}>
                        <GitMerge className="size-3.5" />
                        {busy === r.key ? t("prs.merging") : t("prs.merge")}
                      </RowAction>
                      </>,
                    )
                  ))}
                </ul>
              </Panel>
            )}
            {blocked.length > 0 && (
              <Panel title={t("prs.lane.blocked")} count={blocked.length} tone="bad">
                <ul>
                  {blocked.map((r) => (
                    row(
                      r,
                      <>
                      {r.card && r.conflict && (
                        <RowAction disabled={busy !== null} onClick={() => void reopen(r.card!.id)}>
                          <Play className="size-3.5" />
                          {busy === r.key ? t("prs.reopening") : t("prs.reopen")}
                        </RowAction>
                      )}
                      {r.repoPath && r.number && (
                        <RowAction danger disabled={busy !== null} onClick={() => void close(r)}>
                          <X className="size-3.5" />
                          {confirm.pending === `close:${r.key}` ? t("prs.closeConfirm") : t("prs.close")}
                        </RowAction>
                      )}
                      {gh(r)}
                      </>,
                    )
                  ))}
                </ul>
              </Panel>
            )}
            {waiting.length > 0 && (
              <Panel title={t("prs.lane.waiting")} count={waiting.length}>
                <ul>
                  {waiting.map((r) => (
                    row(
                      r,
                      <>
                      {gh(r)}
                      </>,
                    )
                  ))}
                </ul>
                {waiting.some((r) => r.why === t("prs.chip.pending") || r.why === t("prs.why.running")) && (
                  <p className="text-xs text-muted-foreground">{t("prs.retry")}</p>
                )}
              </Panel>
            )}
            {unread.length > 0 && (
              <Panel title={t("prs.lane.unread")} count={unread.length}>
                <ul>
                  {unread.map((r) => (
                    row(r)
                  ))}
                </ul>
              </Panel>
            )}
            {over.length > 0 && (
              <Panel title={t("prs.over")} count={over.length} className="border-dashed opacity-80">
                <ul>
                  {over.map((r) => (
                    row({ ...r, why: r.mergedAt !== undefined ? t("prs.merged", { ago: ago(r.mergedAt ?? r.openedAt) }) : t("prs.closed") })
                  ))}
                </ul>
              </Panel>
            )}
          </>
        )}
        {merged.length > 0 && (
          <div className="flex flex-col gap-2">
            <PanelLink expanded={showMerged} onClick={() => setShowMerged((v) => !v)}>
              {showMerged ? t("prs.hideMerged") : t("prs.showMerged", { count: merged.length })}
            </PanelLink>
            {showMerged && (
              <ul className="rounded-xl border bg-card shadow-(--shadow-panel) px-4 py-3">
                {merged.map((m) => (
                  <li key={m.url} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 py-2 first:border-t-0 first:pt-0">
                    <span className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">#{m.number}</span>
                    {m.cardId ? (
                      <Link to={cardPath(m.cardId)} className="min-w-0 flex-1 truncate text-sm">{m.title}</Link>
                    ) : (
                      <a href={m.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm">{m.title}</a>
                    )}
                    <span className="shrink-0 text-xs text-muted-foreground">{t("prs.merged", { ago: ago(m.mergedAt ?? 0) })}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
