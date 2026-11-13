import { GoalPanel } from "@/components/goal-panel";
import { GoalLine, type OpenGoal } from "@/components/goal-chip";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLoaderData, useRevalidator, useRouteLoaderData, useSearchParams } from "react-router";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";

import { Check, ListFilter, MessagesSquare } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { BoardTabs, RepoTitle } from "@/components/board-tabs";
import { ExitCriteria } from "@/components/exit-criteria";
import { Fold, useStoredFold } from "@/components/fold";
import { BottomSheet } from "@/components/ui/sheet";
import { usePanelWidth } from "@/hooks/use-panel-width";
import { OrchestratorPanel } from "@/components/orchestrator-panel";
import { ProjectOpen } from "@/components/project-open";
import { MigrateAllHc } from "@/components/migrate-hc-button";
import { DeliverableLinks, recentDeliverables } from "@/components/card-deliverables";
import { PhaseTemplate } from "@/components/phase-template";
import { LotAction, PhaseLots, lotState } from "@/components/project-lots";
import { CardRow } from "@/components/project-row";
import { liveLots } from "@/lib/lot-live";
import { ProjectRoadmap } from "@/components/project-roadmap";
import { RepoFlow } from "@/components/repo-flow";
import { ClosedPhases, SealSheet, ValidateSheet } from "@/components/project-milestones";
import { STEP_TONE } from "@/components/project-step";
import { boardErrorMessage, CARD_STATUS_LABEL, cardPath, deletePhase, loadRepoScope, repoName, reposOf, type CardView } from "@/lib/board";
import { forgetProjectSettled, type ProjectData } from "@/lib/board-loaders";
import { getLocale, useT, type MessageKey } from "@/i18n";
import { projectOf, proposeMilestoneName, stepGroup, type ProjectPhase, type StepGroup } from "@/lib/project";
import { lotHold } from "@/lib/lot-hold";
import { haltSentence } from "@/lib/halt-sentence";
import { saveLastProject } from "@/lib/quick-access";
import { setStatus } from "@/lib/status";
import { PinToggle } from "@/components/pin-button";
import { PhonePinned } from "@/components/sidebar-quick";
import { usePendingConfirm } from "@/hooks/use-pending-confirm";
import { cn } from "@/lib/utils";
import { assignedToMe, useIdentities } from "@/lib/identities";
import { useRecetteTodo } from "@/routes/recette";

// The project view: one repo's board read as a road map, in panels — what waits for you, the objective,
// the phase in progress, the phases, what no phase has taken. A card is ONE line here; its spec, criteria
// and phase live on its own screen. Derived and read-only (lib/project.ts); polling is the root's.

type Filter = "all" | StepGroup;
const FILTERS: { id: Filter; label: MessageKey; dot: string }[] = [
  { id: "all", label: "project.filter.all", dot: "bg-foreground" },
  { id: "waiting", label: "project.filter.waiting", dot: "bg-brand" },
  { id: "flight", label: "project.filter.flight", dot: "bg-status-working" },
  { id: "todo", label: "project.filter.todo", dot: "bg-muted-foreground" },
  { id: "done", label: "project.filter.done", dot: "bg-status-done" },
];
const FILTER_KEY = "collie-project-filter";

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

const PANEL = "flex flex-col gap-3 rounded-2xl border bg-card/70 p-4";
const LINK = "shrink-0 text-xs font-semibold text-brand";

/** A phase's progress as a thin bar, coloured by what each step is doing. */
function Bar({ steps, className }: { steps: CardView[]; className?: string }) {
  return (
    <div className={cn("flex gap-[3px]", className)} aria-hidden="true">
      {steps.map((s) => (
        <i key={s.id} className={cn("h-[5px] flex-1 rounded-[3px] bg-border", STEP_TONE[s.status])} />
      ))}
    </div>
  );
}

/** An open phase whose every step is done: it only waits for the operator to validate it. */
const toValidate = (p: ProjectPhase) => Boolean(p.phase && !p.phase.closedAt && p.steps.length > 0 && p.done === p.steps.length);
const unfinished = (p: ProjectPhase) => p.steps.some((s) => s.status !== "done");

export function ProjectRoute() {
  const panel = usePanelWidth();
  const t = useT();
  const data = useLoaderData() as ProjectData;
  // The herd, for the phone's pinned list (absent when the page is mounted alone, as in tests).
  const root = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData | undefined;
  const revalidator = useRevalidator();
  const reload = () => void revalidator.revalidate();
  const [params, setParams] = useSearchParams();
  const repo = params.get("repo") ?? loadRepoScope();
  // What the nav's « Projects » entry reopens.
  useEffect(() => {
    if (repo) saveLastProject(repo);
  }, [repo]);
  // « À moi » (ADR 0048 §5): in the URL like the board's `?who=me`, and offered only on a shared repo.
  const identities = useIdentities();
  const shared = Boolean(repo && identities[repo]);
  const mineOnly = params.get("who") === "me";
  const [filtersOpen, setFiltersOpen] = useState(false);
  // The open objective, as the Objective block reads it: the header wears it so goal mode is seen at once.
  const [openGoal, setOpenGoal] = useState<OpenGoal | null>(null);
  const goal = repo ? openGoal : null;
  const pickMine = (mine: boolean) =>
    setParams((p) => (mine ? p.set("who", "me") : p.delete("who"), p), { replace: true, preventScrollReset: true });
  const cards = useMemo(
    () => (repo ? data.cards.filter((c) => c.repoPath === repo) : data.cards).filter((c) => !mineOnly || assignedToMe(c, identities)),
    [data.cards, repo, mineOnly, identities],
  );
  const v = useMemo(() => projectOf(cards, data.phases, data.lots), [cards, data.phases, data.lots]);
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const running = liveLots(data.lots, byId, data.facts);
  const recette = useRecetteTodo(repo);
  // Templates and flows are read once per visit (audit perf #7): the next visit, or a change made here, reads them again.
  useEffect(() => forgetProjectSettled, []);

  const [filter, setFilter] = useState<Filter>(() => {
    const m = store.get();
    return FILTERS.some((f) => f.id === m) ? (m as Filter) : "all";
  });
  // The orchestrator is docked on a wide screen and a sheet on a phone (ADR 0021).
  const [chatOpen, setChatOpen] = useState(false);
  // `chat=1` (an "awaits your decision" tag): open the conversation once, then drop the flag.
  // `draft=` (the Roadmap's « talk it over »): what the operator's message starts with.
  const [chatDraft, setChatDraft] = useState("");
  useEffect(() => {
    if (params.get("chat") !== "1") return;
    setChatOpen(true);
    setChatDraft(params.get("draft") ?? "");
    setParams((p) => (p.delete("chat"), p.delete("draft"), p), { replace: true });
  }, [params, setParams]);
  // Validating a phase (ADR 0025): the section being validated, or the "seal the finished steps" sheet.
  const [validating, setValidating] = useState<ProjectPhase | null>(null);
  // The "validate the finished steps" sheet: all of them, or one old dictation's (cardIds + its title).
  const [sealing, setSealing] = useState<{ count: number; cardIds?: string[]; name?: string } | null>(null);
  // What is unfolded: a phase's settings, the phases opened in the list, the roadmap, the validated phases.
  const [settingsOf, setSettingsOf] = useState<string | null>(null);
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const [roadmapOpen, setRoadmapOpen] = useState(false);
  const [closedOpen, setClosedOpen] = useState(false);
  const [looseLots, setLooseLots] = useState(false);
  // An empty phase (no step, no lot) can go — two taps, in place. The bridge refuses a non-empty one.
  const { pending: deletingArmed, confirm: confirmDelete } = usePendingConfirm();
  const removePhase = async (id: string) => {
    if (!confirmDelete(id)) return;
    try {
      await deletePhase(id);
      forgetProjectSettled();
      reload();
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    }
  };
  const pick = (f: Filter) => {
    setFilter(f);
    store.set(f);
  };
  const counts: Record<Filter, number> = { all: v.total, done: v.done, flight: v.active, waiting: v.waiting, todo: v.todo };
  const shownIn = (s: CardView) => filter === "all" || stepGroup(s) === filter;
  const activePhases = v.phases.filter((p) => p.phase && p.steps.length > 0);
  // The finished steps no phase has taken — in a dictation's section or loose — which an old project folds
  // into its first milestone. This is what `POST /api/phases/seal` files when it is not given a list.
  const unfiled = v.phases.filter((p) => !p.phase).flatMap((p) => p.steps.filter((s) => s.status === "done"));
  const looseDone = unfiled.length;
  // The seal sheet opens on a name the operator can keep or rewrite — never an empty field to fill.
  const milestoneName = (steps: CardView[]) =>
    proposeMilestoneName(steps.map((s) => s.title)) ?? t("project.seal.misc", { date: new Date().toLocaleDateString(getLocale()) });
  // With a phase table, what no phase has taken is one line below the phases; without one, it is the work itself.
  const phased = v.phases.some((p) => p.phase);
  const loose = phased ? v.phases.find((p) => p.key === "loose") : undefined;
  const sections = v.phases.filter((p) => p !== loose);
  // The phase in progress: the one a lot runs in, else the first with work left, else the first to validate.
  const live = new Set(running.map((l) => l.lot.id));
  const current =
    sections.find((p) => p.lots.some((l) => live.has(l.lot.id))) ??
    sections.find((p) => p.phase && unfinished(p)) ??
    sections.find(unfinished) ??
    sections.find(toValidate) ??
    null;
  const deliverablesFold = useStoredFold("project-deliverables", false);
  const deliverables = useMemo(() => recentDeliverables(cards, data.facts), [cards, data.facts]);

  // ── What waits for you: halted lots in one sentence, cards to read, phases to validate, tests to do.
  const lots = v.phases.flatMap((p) => p.lots);
  const halted = lots.filter((pl) => lotState(pl).halted);
  const haltedIds = new Set(halted.map((pl) => pl.lot.id));
  const awaiting = v.awaiting.filter((c) => !c.runId || !haltedIds.has(c.runId));
  const ripe = sections.filter(toValidate);
  const sentence = (reason: string) => {
    const s = haltSentence(reason);
    return "key" in s ? t(s.key) : s.text;
  };

  // A phase's gestures, on its heading: validate it (or seal a dictation's finished steps), its settings.
  const actions = (p: ProjectPhase) => (
    <>
      {p.phase && p.steps.length > 0 && (
        <button type="button" onClick={() => setValidating(p)} className={cn(LINK, "inline-flex items-center gap-1", toValidate(p) && "text-status-done")}>
          {toValidate(p) && <Check aria-hidden="true" className="size-3.5" />}
          {t("project.validate")}
        </button>
      )}
      {!p.phase && repo && p.steps.some((s) => s.status === "done") && (
        <button
          type="button"
          onClick={() => {
            const done = p.steps.filter((s) => s.status === "done");
            setSealing({ count: done.length, cardIds: done.map((s) => s.id), name: p.container?.title ?? milestoneName(done) });
          }}
          aria-label={p.container ? undefined : t("project.seal.aria")}
          className={LINK}
        >
          {p.container ? t("project.validate") : t("project.seal")}
        </button>
      )}
      {p.phase && !p.phase.closedAt && (
        <button type="button" aria-expanded={settingsOf === p.key} onClick={() => setSettingsOf(settingsOf === p.key ? null : p.key)} className={LINK}>
          {t(settingsOf === p.key ? "project.current.hideSettings" : "project.current.settings")}
        </button>
      )}
    </>
  );
  // A phase's body: its settings when unfolded, then its lots and its cards, one line each.
  const body = (p: ProjectPhase) => {
    const visible = p.steps.filter(shownIn);
    return (
      <>
        {settingsOf === p.key && p.phase && !p.phase.closedAt && (
          <div className="flex flex-col gap-2 rounded-xl border border-dashed p-3">
            <PhaseTemplate
              phase={p.phase}
              data={data.templates}
              flows={data.flows}
              onChanged={() => {
                forgetProjectSettled();
                reload();
              }}
            />
            {repo && <RepoFlow repo={repo} flows={data.flows} />}
            {p.steps.length === 0 && p.lots.length === 0 && (
              <button
                type="button"
                onClick={() => void removePhase(p.phase!.id)}
                className={cn(
                  "self-start rounded-full border px-3 py-1 font-mono text-xs font-medium",
                  deletingArmed === p.phase.id ? "border-destructive bg-destructive text-destructive-foreground" : "bg-card/70 hover:border-foreground/25",
                )}
              >
                {deletingArmed === p.phase.id ? t("project.deletePhase.confirm") : t("project.deletePhase")}
              </button>
            )}
          </div>
        )}
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("project.emptyPhase")}</p>
        ) : (
          <PhaseLots
            lots={p.lots}
            steps={visible}
            byId={byId}
            onLaunched={reload}
            renderStep={(s) => <CardRow key={s.id} card={s} hold={lotHold(s, data.lots, data.facts?.[s.id]?.pr?.state === "open")} />}
          />
        )}
      </>
    );
  };
  // What a phase row says is happening: its unfinished lots, else its goal.
  const happening = (p: ProjectPhase) => {
    const ls = p.lots.filter((l) => !lotState(l).finished);
    if (ls.length === 0) return p.goal;
    return ls
      .map((l) => {
        const s = lotState(l);
        return `${l.lot.name ?? t("run.lot")} ${t(s.planned ? "lot.planned" : s.halted ? "lot.halted" : "lot.running")}`;
      })
      .join(", ");
  };
  const allOpen = sections.length > 0 && sections.every((p) => opened.has(p.key));

  const filterChips = (
    <div role="group" aria-label={t("project.filter.aria")} className="flex min-w-0 flex-wrap gap-1.5">
      {(shared || mineOnly) &&
        ([false, true] as const).map((mine) => (
          <button
            key={String(mine)}
            type="button"
            aria-pressed={mineOnly === mine}
            onClick={() => pickMine(mine)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-card/70 px-3 py-1.5 font-mono text-xs font-medium transition-colors",
              mineOnly === mine ? "border-foreground/50 bg-accent" : "hover:border-foreground/25",
              mine && "mr-1.5",
            )}
          >
            {mine ? t("people.toMe") : t("people.everyone")}
          </button>
        ))}
      {FILTERS.filter((f) => f.id === "all" || counts[f.id] > 0).map((f) => (
        <button
          key={f.id}
          type="button"
          aria-pressed={filter === f.id}
          onClick={() => pick(f.id)}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-card/70 px-3 py-1.5 font-mono text-xs font-medium transition-colors",
            filter === f.id ? "border-foreground/50 bg-accent" : "hover:border-foreground/25",
          )}
        >
          {f.id !== "all" && <span className={cn("size-2 rounded-full", f.dot)} />}
          {t(f.label)}
          <span className="tabular-nums text-muted-foreground">{counts[f.id]}</span>
        </button>
      ))}
    </div>
  );
  const filterButton = (
    <button
      type="button"
      onClick={() => setFiltersOpen(true)}
      aria-label={t("project.actions.filter")}
      title={t("project.actions.filter")}
      className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60"
    >
      <ListFilter className="size-4" />
      {(filter !== "all" || mineOnly) && <span className="absolute right-1 top-1 size-2 rounded-full bg-primary" aria-hidden="true" />}
    </button>
  );
  const heading = (title: ReactNode, tail?: ReactNode, sub?: ReactNode) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h2 className="min-w-0 flex-1 text-[15px] font-semibold leading-snug">
        {title}
        {sub && <span className="ml-2 text-[13px] font-normal text-muted-foreground">{sub}</span>}
      </h2>
      {tail}
    </div>
  );

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col lg:max-w-none">
      <AppHeader
        // The title picks the project; the second line is the open objective itself (touch it to reach its
        // block), else the milestone in progress when there is exactly one open phase to name.
        children={
          <RepoTitle
            repos={reposOf(data.cards)}
            subtitle={
              goal ? (
                <GoalLine goal={goal} onClick={() => document.getElementById("goal")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
              ) : activePhases.length === 1 ? (
                activePhases[0]!.title
              ) : undefined
            }
          />
        }
        rightTrail={
          <>
            {repo && <ProjectOpen repo={repo} actions={<MigrateAllHc repo={repo} />} />}
            {repo && <PinToggle target={{ repoPath: repo }} name={repoName(repo)} className="size-9" />}
            <button
              type="button"
              onClick={() => setChatOpen(true)}
              aria-label={t("project.chatOpen")}
              className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border bg-background px-2.5 text-sm font-semibold shadow-xs hover:bg-accent lg:hidden"
            >
              <MessagesSquare className="size-4" />
              {/* Icon-only on a phone: the title beside it is the project picker and needs the room. */}
              <span className="hidden sm:inline">{t("orch.title")}</span>
              {data.orchestrator?.running && <span className="size-2 rounded-full bg-status-done" title={t("project.chatRunning")} aria-hidden="true" />}
            </button>
          </>
        }
      />
      <BoardTabs />
      <h1 className="sr-only">{t("project.title")}</h1>
      <div className="flex min-h-0 flex-1">
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pb-24 pt-5 lg:px-6 lg:pt-6">
            {root && <PhonePinned data={root} />}
            {(halted.length > 0 || awaiting.length > 0 || ripe.length > 0 || recette > 0) && (
              <section aria-label={t("project.todo.title")} className={cn(PANEL, "border-brand/45 shadow-[0_10px_40px_-20px] shadow-brand")}>
                {heading(t("project.todo.title"), undefined, halted.length + awaiting.length + ripe.length || undefined)}
                <ul className="flex flex-col gap-2">
                  {halted.map((pl) => (
                    <li key={pl.lot.id} className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <p className="min-w-0 flex-1 basis-60 text-sm leading-snug">
                        <b className="font-semibold">{t("project.todo.halted", { name: pl.lot.name ?? t("lot.fallbackName") })}</b> {sentence(pl.lot.halted!)}
                      </p>
                      <LotAction pl={pl} byId={byId} onLaunched={reload} label={t("project.todo.resume")} />
                    </li>
                  ))}
                  {awaiting.map((c) => (
                    <li key={c.id} className="flex items-center gap-3">
                      <p className="min-w-0 flex-1 truncate text-sm">
                        <span className="font-medium">« {c.title} »</span> <span className="text-muted-foreground">{CARD_STATUS_LABEL[c.status]}</span>
                      </p>
                      <Link to={cardPath(c.id)} className="shrink-0 rounded-[10px] border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-accent">
                        {t("project.todo.open")}
                      </Link>
                    </li>
                  ))}
                  {ripe.map((p) => (
                    <li key={p.key} className="flex items-center gap-3">
                      <p className="min-w-0 flex-1 truncate text-sm">
                        <span className="font-medium">{p.title}</span> <span className="text-muted-foreground">{t("project.phases.toValidate")}</span>
                      </p>
                      <button type="button" onClick={() => setValidating(p)} className="shrink-0 rounded-[10px] border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-accent">
                        {t("project.validate")}
                      </button>
                    </li>
                  ))}
                </ul>
                {recette > 0 && (
                  <Link to={`/board/recette${repo ? `?repo=${encodeURIComponent(repo)}` : ""}`} className="self-start text-[13px] font-semibold text-brand">
                    {t("project.todo.recette", { count: recette })}
                  </Link>
                )}
              </section>
            )}
            {repo && <GoalPanel repo={repo} titleOf={(id) => byId.get(id)?.title} noOrchestrator={data.orchestrator?.paneId === null} onGoal={setOpenGoal} />}
            {v.total === 0 && v.closedCount === 0 ? (
              <div className="flex flex-col items-center gap-4 px-2 py-16 text-center">
                <p className="text-sm text-muted-foreground">{t(repo ? "project.emptyRepo" : "project.emptyAll")}</p>
                <button
                  type="button"
                  onClick={() => setChatOpen(true)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border bg-background px-3 text-sm font-semibold shadow-xs hover:bg-accent lg:hidden"
                >
                  <MessagesSquare className="size-4" />
                  {t("project.emptyAction")}
                </button>
              </div>
            ) : (
              <>
                {current && (
                  <section id={`phase-${current.key}`} aria-label={current.title || t("project.noPhase")} className={PANEL}>
                    {heading(current.title || t("project.noPhase"), actions(current), t("project.current.tag"))}
                    {current.goal && <p className="-mt-1 text-sm text-muted-foreground">{current.goal}</p>}
                    {body(current)}
                  </section>
                )}

                <section aria-label={t("project.phases.title")} className={cn(PANEL, "gap-0 p-0")}>
                  <div className="p-4 pb-3">
                    {heading(
                      t("project.phases.title"),
                      <span className="flex items-center gap-3">
                        {sections.length > 1 && (
                          <button type="button" onClick={() => setOpened(allOpen ? new Set() : new Set(sections.map((p) => p.key)))} className={LINK}>
                            {t(allOpen ? "project.phases.foldAll" : "project.phases.openAll")}
                          </button>
                        )}
                        {repo && (
                          <button type="button" aria-expanded={roadmapOpen} onClick={() => setRoadmapOpen((o) => !o)} className={LINK}>
                            {t("project.phases.roadmap")}
                          </button>
                        )}
                        {filterButton}
                      </span>,
                    )}
                  </div>
                  {repo && roadmapOpen && (
                    <div className="border-t px-4 py-3">
                      <ProjectRoadmap repo={repo} roadmap={data.roadmap} />
                    </div>
                  )}
                  <ol aria-label={t("project.phases.aria")} className="flex flex-col">
                    {sections.map((p) => {
                      const open = opened.has(p.key);
                      const waits = p.steps.filter((s) => stepGroup(s) === "waiting").length;
                      return (
                        <li key={p.key} className="border-t">
                          <button
                            type="button"
                            aria-expanded={open}
                            onClick={() => setOpened((prev) => (prev.has(p.key) ? (prev.delete(p.key), new Set(prev)) : new Set(prev).add(p.key)))}
                            className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 text-left hover:bg-muted/30 sm:grid-cols-[minmax(0,1fr)_12rem_8rem]"
                          >
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate text-sm font-semibold">
                                {p.title || t("project.noPhase")}
                                {p === current && <span className="ml-2 text-xs font-normal text-muted-foreground">{t("project.current.tag")}</span>}
                              </span>
                              {happening(p) && <span className="truncate text-[13px] text-muted-foreground">{happening(p)}</span>}
                            </span>
                            <span
                              className={cn(
                                "text-right text-xs sm:order-last",
                                waits ? "font-semibold text-brand" : toValidate(p) ? "font-semibold text-status-done" : "text-muted-foreground",
                              )}
                            >
                              {waits ? t("project.phases.waits", { count: waits }) : toValidate(p) ? t("project.phases.toValidate") : ""}
                            </span>
                            {p.steps.length > 0 ? (
                              <span className="col-span-2 flex items-center gap-2 font-mono text-xs tabular-nums text-muted-foreground sm:col-span-1">
                                <Bar steps={p.steps} className="flex-1" />
                                {t("project.phases.of", { done: p.done, total: p.steps.length })}
                              </span>
                            ) : (
                              <span className="col-span-2 text-xs text-muted-foreground sm:col-span-1">{t("project.phases.noStep")}</span>
                            )}
                          </button>
                          {open && (
                            <div className="flex flex-col gap-3 px-4 pb-4">
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">{actions(p)}</div>
                              {body(p)}
                            </div>
                          )}
                        </li>
                      );
                    })}
                    {v.closedCount > 0 && (
                      <li className="border-t">
                        <div className="flex items-center justify-between gap-3 px-4 py-3 text-[13px] text-muted-foreground">
                          <span>
                            {t("project.phases.closedLine", { count: v.closedCount })}, {t("project.phases.delivered", { count: v.deliveredSteps })}
                          </span>
                          <button type="button" aria-expanded={closedOpen} onClick={() => setClosedOpen((o) => !o)} className={LINK}>
                            {t(closedOpen ? "project.hide" : "project.see")}
                          </button>
                        </div>
                        {closedOpen && (
                          <div className="px-4 pb-4">
                            <ClosedPhases closed={v.closed} onReopened={reload} />
                          </div>
                        )}
                      </li>
                    )}
                  </ol>
                  {v.total === 0 && <p className="border-t px-4 py-6 text-center text-sm text-muted-foreground">{t("project.allValidated")}</p>}
                  {/* The way to tidy an old project: the finished steps that sit in no validated phase (old
                      dictations included) are the reason a figure reads 90 % of nothing in particular. */}
                  {repo && looseDone > 0 && (
                    <div aria-label={t("project.unfiled.aria")} role="group" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-4 py-3">
                      <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">{t("project.unfiled", { count: looseDone })}</p>
                      <button type="button" onClick={() => setSealing({ count: looseDone, name: milestoneName(unfiled) })} className={LINK}>
                        {t("project.sealAll")}
                      </button>
                    </div>
                  )}
                </section>

                {loose && loose.steps.length + loose.lots.length > 0 && (
                  <section aria-label={t("project.loose.line", { count: loose.steps.length })} className={cn(PANEL, "py-3")}>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="min-w-0 flex-1 text-sm">{t("project.loose.line", { count: loose.steps.length })}</span>
                      {loose.lots.length > 0 && (
                        <button type="button" aria-expanded={looseLots} onClick={() => setLooseLots((o) => !o)} className={LINK}>
                          {t(looseLots ? "project.hide" : "project.loose.lots")}
                        </button>
                      )}
                      <Link to={`/board?${new URLSearchParams({ ...(repo && { repo }), phase: "none" })}`} className={LINK}>
                        {t("project.loose.open")}
                      </Link>
                    </div>
                    {looseLots && body(loose)}
                  </section>
                )}

                {!repo && <p className="text-sm text-muted-foreground">{t("project.pickRepo")}</p>}
                {/* No open phase to hold the settings: the repo's default flow stays reachable here. */}
                {repo && !sections.some((p) => p.phase) && <RepoFlow repo={repo} flows={data.flows} />}
                {repo && repoName(repo) === "collie-board" && <ExitCriteria />}
                {deliverables.length > 0 && (
                  <Fold title={t("project.fold.deliverables", { count: deliverables.length })} state={deliverablesFold}>
                    <DeliverableLinks items={deliverables} />
                  </Fold>
                )}
              </>
            )}
          </div>
        </main>
        <aside aria-label={t("orch.title")} style={{ width: panel.width }} className="relative hidden shrink-0 flex-col border-l lg:flex">
          <div
            role="separator"
            aria-orientation="vertical"
            onPointerDown={panel.onPointerDown}
            className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none hover:bg-primary/30 active:bg-primary/40"
          />
          <OrchestratorPanel repo={repo} state={data.orchestrator} entries={data.orchestratorEntries ?? []} memory={data.orchestratorMemory} deliverables={deliverables} initialDraft={chatDraft} key={chatDraft} />
        </aside>
      </div>
      {validating && (
        <ValidateSheet
          section={validating}
          targets={v.phases.filter((p) => p.phase && p.key !== validating.key)}
          onClose={() => setValidating(null)}
          onDone={reload}
        />
      )}
      {sealing && repo && (
        <SealSheet repo={repo} count={sealing.count} cardIds={sealing.cardIds} initialName={sealing.name} onClose={() => setSealing(null)} onDone={reload} />
      )}
      <BottomSheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title={t("project.filter.aria")}>
        <div className="flex flex-col gap-4 p-4" onClick={(e) => (e.target as HTMLElement).closest("[aria-pressed]") && setFiltersOpen(false)}>
          {filterChips}
        </div>
      </BottomSheet>
      {/* A definite height, so the thread scrolls INSIDE the sheet and the composer stays pinned: with
          the height left to the content the sheet was half-empty on a short thread and, on a long one,
          scrolled as a whole with the composer below the fold. */}
      <BottomSheet open={chatOpen} onClose={() => setChatOpen(false)} title={t("orch.title")} className="h-[94dvh] max-h-[94dvh]">
        <div className="flex h-full min-h-0 flex-col">
          <OrchestratorPanel repo={repo} state={data.orchestrator} entries={data.orchestratorEntries ?? []} memory={data.orchestratorMemory} deliverables={deliverables} initialDraft={chatDraft} key={chatDraft} onLeave={() => setChatOpen(false)} />
        </div>
      </BottomSheet>
    </div>
  );
}
