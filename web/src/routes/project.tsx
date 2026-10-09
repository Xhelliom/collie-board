import { useEffect, useMemo, useRef, useState } from "react";
import { useLoaderData, useNavigate, useRevalidator, useSearchParams } from "react-router";

import { MessagesSquare } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { BottomSheet } from "@/components/ui/sheet";
import { OrchestratorPanel } from "@/components/orchestrator-panel";
import { PhaseLots } from "@/components/project-lots";
import { ProjectRoadmap } from "@/components/project-roadmap";
import { StepItem, STEP_TONE } from "@/components/project-step";
import { boardErrorMessage, boardPath, patchCard, repoName, type CardView } from "@/lib/board";
import type { ProjectData } from "@/lib/board-loaders";
import { timeAgo } from "@/lib/format";
import { projectOf, stepGroup, type StepGroup } from "@/lib/project";
import { setStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

// The project view: one repo's board read as a road map. Derived and read-only (lib/project.ts) —
// phases are containers, steps their sub-tasks, "waiting for you" is what is blocked, in review or
// orphaned. Polling is the root's, like every board route.

type Filter = "all" | StepGroup;
const FILTERS: { id: Filter; label: string; dot: string }[] = [
  { id: "all", label: "all", dot: "bg-foreground" },
  { id: "done", label: "done", dot: "bg-status-done" },
  { id: "flight", label: "in flight", dot: "bg-status-working" },
  { id: "waiting", label: "waiting for you", dot: "bg-brand" },
  { id: "todo", label: "to start", dot: "bg-muted-foreground" },
];
const FILTER_KEY = "collie-project-filter";

const calm = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const store = {
  get: () => {
    try {
      return localStorage.getItem(FILTER_KEY);
    } catch {
      return null;
    }
  },
  set: (v: string) => {
    try {
      localStorage.setItem(FILTER_KEY, v);
    } catch {
      /* private window: the filter just isn't remembered */
    }
  },
};

/** Counts up to `to` once on mount, then follows it; still for people who asked for less motion. */
function useCountUp(to: number): number {
  const [v, setV] = useState(calm() ? to : 0);
  const from = useRef(v);
  useEffect(() => {
    if (calm()) return setV(to);
    const t0 = performance.now();
    const start = from.current;
    let raf = requestAnimationFrame(function tick(t) {
      const x = Math.min(1, (t - t0) / 900);
      const val = Math.round(start + (to - start) * (1 - Math.pow(1 - x, 3)));
      from.current = val;
      setV(val);
      if (x < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return v;
}

const R = 66;
const C = 2 * Math.PI * R;

function Ring({ done, active, total }: { done: number; active: number; total: number }) {
  const [armed, setArmed] = useState(calm());
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setArmed(true)));
    return () => cancelAnimationFrame(id);
  }, []);
  const pct = useCountUp(total ? Math.round((100 * done) / total) : 0);
  const off = (n: number) => (armed && total ? C * (1 - n / total) : C);
  const arc = "fill-none stroke-[9] [stroke-linecap:round] transition-[stroke-dashoffset] duration-[1400ms] ease-out motion-reduce:transition-none";
  return (
    <div className="relative grid size-36 shrink-0 place-items-center sm:size-40" role="img" aria-label={`${done} of ${total} steps done`}>
      <svg viewBox="0 0 156 156" className="absolute inset-0 -rotate-90">
        <circle cx="78" cy="78" r={R} className="fill-none stroke-border stroke-[9]" />
        <circle cx="78" cy="78" r={R} strokeDasharray={C} strokeDashoffset={off(done + active)} className={cn(arc, "stroke-status-working")} />
        <circle
          cx="78"
          cy="78"
          r={R}
          strokeDasharray={C}
          strokeDashoffset={off(done)}
          className={cn(arc, "stroke-status-done drop-shadow-[0_0_6px_var(--status-done)]")}
        />
      </svg>
      <div className="grid gap-0.5 text-center">
        <span className="text-4xl font-bold leading-none tabular-nums">{pct}%</span>
        <span className="text-[11px] leading-snug text-muted-foreground">
          {done} / {total} done
          <br />
          {active} in flight
        </span>
      </div>
    </div>
  );
}

function Kpi({ label, value, note, tone }: { label: string; value: number; note?: string; tone: string }) {
  const shown = useCountUp(value);
  return (
    <div className="relative overflow-hidden rounded-xl border bg-card/70 p-3.5 transition-[transform,border-color] duration-300 hover:-translate-y-0.5 hover:border-foreground/25">
      <span className={cn("absolute inset-x-0 top-0 h-px opacity-60", tone)} />
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      <div className="mt-1.5 text-3xl font-semibold leading-none tabular-nums">{shown}</div>
      {note && <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-muted-foreground">{note}</p>}
    </div>
  );
}

function Bar({ steps, className }: { steps: CardView[]; className?: string }) {
  return (
    <div className={cn("flex gap-[3px]", className)} aria-hidden="true">
      {steps.map((s) => (
        <i key={s.id} className={cn("h-[5px] flex-1 rounded-[3px] bg-border", STEP_TONE[s.status])} />
      ))}
    </div>
  );
}

export function ProjectRoute() {
  const navigate = useNavigate();
  const data = useLoaderData() as ProjectData;
  const revalidator = useRevalidator();
  const repo = useSearchParams()[0].get("repo");
  const cards = useMemo(() => (repo ? data.cards.filter((c) => c.repoPath === repo) : data.cards), [data.cards, repo]);
  const v = useMemo(() => projectOf(cards, data.phases, data.lots), [cards, data.phases, data.lots]);
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

  const [filter, setFilter] = useState<Filter>(() => {
    const m = store.get();
    return FILTERS.some((f) => f.id === m) ? (m as Filter) : "all";
  });
  // Open by default: what an agent is on and what waits for you — decided once, so a poll never
  // folds a row the operator opened or opens one they closed.
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(v.phases.flatMap((p) => p.steps).filter((s) => ["flight", "waiting"].includes(stepGroup(s))).map((s) => s.id)),
  );
  const [flash, setFlash] = useState<string | null>(null);
  // The orchestrator is docked on a wide screen and a sheet on a phone (ADR 0021).
  const [chatOpen, setChatOpen] = useState(false);
  const toggle = (id: string, on?: boolean) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (on ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });
  const move = async (cardId: string, phaseId: string | null) => {
    try {
      await patchCard(cardId, { phaseId });
      void revalidator.revalidate();
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    }
  };
  const pick = (f: Filter) => {
    setFilter(f);
    store.set(f);
  };
  const go = (el: HTMLElement | null) => el?.scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "start" });

  const steps = v.phases.flatMap((p) => p.steps);
  const counts: Record<Filter, number> = {
    all: v.total,
    done: v.done,
    flight: v.active,
    waiting: v.waiting,
    todo: v.todo,
  };
  const shownIn = (s: CardView) => filter === "all" || stepGroup(s) === filter;
  const allOpen = steps.filter(shownIn).every((s) => openIds.has(s.id));
  const latest = cards.reduce((m, c) => Math.max(m, c.updatedAt), 0);
  const named = v.phases.filter((p) => p.phase || p.container).length;

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col lg:max-w-none">
      <AppHeader title={repo ? repoName(repo) : "Project"} subtitle="Road map" onBack={() => navigate(boardPath())} />
      <h1 className="sr-only">Project</h1>
      <div className="flex min-h-0 flex-1">
      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-80 text-foreground/[0.06] [background-image:linear-gradient(currentColor_1px,transparent_1px),linear-gradient(90deg,currentColor_1px,transparent_1px)] [background-size:32px_32px] [mask-image:radial-gradient(ellipse_at_50%_0%,#000_30%,transparent_75%)]"
        />
        <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-24 pt-5 lg:px-6 lg:pt-8">
          {v.total === 0 ? (
            <p className="px-2 py-16 text-center text-sm text-muted-foreground">
              No cards{repo ? " in this repo" : ""} yet. Split a card into sub-tasks to make a phase.
            </p>
          ) : (
            <>
              <header className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs uppercase tracking-[0.14em] text-brand">
                    <span>{repo ? repoName(repo) : "all repos"} · road map</span>
                    {latest > 0 && (
                      <span className="inline-flex items-center gap-1.5 text-status-done">
                        <span className="size-[7px] rounded-full bg-current shadow-[0_0_10px_currentColor]" />
                        updated {timeAgo(latest)}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-muted-foreground">
                    <b className="font-semibold text-foreground">{v.done}</b> of {v.total} steps done
                    {named > 0 && ` across ${named} phase${named === 1 ? "" : "s"}`}.{" "}
                    {v.waiting > 0 ? (
                      <>
                        <b className="font-semibold text-foreground">{v.waiting}</b> waiting for you
                      </>
                    ) : (
                      "Nothing waits for you"
                    )}
                    , {v.active} in flight.
                    {v.next && (
                      <>
                        {" "}
                        Next up: <b className="font-semibold text-foreground">{v.next.title}</b>.
                      </>
                    )}
                  </p>
                </div>
                <Ring done={v.done} active={v.active} total={v.total} />
              </header>

              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                <Kpi label="Done" value={v.done} note={`of ${v.total} steps`} tone="bg-status-done" />
                <Kpi label="In flight" value={v.active} note="an agent is on it" tone="bg-status-working" />
                <Kpi label="Waiting for you" value={v.waiting} note={v.waiting ? "blocked, to review or orphaned" : "nothing to do"} tone="bg-brand" />
                <Kpi label="To start" value={v.todo} note={v.next ? `next: ${v.next.title}` : undefined} tone="bg-muted-foreground" />
              </div>

              {repo && <ProjectRoadmap repo={repo} roadmap={data.roadmap} />}

              {v.awaiting.length > 0 && (
                <section
                  aria-label="Waiting for you"
                  className="flex flex-col gap-2 rounded-2xl border border-brand/45 bg-card/70 p-4 shadow-[0_10px_40px_-20px] shadow-brand"
                >
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
                    ◆ {v.awaiting.length} waiting for you
                  </span>
                  <ul className="flex flex-col gap-1.5">
                    {v.awaiting.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => {
                            pick("all");
                            toggle(c.id, true);
                            requestAnimationFrame(() => go(document.getElementById(`step-${c.id}`)));
                            setFlash(c.id);
                            setTimeout(() => setFlash(null), 1600);
                          }}
                          className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 rounded-[10px] border px-3 py-2.5 text-left transition-colors hover:border-brand hover:bg-brand/5"
                        >
                          <span className="truncate text-sm font-semibold">{c.title}</span>
                          <span className="font-mono text-xs text-brand">see →</span>
                          <span className="col-span-2 text-[13px] text-muted-foreground">
                            {c.status === "review" ? "To review" : c.status === "blocked" ? "Needs you" : "Orphaned"}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <nav aria-label="Phases" className="-mx-1 grid auto-cols-[minmax(150px,1fr)] grid-flow-col gap-2 overflow-x-auto px-1 pb-2">
                {v.phases.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => {
                      pick("all");
                      requestAnimationFrame(() => go(document.getElementById(`phase-${p.key}`)));
                    }}
                    className={cn(
                      "flex flex-col gap-2 rounded-xl border bg-card/70 p-3 text-left transition-[transform,border-color] duration-300 hover:-translate-y-0.5 hover:border-foreground/25",
                      p.steps.some((s) => stepGroup(s) === "flight") && "border-status-working/60",
                    )}
                  >
                    <span className="text-[13px] font-semibold leading-tight">{p.title}</span>
                    <Bar steps={p.steps} />
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {p.done} / {p.steps.length} done
                    </span>
                  </button>
                ))}
              </nav>

              <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-2 bg-background/85 px-4 py-2.5 backdrop-blur lg:-mx-6 lg:px-6">
                <div role="group" aria-label="Filter the steps" className="flex flex-wrap gap-1.5">
                  {FILTERS.filter((f) => f.id === "all" || counts[f.id] > 0).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      aria-pressed={filter === f.id}
                      onClick={() => pick(f.id)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border bg-card/70 px-3 py-1.5 font-mono text-xs font-medium transition-colors",
                        filter === f.id ? "border-foreground/50 bg-accent" : "hover:border-foreground/25",
                      )}
                    >
                      {f.id !== "all" && <span className={cn("size-2 rounded-full", f.dot)} />}
                      {f.label}
                      <span className="tabular-nums text-muted-foreground">{counts[f.id]}</span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setOpenIds(allOpen ? new Set() : new Set(steps.filter(shownIn).map((s) => s.id)))
                  }
                  className="rounded-full border bg-card/70 px-3 py-1.5 font-mono text-xs font-medium hover:border-foreground/25"
                >
                  {allOpen ? "Fold all" : "Open all"}
                </button>
              </div>

              <ol className="flex flex-col gap-2">
                {(() => {
                  let k = 0;
                  return v.phases.map((p) => {
                    const visible = p.steps.filter(shownIn);
                    const showLots = filter === "all" && p.lots.length > 0;
                    if (visible.length === 0 && !showLots && !(filter === "all" && p.phase)) return null;
                    return (
                      <li key={p.key} className="contents">
                        <div id={`phase-${p.key}`} className="flex scroll-mt-16 items-center gap-3 pb-1 pt-4">
                          <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">{p.title}</h2>
                          <span className="h-px flex-1 bg-gradient-to-r from-foreground/25 to-transparent" />
                        </div>
                        {p.goal && <p className="-mt-1 pb-1 text-sm text-muted-foreground">{p.goal}</p>}
                        {showLots && <PhaseLots lots={p.lots} byId={byId} onLaunched={() => void revalidator.revalidate()} />}
                        <ul className="flex flex-col gap-2">
                          {visible.map((s) => (
                            <StepItem
                              key={s.id}
                              card={s}
                              index={k++}
                              next={s.id === v.next?.id}
                              open={openIds.has(s.id)}
                              flash={flash === s.id}
                              predecessor={s.dependsOn ? byId.get(s.dependsOn) : undefined}
                              facts={data.facts?.[s.id]}
                              onToggle={() => toggle(s.id)}
                              phases={data.phases}
                              onMove={(phaseId) => void move(s.id, phaseId)}
                            />
                          ))}
                        </ul>
                      </li>
                    );
                  });
                })()}
              </ol>
            </>
          )}
        </div>
      </main>
      <aside aria-label="Orchestrateur" className="hidden w-[22rem] shrink-0 flex-col border-l lg:flex xl:w-96">
        <OrchestratorPanel repo={repo} state={data.orchestrator} text={data.orchestratorText ?? ""} />
      </aside>
      </div>
      <button
        type="button"
        onClick={() => setChatOpen(true)}
        className="fixed bottom-4 right-4 z-20 inline-flex h-11 items-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-brand-foreground shadow-lg lg:hidden"
      >
        <MessagesSquare className="size-4" />
        Discuter avec l'orchestrateur
      </button>
      <BottomSheet open={chatOpen} onClose={() => setChatOpen(false)} title="Orchestrateur">
        <OrchestratorPanel repo={repo} state={data.orchestrator} text={data.orchestratorText ?? ""} />
      </BottomSheet>
    </div>
  );
}
