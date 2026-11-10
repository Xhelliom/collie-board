import { useLoaderData } from "react-router";
import { Check, ChevronDown } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { BoardTabs } from "@/components/board-tabs";
import { MarkdownText } from "@/components/markdown-text";
import { useT, type MessageKey } from "@/i18n";
import { repoName, type Decision, type DecisionStatus, type RoadmapStatus } from "@/lib/board";
import type { RoadmapData } from "@/lib/board-loaders";
import { cn } from "@/lib/utils";

// The roadmap as a page to read — the live successor of docs/pages/roadmap.html, which an orchestrator
// script regenerated off-repo. Same data the project page folds away (vision, steps, decisions) plus the
// board phases each step became; the loader rides the root poll, so a PUT /api/roadmap shows on the next tick.

const DOT: Record<RoadmapStatus, string> = {
  planned: "border-muted-foreground/60 bg-background",
  active: "border-status-working bg-status-working motion-safe:animate-pulse",
  done: "border-status-done bg-status-done",
  dropped: "border-muted-foreground/30 bg-muted",
};
const TAG: Record<RoadmapStatus, string> = {
  planned: "bg-muted text-muted-foreground",
  active: "bg-status-working/20 text-foreground",
  done: "bg-status-done/15 text-foreground",
  dropped: "bg-muted text-muted-foreground line-through",
};
const DECISION: Record<DecisionStatus, { mark: string; label: MessageKey; count: MessageKey }> = {
  decided: { mark: "✅", label: "roadmap.decision.decided", count: "roadmap.count.decided" },
  leaning: { mark: "🟡", label: "roadmap.decision.leaning", count: "roadmap.count.leaning" },
  open: { mark: "❓", label: "roadmap.decision.open", count: "roadmap.count.open" },
};
const ORDER: DecisionStatus[] = ["open", "leaning", "decided"];

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });

function DecisionList({ decisions }: { decisions: Decision[] }) {
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {decisions.map((d) => (
        <li key={d.id} className="flex gap-2">
          <span aria-hidden="true">{DECISION[d.status].mark}</span>
          <span className="min-w-0">{d.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function RoadmapRoute() {
  const t = useT();
  const { repo, roadmap, phases } = useLoaderData() as RoadmapData;
  const items = roadmap?.items ?? [];
  const decisions = roadmap?.decisions ?? [];
  const counted = items.filter((i) => i.status !== "dropped");
  const done = counted.filter((i) => i.status === "done").length;
  const active = items.filter((i) => i.status === "active");
  const pct = counted.length ? Math.round((done / counted.length) * 100) : 0;

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col lg:max-w-none">
      <AppHeader title={t("tabs.roadmap")} />
      <BoardTabs repos={repo ? [{ path: repo, name: repoName(repo) }] : []} />
      <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-5">
        {!repo ? (
          <p className="text-sm text-muted-foreground">{t("roadmap.view.pickRepo")}</p>
        ) : !roadmap ? (
          <p className="text-sm text-muted-foreground">{t("roadmap.empty")}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{t("roadmap.view.title", { name: repoName(repo) })}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("roadmap.view.progress", { count: done, done, total: counted.length, active: active.length })}
                </p>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">{t("roadmap.view.live", { revision: roadmap.revision })}</p>
              </div>
              <div
                role="img"
                aria-label={`${pct}% ${t("roadmap.view.done")}`}
                className="grid size-20 place-items-center rounded-full transition-[background] duration-700"
                style={{ background: `conic-gradient(var(--color-status-done) ${pct}%, var(--color-border) 0)` }}
              >
                <b className="grid size-[3.9rem] place-items-center rounded-full bg-background text-lg leading-none tabular-nums">
                  <span>
                    {pct}%<small className="block text-[0.6rem] font-medium text-muted-foreground">{t("roadmap.view.done")}</small>
                  </span>
                </b>
              </div>
            </header>

            {roadmap.vision && (
              <div className="rounded-2xl border bg-card/70 p-4">
                <MarkdownText text={roadmap.vision} className="text-sm" />
              </div>
            )}

            {active.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {active.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => scrollTo(`step-${i.id}`)}
                    className="inline-flex max-w-full items-center gap-2 rounded-full border border-status-working/50 bg-status-working/15 px-3 py-1 text-sm"
                  >
                    <span className="size-2 shrink-0 rounded-full bg-status-working motion-safe:animate-pulse" />
                    <span className="truncate">{i.name}</span>
                  </button>
                ))}
              </div>
            )}

            <nav className="sticky top-[env(safe-area-inset-top,0px)] z-10 -mx-4 flex gap-1.5 overflow-x-auto bg-background/85 px-4 py-2 backdrop-blur [scrollbar-width:none]">
              {[
                { id: "roadmap-steps", label: t("roadmap.view.steps") },
                ...(decisions.length ? [{ id: "roadmap-decisions", label: t("roadmap.decisions") }] : []),
              ].map((n) => (
                <button key={n.id} type="button" onClick={() => scrollTo(n.id)} className="shrink-0 rounded-full border bg-card px-3 py-1 text-sm hover:border-foreground/25">
                  {n.label}
                </button>
              ))}
            </nav>

            <section id="roadmap-steps" aria-label={t("roadmap.view.steps")} className="scroll-mt-14">
              <ol className="ml-2 border-l-2 border-border pl-5">
                {items.map((it, i) => {
                  const mine = phases.filter((p) => p.roadmapItemId === it.id).sort((a, b) => a.position - b.position);
                  const theirs = decisions.filter((d) => d.itemId === it.id);
                  const hasBody = !!it.detail || mine.length > 0 || theirs.length > 0;
                  return (
                    <li key={it.id} id={`step-${it.id}`} className="relative scroll-mt-14 pb-3">
                      <span className={cn("absolute -left-[1.85rem] top-3 size-3.5 rounded-full border-2", DOT[it.status])} />
                      <details open={it.status === "active"} className="group rounded-xl border bg-card/70">
                        <summary className={cn("flex list-none items-start gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden", hasBody && "cursor-pointer")}>
                          <span className="min-w-0 flex-1">
                            <span className="font-mono text-xs tabular-nums text-muted-foreground">{i + 1}. </span>
                            <b className={cn("font-semibold", it.status === "dropped" && "text-muted-foreground line-through")}>{it.name}</b>
                            {it.goal && <span className="mt-0.5 block text-sm text-muted-foreground">{it.goal}</span>}
                          </span>
                          <span className={cn("shrink-0 rounded-full px-2 py-0.5 font-mono text-xs", TAG[it.status])}>{t(`roadmap.status.${it.status}`)}</span>
                          {hasBody && <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />}
                        </summary>
                        {hasBody && (
                          <div className="flex flex-col gap-3 border-t px-3 py-3">
                            {it.detail && <MarkdownText text={it.detail} className="text-sm text-muted-foreground" />}
                            {mine.length > 0 && (
                              <div className="flex flex-col gap-1.5">
                                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("roadmap.view.phases")}</span>
                                <ul className="flex flex-wrap gap-1.5">
                                  {mine.map((p) => (
                                    <li key={p.id} className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs", p.closedAt && "border-status-done/50")}>
                                      {p.closedAt ? <Check className="size-3 text-status-done" aria-label={t("roadmap.view.validated")} /> : null}
                                      {p.name}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {theirs.length > 0 && (
                              <div aria-label={t("roadmap.phaseDecisions")} className="text-muted-foreground">
                                <DecisionList decisions={theirs} />
                              </div>
                            )}
                          </div>
                        )}
                      </details>
                    </li>
                  );
                })}
              </ol>
            </section>

            {decisions.length > 0 && (
              <section id="roadmap-decisions" aria-label={t("roadmap.journal")} className="flex scroll-mt-14 flex-col gap-3">
                <h2 className="text-lg font-semibold">{t("roadmap.decisions")}</h2>
                {ORDER.map((s) => {
                  const group = decisions.filter((d) => d.status === s);
                  if (!group.length) return null;
                  return (
                    <div key={s} className="rounded-2xl border bg-card/70 p-4">
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        {DECISION[s].mark} {t(DECISION[s].count, { count: group.length })}
                      </h3>
                      <DecisionList decisions={group} />
                    </div>
                  );
                })}
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
