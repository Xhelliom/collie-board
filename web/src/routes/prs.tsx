import { useState } from "react";
import { Link, useLoaderData, useNavigate } from "react-router";
import { Check, ChevronRight, Clock, Play, RefreshCw } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { StatusArea } from "@/components/status-area";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";
import {
  boardErrorMessage,
  boardPath,
  cardPath,
  fetchOpenPrs,
  integrateCard,
  repoName,
  type OpenPr,
} from "@/lib/board";
import { prLabel } from "@/lib/board-groups";
import { timeAgo } from "@/lib/format";
import { setStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

// The cards whose PR is still open — where to come back to once the base has moved on under them.
//
// The list is the journal's (bridge/prs.ts) and costs nothing to open. GitHub is asked only when
// Check is tapped: never on a timer, never on the poll tick (ADR 0014) — so the route opts out of
// revalidation too. A check journals the PRs that are over, which is how they leave the list.

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

const CHIP: Partial<Record<PrVerdict, { text: string; className: string; icon?: typeof Check }>> = {
  conflict: { text: "Conflicts with its base", className: "bg-status-blocked/16 text-status-blocked" },
  mergeable: { text: "Mergeable", className: "bg-status-done/16 text-status-done", icon: Check },
  pending: { text: "GitHub is still working it out", className: "bg-muted text-muted-foreground", icon: Clock },
  unknown: { text: "GitHub could not be asked", className: "bg-muted text-muted-foreground" },
};

/** One column on a phone, then as many as the width holds. */
const GRID = "grid gap-2.5 sm:grid-cols-2 lg:gap-3 xl:grid-cols-3";

/** The line under the header after a check. Pure + exported for the test. */
export function checkSummary(verdicts: readonly PrVerdict[]): string {
  const count = (v: PrVerdict) => verdicts.filter((x) => x === v).length;
  const parts = [
    count("conflict") && `${count("conflict")} conflict${count("conflict") === 1 ? "" : "s"}`,
    count("mergeable") && `${count("mergeable")} mergeable`,
    count("pending") && `${count("pending")} GitHub hasn't worked out yet`,
    count("unknown") && `${count("unknown")} GitHub could not be asked about`,
  ].filter(Boolean);
  const retry = count("pending") ? " — check again in a few seconds." : ".";
  return parts.length ? parts.join(" · ") + retry : "";
}

function meta(row: OpenPr, tail: string): string {
  return [row.card.repoPath && repoName(row.card.repoPath), row.url && prLabel(row.url, "").trim(), tail]
    .filter(Boolean)
    .join(" · ");
}

export function PrsRoute() {
  const navigate = useNavigate();
  const [rows, setRows] = useState(useLoaderData() as OpenPr[]);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [reopening, setReopening] = useState<string | null>(null);

  async function check() {
    setChecking(true);
    try {
      setRows((await fetchOpenPrs(true)).prs);
      setCheckedAt(Date.now());
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    } finally {
      setChecking(false);
    }
  }

  // The card screen takes it from there: the wait for the agent, then Update the PR.
  async function reopen(cardId: string) {
    setReopening(cardId);
    try {
      await integrateCard(cardId, "reopen");
      setStatus("Sent to the agent — tap Update the PR on the card once it has committed.", "success");
      navigate(cardPath(cardId));
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    } finally {
      setReopening(null);
    }
  }

  const open = rows.filter((r) => r.pr?.state !== "merged" && r.pr?.state !== "closed");
  const over = rows.filter((r) => r.pr?.state === "merged" || r.pr?.state === "closed");
  const summary = checkedAt === null ? "" : checkSummary(open.map((r) => prVerdict(r.pr)));

  return (
    // Same frame as every other screen: one phone-width column, the full width from `lg` — where the
    // rows become a grid, since a list of tiles has no line length to protect.
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col lg:max-w-none">
      <AppHeader
        title="Open PRs"
        subtitle={`${open.length} PR${open.length === 1 ? "" : "s"}${checkedAt === null ? "" : ` · checked ${timeAgo(checkedAt)}`}`}
        onBack={() => navigate(boardPath())}
        rightTrail={
          <Button
            variant="brand"
            className="h-9 gap-1.5 rounded-[10px] px-3 text-sm font-semibold"
            disabled={checking || rows.length === 0}
            onClick={() => void check()}
          >
            <RefreshCw className={cn("size-4", checking && "animate-spin")} />
            {checking ? "Checking…" : "Check"}
          </Button>
        }
      />
      <h1 className="sr-only">Open PRs</h1>

      <main className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3 pb-24 lg:gap-3 lg:p-5">
        {rows.length === 0 ? (
          <p className="px-2 py-16 text-center text-sm text-muted-foreground">
            No open PRs. A card lands here when “Open a PR” succeeds, and leaves once a check sees its
            PR merged or closed.
          </p>
        ) : (
          <>
            {summary && <p className="mx-1 text-xs text-muted-foreground">{summary}</p>}
            {checkedAt === null && (
              <p className="mx-1 text-xs text-muted-foreground">
                Nothing has asked GitHub yet — tap Check to see which ones still merge.
              </p>
            )}
            <div className={GRID}>
              {open.map((row) => {
                const verdict = prVerdict(row.pr);
                const chip = CHIP[verdict];
                return (
                  <div key={row.card.id} className="flex flex-col gap-2.5 rounded-[14px] border bg-card p-3">
                    <Link to={cardPath(row.card.id)} className="flex items-start gap-2">
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-sm font-semibold leading-snug">{row.card.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {meta(row, `opened ${timeAgo(row.openedAt)}`)}
                        </span>
                      </div>
                      <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    </Link>
                    {chip && (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-xs font-semibold",
                            chip.className,
                          )}
                        >
                          {chip.icon && <chip.icon className="size-3" />}
                          {chip.text}
                        </span>
                        {verdict === "conflict" && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5"
                            disabled={reopening !== null}
                            onClick={() => void reopen(row.card.id)}
                          >
                            <Play className="size-3.5" />
                            {reopening === row.card.id ? "Starting an agent…" : "Reopen with an agent"}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {over.length > 0 && (
              <>
                <SectionLabel className="mx-1 mt-2.5">Merged or closed — leaving this list</SectionLabel>
                <div className={GRID}>
                  {over.map((row) => (
                    <Link
                      key={row.card.id}
                      to={cardPath(row.card.id)}
                      className="flex flex-col gap-0.5 rounded-[14px] border border-dashed px-3 py-2.5 opacity-70"
                    >
                      <span className="text-sm font-semibold">{row.card.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {meta(
                          row,
                          row.pr?.state === "merged"
                            ? `merged ${timeAgo(row.pr.mergedAt ?? row.openedAt)}`
                            : "closed without merging",
                        )}
                      </span>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </main>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-screen-sm lg:max-w-none px-3 pb-[calc(env(safe-area-inset-bottom)_+_0.75rem)]">
        <StatusArea />
      </div>
    </div>
  );
}
