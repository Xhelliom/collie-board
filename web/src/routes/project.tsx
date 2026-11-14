import { GoalPanel } from "@/components/goal-panel";
import { StatusSignal } from "@/components/status-signal";
import { GoalLine, type OpenGoal } from "@/components/goal-chip";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLoaderData, useRevalidator, useSearchParams } from "react-router";

import { Check, ListFilter, MessagesSquare, Settings2, Trash2 } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { BoardTabs, RepoTitle } from "@/components/board-tabs";
import { ExitCriteria } from "@/components/exit-criteria";
import { BottomSheet } from "@/components/ui/sheet";
import { buttonVariants, Button } from "@/components/ui/button";
import { usePanelWidth } from "@/hooks/use-panel-width";
import { OrchestratorPanel } from "@/components/orchestrator-panel";
import { ScopeCost } from "@/components/scope-cost";
import { ProjectOpen } from "@/components/project-open";
import { MigrateAllHc } from "@/components/migrate-hc-button";
import { MachineSwitcher } from "@/components/machine-switcher";
import { DeliverableLinks, recentDeliverables } from "@/components/card-deliverables";
import { PhaseTemplate } from "@/components/phase-template";
import { LotAction, PhaseLots, lotState } from "@/components/project-lots";
import { MENU_ITEM, MoreActions } from "@/components/project-more";
import { CardRow } from "@/components/project-row";
import { Ring } from "@/components/ring";
import { liveLots } from "@/lib/lot-live";
import { ProjectRoadmap } from "@/components/project-roadmap";
import { RepoFlow } from "@/components/repo-flow";
import { ProjectShowcase } from "@/components/project-showcase";
import { ClosedPhases, SealSheet, ValidateSheet } from "@/components/project-milestones";
import { boardErrorMessage, CARD_STATUS_LABEL, cardPath, deletePhase, loadRepoScope, orchestratorPath, repoName, reposOf, type CardView } from "@/lib/board";
import { forgetProjectSettled, type ProjectData } from "@/lib/board-loaders";
import { getLocale, useT, type MessageKey } from "@/i18n";
import { projectOf, proposeMilestoneName, stepGroup, type ProjectPhase, type StepGroup } from "@/lib/project";
import { lotHold } from "@/lib/lot-hold";
import { haltSentence } from "@/lib/halt-sentence";
import { saveLastProject } from "@/lib/quick-access";
import { setStatus } from "@/lib/status";
import { PinMenuItem, PinToggle } from "@/components/pin-button";
import { usePendingConfirm } from "@/hooks/use-pending-confirm";
import { cn } from "@/lib/utils";
import { assignedToMe, useIdentities } from "@/lib/identities";
import { useRecetteTodo } from "@/routes/recette";

// The project view (v2, 13/11), top to bottom: what waits for you — each with its button —, the phase in
// progress with its ring, its figures and its lots labelled ready / next / empty, the phases to come (open
// ones, then the roadmap's not split yet), and what to tidy, each line saying why. A card is ONE line;
// its spec lives on its own screen. Derived and read-only (lib/project.ts); polling is the root's.

type Filter = "all" | StepGroup;
const FILTERS: { id: Filter; label: MessageKey; dot: string }[] = [
  { id: "all", label: "project.filter.all", dot: "bg-foreground" },
  { id: "waiting", label: "project.filter.waiting", dot: "bg-status-blocked" },
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

const PANEL = "flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-(--shadow-2)";
const LINK = cn(buttonVariants({ variant: "secondary", size: "sm" }), "shrink-0 text-xs");
/** A line's own button: 44 px on a phone. */
const ACT = "h-11 shrink-0 rounded-sm px-3 text-sm font-semibold sm:h-8";
const LINE = "flex flex-wrap items-center gap-x-3 gap-y-2";
const TEXT = "min-w-0 flex-1 basis-60 text-sm leading-snug";
const TAG = "rounded-sm px-2 py-0.5 text-xs font-semibold";

/** An open phase whose every step is done: it only waits for the operator to validate it. */
const toValidate = (p: ProjectPhase) => Boolean(p.phase && !p.phase.closedAt && p.steps.length > 0 && p.done === p.steps.length);
const unfinished = (p: ProjectPhase) => p.steps.some((s) => s.status !== "done");
const tally = (steps: CardView[]) => {
  const n: Record<StepGroup, number> = { done: 0, flight: 0, waiting: 0, todo: 0 };
  for (const s of steps) n[stepGroup(s)]++;
  return n;
};
/** The Cards tab's statuses for each of the four figures. */
const STATUSES: Record<StepGroup, string> = { done: "done", flight: "working,starting", waiting: "blocked,review,orphaned", todo: "ready,backlog" };

/** The phase's progress: the one ring of the app, done then in flight, « x of y » under the percentage. */
function PhaseRing({ p }: { p: ProjectPhase }) {
  const t = useT();
  const total = p.steps.length;
  const active = p.steps.filter((s) => stepGroup(s) === "flight").length;
  const pct = total ? Math.round((100 * p.done) / total) : 0;
  return (
    <Ring
      arcs={[
        { value: p.done, className: "stroke-status-done" },
        { value: active, className: "stroke-status-working" },
      ]}
      total={total}
      label={t("project.ring.aria", { done: p.done, total })}
      className="size-[84px] sm:size-[104px]"
    >
      <span className="text-xl font-semibold leading-none sm:text-2xl">{pct} %</span>
      <span className="text-[11px] text-muted-foreground">{t("project.phases.of", { done: p.done, total })}</span>
    </Ring>
  );
}

export function ProjectRoute() {
  const panel = usePanelWidth();
  const t = useT();
  const data = useLoaderData() as ProjectData;
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
  // The open objective as the Objective panel reads it — `undefined` until it has read it.
  const [openGoal, setOpenGoal] = useState<OpenGoal | null | undefined>(undefined);
  const onGoal = useCallback((g: OpenGoal | null) => setOpenGoal(g), []);
  const [goalEdit, setGoalEdit] = useState(0);
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
  // `draft=` (the Roadmap's « talk it over », « Ask for the split » here): what the operator's message starts with.
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
  // What is unfolded: a phase's settings, the phases opened below, the roadmap, the history, the rest.
  const [settingsOf, setSettingsOf] = useState<string | null>(null);
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const [roadmapOpen, setRoadmapOpen] = useState(false);
  const [closedOpen, setClosedOpen] = useState(false);
  const [looseLots, setLooseLots] = useState(false);
  const [deliverablesOpen, setDeliverablesOpen] = useState(false);
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
  // The finished steps no phase has taken — in a dictation's section or loose — which an old project folds
  // into its first milestone. This is what `POST /api/phases/seal` files when it is not given a list.
  const unfiled = v.phases.filter((p) => !p.phase).flatMap((p) => p.steps.filter((s) => s.status === "done"));
  const looseDone = unfiled.length;
  // The seal sheet opens on a name the operator can keep or rewrite — never an empty field to fill.
  const milestoneName = (steps: CardView[]) =>
    proposeMilestoneName(steps.map((s) => s.title)) ?? t("project.seal.misc", { date: new Date().toLocaleDateString(getLocale()) });
  // With a phase table, what no phase has taken is one line to tidy; without one, it is the work itself.
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
  const following = sections.filter((p) => p !== current);
  const deliverables = useMemo(() => recentDeliverables(cards, data.facts), [cards, data.facts]);

  // ── What waits for you: halted lots in one sentence, the lot ready to go, cards to read, phases to validate.
  const lots = v.phases.flatMap((p) => p.lots);
  const halted = lots.filter((pl) => lotState(pl).halted);
  const haltedIds = new Set(halted.map((pl) => pl.lot.id));
  const awaiting = v.awaiting.filter((c) => !c.runId || !haltedIds.has(c.runId));
  const ripe = sections.filter(toValidate);
  // Nothing runs and nothing is halted: the phase's next lot is what waits for the operator's go.
  const ready =
    running.length === 0 && halted.length === 0 ? (current?.lots.find((pl) => lotState(pl).planned && pl.cards.length > 0) ?? null) : null;
  const waits = halted.length + awaiting.length + ripe.length + (ready ? 1 : 0);
  const sentence = (reason: string) => {
    const s = haltSentence(reason);
    return "key" in s ? t(s.key) : s.text;
  };
  const q = repo ? `?repo=${encodeURIComponent(repo)}` : "";

  // ── The phases to come: the roadmap's planned items no phase stands for yet, to split.
  const roadmapItems = repo && data.roadmap ? data.roadmap.items : [];
  const toSplit = roadmapItems.filter((i) => i.status === "planned" && !data.phases.some((p) => p.repoPath === repo && p.roadmapItemId === i.id));
  // The exit criteria of herdr 0.9 (ADR 0052 §8) belong to the item that leaves it, this repo's own.
  const exitHere = Boolean(repo && repoName(repo) === "collie-board");
  const leaving = (i: { name: string; goal: string; condition?: string }) => /herdr\s*0[.,]9/i.test(`${i.name} ${i.goal} ${i.condition ?? ""}`);
  const exitItem = exitHere ? toSplit.find(leaving) : undefined;

  // A phase's main gesture: validate it (or seal a dictation's finished steps). On a phone it joins the « ⋯ ».
  const sealOf = (p: ProjectPhase) => () => {
    const done = p.steps.filter((s) => s.status === "done");
    setSealing({ count: done.length, cardIds: done.map((s) => s.id), name: p.container?.title ?? milestoneName(done) });
  };
  const canSeal = (p: ProjectPhase) => !p.phase && Boolean(repo) && p.steps.some((s) => s.status === "done");
  const phaseButton = (p: ProjectPhase) =>
    p.phase && p.steps.length > 0 ? (
      <Button variant="outline" onClick={() => setValidating(p)} className={cn(ACT, "max-sm:hidden")}>
        {toValidate(p) && <Check aria-hidden="true" className="size-3.5" />}
        {t("project.validate")}
      </Button>
    ) : canSeal(p) ? (
      <Button variant="outline" onClick={sealOf(p)} aria-label={p.container ? undefined : t("project.seal.aria")} className={cn(ACT, "max-sm:hidden")}>
        {p.container ? t("project.validate") : t("project.seal")}
      </Button>
    ) : null;
  // Its rarer gestures, under « ⋯ »: the main one again (a phone has no room for it), settings, filter, delete.
  const phaseMenu = (p: ProjectPhase) => (
    <MoreActions label={t("project.current.more", { name: p.title || t("project.noPhase") })}>
      {p.phase && p.steps.length > 0 && (
        <button type="button" role="menuitem" onClick={() => setValidating(p)} className={cn(MENU_ITEM, "sm:hidden")}>
          <Check className="size-4 text-muted-foreground" />
          {t("project.validate")}
        </button>
      )}
      {canSeal(p) && (
        <button type="button" role="menuitem" onClick={sealOf(p)} className={cn(MENU_ITEM, "sm:hidden")}>
          <Check className="size-4 text-muted-foreground" />
          {p.container ? t("project.validate") : t("project.seal")}
        </button>
      )}
      {p.phase && !p.phase.closedAt && (
        <button type="button" role="menuitem" aria-expanded={settingsOf === p.key} onClick={() => setSettingsOf(settingsOf === p.key ? null : p.key)} className={MENU_ITEM}>
          <Settings2 className="size-4 text-muted-foreground" />
          {t(settingsOf === p.key ? "project.current.hideSettings" : "project.current.settings")}
        </button>
      )}
      <button type="button" role="menuitem" onClick={() => setFiltersOpen(true)} className={MENU_ITEM}>
        <ListFilter className="size-4 text-muted-foreground" />
        {t("project.actions.filter")}
      </button>
      {p.phase && p.steps.length === 0 && p.lots.length === 0 && (
        <button type="button" role="menuitem" data-keep-open onClick={() => void removePhase(p.phase!.id)} className={cn(MENU_ITEM, "text-destructive")}>
          <Trash2 className="size-4" />
          {deletingArmed === p.phase.id ? t("project.deletePhase.confirm") : t("project.deletePhase")}
        </button>
      )}
    </MoreActions>
  );
  // A phase's body: its settings when unfolded, then its lots and its cards, one line each.
  const body = (p: ProjectPhase) => {
    const visible = p.steps.filter(shownIn);
    return (
      <>
        {repo && p.phase && <ScopeCost repo={repo} phaseId={p.phase.id} className="px-1" />}
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
          </div>
        )}
        {visible.length === 0 && p.lots.every((pl) => pl.cards.length > 0) ? (
          <p className="text-sm text-muted-foreground">{t("project.emptyPhase")}</p>
        ) : (
          <PhaseLots
            lots={p.lots}
            steps={visible}
            byId={byId}
            onLaunched={reload}
            renderStep={(s, _inLot, note) => (
              <CardRow key={s.id} card={s} note={note} hold={lotHold(s, data.lots, data.facts?.[s.id]?.pr?.state === "open")} />
            )}
          />
        )}
      </>
    );
  };
  // The phase in progress's figures, each one the Cards tab filtered on it (and the acceptance list).
  const figures = (p: ProjectPhase) => {
    const n = tally(p.steps);
    const base = { ...(repo && { repo }), ...(p.phase && { phase: p.phase.id }) };
    const to = (g: StepGroup) => `/board?${new URLSearchParams({ ...base, status: STATUSES[g], ...(g === "done" && { done: "all" }) })}`;
    const cell = "flex min-h-11 min-w-0 flex-col justify-center rounded-lg hover:bg-muted/40 sm:px-1";
    return (
      <div role="group" aria-label={t("project.count.aria")} className="grid grid-cols-5 gap-1 sm:flex sm:gap-5">
        {(["done", "flight", "waiting", "todo"] as const).map((g) => (
          <Link key={g} to={to(g)} aria-label={`${n[g]} ${t(`project.count.${g}`)}`} className={cell}>
            <span className={cn("text-lg font-semibold leading-tight sm:text-xl", g === "waiting" && n[g] > 0 && "text-status-blocked")}>{n[g]}</span>
            <span className="text-xs leading-tight text-muted-foreground">{t(`project.count.${g}`)}</span>
          </Link>
        ))}
        <Link to={`/board/recette${q}`} aria-label={`${recette} ${t("project.count.test")}`} className={cell}>
          <span className={cn("text-lg font-semibold leading-tight sm:text-xl", recette > 0 && "text-status-blocked")}>{recette}</span>
          <span className="text-xs leading-tight text-muted-foreground">{t("project.count.test")}</span>
        </Link>
      </div>
    );
  };

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
              "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-sm border bg-card/70 px-3 py-1.5 text-xs font-medium transition-colors",
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
            "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-sm border bg-card/70 px-3 py-1.5 text-xs font-medium transition-colors",
            filter === f.id ? "border-foreground/50 bg-accent" : "hover:border-foreground/25",
          )}
        >
          {f.id !== "all" && <span className={cn("size-2 rounded-full", f.dot)} />}
          {t(f.label)}
          <span className="text-muted-foreground">{counts[f.id]}</span>
        </button>
      ))}
    </div>
  );
  const heading = (title: ReactNode, tail?: ReactNode, sub?: ReactNode) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h2 className="min-w-0 flex-1 text-[15px] font-semibold leading-snug">
        {title}
        {sub !== undefined && <span className="ml-2 text-[13px] font-normal text-muted-foreground">{sub}</span>}
      </h2>
      {tail}
    </div>
  );
  const nextTag = (p: ProjectPhase) =>
    toValidate(p) ? (
      <span className={cn(TAG, "bg-status-done/15 text-status-done")}>{t("project.next.tag.validate")}</span>
    ) : p.steps.length + p.lots.length > 0 ? (
      <span className={cn(TAG, "bg-status-done/15 text-status-done")}>{t("project.next.tag.ready")}</span>
    ) : (
      <span className={cn(TAG, "bg-muted text-muted-foreground")}>{t("project.next.tag.cut")}</span>
    );
  const askSplit = (name: string) =>
    repo && (
      <Link to={orchestratorPath(repo, t("project.next.askDraft", { name }))} className={cn(ACT, "inline-flex items-center rounded-sm border bg-background shadow-xs hover:bg-accent")}>
        {t("project.next.ask")}
      </Link>
    );

  // ── What to tidy: each line says why it matters, and carries its button.
  const tidy: { key: string; text: string; action: ReactNode; below?: ReactNode }[] = [];
  if (repo && looseDone > 0)
    tidy.push({
      key: "unfiled",
      text: t("project.tidy.unfiled", { count: looseDone }),
      action: (
        <Button variant="outline" className={ACT} onClick={() => setSealing({ count: looseDone, name: milestoneName(unfiled) })}>
          {t("project.tidy.milestone")}
        </Button>
      ),
    });
  if (loose && loose.steps.length + loose.lots.length > 0)
    tidy.push({
      key: "loose",
      text: t("project.tidy.loose", { count: loose.steps.length }),
      action: (
        <span className="flex items-center gap-2">
          <Link
            to={`/board?${new URLSearchParams({ ...(repo && { repo }), phase: "none" })}`}
            className={cn(ACT, "inline-flex items-center rounded-sm border bg-background shadow-xs hover:bg-accent")}
          >
            {t("project.tidy.sort")}
          </Link>
          {loose.lots.length > 0 && (
            <MoreActions label={t("project.tidy.looseMore")}>
              <button type="button" role="menuitem" aria-expanded={looseLots} onClick={() => setLooseLots((o) => !o)} className={MENU_ITEM}>
                {t(looseLots ? "project.hide" : "project.loose.lots")}
              </button>
            </MoreActions>
          )}
        </span>
      ),
      below: looseLots && body(loose),
    });
  if (repo && goal === null)
    tidy.push({
      key: "goal",
      text: t("project.tidy.noGoal"),
      action: (
        <Button variant="outline" className={ACT} onClick={() => setGoalEdit((n) => n + 1)}>
          {t("project.tidy.setGoal")}
        </Button>
      ),
    });
  if (deliverables.length > 0)
    tidy.push({
      key: "deliverables",
      text: t("project.tidy.deliverables", { count: deliverables.length }),
      action: (
        <Button variant="outline" className={ACT} aria-expanded={deliverablesOpen} onClick={() => setDeliverablesOpen((o) => !o)}>
          {t(deliverablesOpen ? "project.hide" : "project.see")}
        </Button>
      ),
      below: deliverablesOpen && <DeliverableLinks items={deliverables} />,
    });

  const doneLine = (
    <>
      {t("project.doneLine", { phases: t("project.phases.closedLine", { count: v.closedCount }), steps: t("project.phases.delivered", { count: v.deliveredSteps }) })}{" "}
      <button type="button" aria-expanded={closedOpen} onClick={() => setClosedOpen((o) => !o)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "ml-1 align-baseline")}>
        {t("project.history")}
      </button>
    </>
  );

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col lg:max-w-none">
      <AppHeader
        machineOnPhone={false}
        // The title picks the project; under it, what is already done (and the history behind it), else the
        // open objective itself.
        children={
          <RepoTitle
            repos={reposOf(data.cards)}
            subtitle={
              v.closedCount > 0 ? (
                // On a phone the header truncates: the same line opens the page instead (below).
                <span className="max-sm:hidden">{doneLine}</span>
              ) : goal ? (
                <GoalLine goal={goal} onClick={() => document.getElementById("goal")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
              ) : undefined
            }
          />
        }
        rightTrail={
          <>
            <button
              type="button"
              onClick={() => setChatOpen(true)}
              aria-label={t("project.chatOpen")}
              className="inline-flex h-11 items-center gap-1.5 rounded-sm border bg-background px-2.5 text-sm font-semibold shadow-xs hover:bg-accent sm:h-9 lg:hidden"
            >
              <MessagesSquare className="size-4 max-sm:hidden" />
              {t("orch.title")}
              {data.orchestrator?.running && <StatusSignal status="working" label={t("project.chatRunning")} />}
            </button>
            {repo && (
              <ProjectOpen
                repo={repo}
                actions={
                  <>
                    <MigrateAllHc repo={repo} />
                    {/* On a phone the pin and the machine join the menu: the header keeps the project, the
                        orchestrator and the bell. */}
                    <PinMenuItem target={{ repoPath: repo }} name={repoName(repo)} className="sm:hidden" />
                    <span className="flex flex-col sm:hidden">
                      <MachineSwitcher variant="menu" />
                    </span>
                  </>
                }
              />
            )}
            {repo && <PinToggle target={{ repoPath: repo }} name={repoName(repo)} className="size-9 max-sm:hidden" />}
          </>
        }
      />
      <BoardTabs counts={{ recette }} />
      <h1 className="sr-only">{t("project.title")}</h1>
      <div className="flex min-h-0 flex-1">
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pb-24 pt-5 lg:px-6 lg:pt-6">
            {repo && <ProjectShowcase repo={repo} />}
            {repo && <ScopeCost repo={repo} className="-my-2 px-1" />}
            {v.closedCount > 0 && <p className="-mb-2 -mt-2 px-1 text-[13px] text-muted-foreground sm:hidden">{doneLine}</p>}
            {closedOpen && (
              <section aria-label={t("project.closed.title")} className={PANEL}>
                {heading(
                  t("project.closed.title"),
                  <button type="button" onClick={() => setClosedOpen(false)} className={LINK}>
                    {t("project.hide")}
                  </button>,
                )}
                <ClosedPhases closed={v.closed} onReopened={reload} />
              </section>
            )}

            {/* 1. What waits for you — each thing with its own button; nothing: one line, not a panel. */}
            {waits > 0 || recette > 0 ? (
              <section aria-label={t("project.todo.title")} className={cn(PANEL, "border-status-blocked")}>
                {heading(t("project.todo.title"), undefined, waits ? <span className="font-semibold text-status-blocked">{waits}</span> : undefined)}
                {waits > 0 && (
                  <ul className="flex flex-col gap-2.5">
                    {halted.map((pl) => (
                      <li key={pl.lot.id} className={LINE}>
                        <p className={TEXT}>
                          <b className="font-semibold">{t("project.todo.halted", { name: pl.lot.name ?? t("lot.fallbackName") })}</b> {sentence(pl.lot.halted!)}
                        </p>
                        <LotAction pl={pl} byId={byId} onLaunched={reload} label={t("project.todo.resume")} />
                      </li>
                    ))}
                    {ready && (
                      <li className={LINE}>
                        <p className={TEXT}>
                          <b className="font-semibold">{t("project.todo.ready", { name: ready.lot.name ?? t("lot.fallbackName") })}</b>{" "}
                          {[t("lot.cards", { count: ready.cards.length }), ready.lot.maxParallel === 1 ? t("lot.oneAtATime") : null].filter(Boolean).join(", ")}.{" "}
                          {t("project.todo.nothingElse")}
                        </p>
                        <LotAction pl={ready} byId={byId} onLaunched={reload} />
                      </li>
                    )}
                    {awaiting.map((c) => (
                      <li key={c.id} className={LINE}>
                        <p className={TEXT}>
                          <span className="font-medium">« {c.title} »</span> <span className="text-muted-foreground">{CARD_STATUS_LABEL[c.status]}</span>
                        </p>
                        <Link to={cardPath(c.id)} className={cn(ACT, "inline-flex items-center rounded-sm border bg-background hover:bg-accent")}>
                          {t("project.todo.open")}
                        </Link>
                      </li>
                    ))}
                    {ripe.map((p) => (
                      <li key={p.key} className={LINE}>
                        <p className={TEXT}>
                          <span className="font-medium">{p.title}</span> <span className="text-muted-foreground">{t("project.phases.toValidate")}</span>
                        </p>
                        <Button variant="success" className={ACT} onClick={() => setValidating(p)}>
                          {t("project.validate")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {recette > 0 && (
                  <Link to={`/board/recette${q}`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "self-start text-[13px]")}>
                    {t("project.todo.recette", { count: recette })}
                  </Link>
                )}
              </section>
            ) : (
              repo && v.total > 0 && <p className="px-1 text-sm text-muted-foreground">{t("project.todo.none")}</p>
            )}

            {v.total === 0 && v.closedCount === 0 ? (
              <div className="flex flex-col items-center gap-4 px-2 py-16 text-center">
                <p className="text-sm text-muted-foreground">{t(repo ? "project.emptyRepo" : "project.emptyAll")}</p>
                <button
                  type="button"
                  onClick={() => setChatOpen(true)}
                  className="inline-flex h-11 items-center gap-1.5 rounded-sm border bg-background px-3 text-sm font-semibold shadow-xs hover:bg-accent lg:hidden"
                >
                  <MessagesSquare className="size-4" />
                  {t("project.emptyAction")}
                </button>
              </div>
            ) : (
              <>
                {/* 2. The phase in progress: its ring, its gestures, its figures, then its lots in order. */}
                {current ? (
                  <section id={`phase-${current.key}`} aria-label={current.title || t("project.noPhase")} className={cn(PANEL, "gap-4")}>
                    {/* One grid: on a phone the goal and the figures run under the ring, beside it on a wide screen. */}
                    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-3 sm:gap-x-5">
                      <div className="sm:row-span-3 sm:self-center">
                        <PhaseRing p={current} />
                      </div>
                      <div className="flex items-start gap-2">
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="text-xs text-muted-foreground">{t("project.current.label")}</span>
                          <h2 className="text-[17px] font-semibold leading-snug">{current.title || t("project.noPhase")}</h2>
                        </div>
                        {phaseButton(current)}
                        {phaseMenu(current)}
                      </div>
                      {current.goal && <p className="col-span-2 text-sm leading-snug text-muted-foreground sm:col-span-1 sm:col-start-2">{current.goal}</p>}
                      <div className="col-span-2 sm:col-span-1 sm:col-start-2">{figures(current)}</div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-x-3">
                        <h3 className="min-w-0 flex-1 text-[13px] font-medium text-muted-foreground">{t("project.current.lots")}</h3>
                        {(filter !== "all" || mineOnly) && (
                          <button
                            type="button"
                            onClick={() => {
                              pick("all");
                              pickMine(false);
                            }}
                            className={cn(LINK, "min-h-11 sm:min-h-0")}
                          >
                            {t("project.filter.clear")}
                          </button>
                        )}
                      </div>
                      {body(current)}
                    </div>
                  </section>
                ) : (
                  v.total === 0 && <p className="px-1 text-sm text-muted-foreground">{t("project.allValidated")}</p>
                )}

                {repo && (
                  <GoalPanel
                    repo={repo}
                    titleOf={(id) => byId.get(id)?.title}
                    noOrchestrator={data.orchestrator?.paneId === null}
                    onGoal={onGoal}
                    quietWhenEmpty
                    editSignal={goalEdit}
                  />
                )}

                {/* 3. The phases to come: the open ones, then the roadmap's not split into lots yet. */}
                {(following.length > 0 || toSplit.length > 0 || exitHere || (repo && data.roadmap)) && (
                  <section aria-label={t("project.next.title")} className={PANEL}>
                    {heading(
                      t("project.next.title"),
                      <span className="flex items-center gap-2">
                        {repo && (
                          <Link to={`/board/roadmap${q}`} className={cn(LINK, "inline-flex min-h-11 items-center sm:min-h-0")}>
                            {t("project.next.roadmap")}
                          </Link>
                        )}
                        <MoreActions label={t("project.next.more")}>
                          {following.length > 1 && (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => setOpened(following.every((p) => opened.has(p.key)) ? new Set() : new Set(following.map((p) => p.key)))}
                              className={MENU_ITEM}
                            >
                              {t(following.every((p) => opened.has(p.key)) ? "project.phases.foldAll" : "project.phases.openAll")}
                            </button>
                          )}
                          {repo && (
                            <button type="button" role="menuitem" aria-expanded={roadmapOpen} onClick={() => setRoadmapOpen((o) => !o)} className={MENU_ITEM}>
                              {t(roadmapOpen ? "project.next.summaryHide" : "project.next.summary")}
                            </button>
                          )}
                          <button type="button" role="menuitem" onClick={() => setFiltersOpen(true)} className={MENU_ITEM}>
                            <ListFilter className="size-4 text-muted-foreground" />
                            {t("project.actions.filter")}
                          </button>
                        </MoreActions>
                      </span>,
                    )}
                    {repo && roadmapOpen && <ProjectRoadmap repo={repo} roadmap={data.roadmap} />}
                    <ul className="flex flex-col gap-2">
                      {following.map((p) => {
                        const open = opened.has(p.key);
                        return (
                          <li key={p.key} aria-label={p.title || t("project.noPhase")} className="flex flex-col gap-3 rounded-sm bg-card px-3 py-2">
                            <div className={LINE}>
                              {nextTag(p)}
                              <span className={TEXT}>
                                <b className="font-semibold">{p.title || t("project.noPhase")}</b>{" "}
                                <span className="text-muted-foreground">
                                  {p.steps.length + p.lots.length > 0
                                    ? `${t("project.next.lots", { count: p.lots.length })}, ${t("lot.cards", { count: p.steps.length })}`
                                    : t("project.next.noLot")}
                                </span>
                              </span>
                              <Button
                                variant="outline"
                                className={ACT}
                                aria-expanded={open}
                                onClick={() => setOpened((prev) => (prev.has(p.key) ? (prev.delete(p.key), new Set(prev)) : new Set(prev).add(p.key)))}
                              >
                                {t(open ? "project.hide" : "project.next.seeLots")}
                              </Button>
                            </div>
                            {open && (
                              <div className="flex flex-col gap-3 pb-1">
                                <div className="flex items-start gap-2">
                                  <p className="min-w-0 flex-1 text-sm text-muted-foreground">{p.goal}</p>
                                  {phaseButton(p)}
                                  {phaseMenu(p)}
                                </div>
                                {body(p)}
                              </div>
                            )}
                          </li>
                        );
                      })}
                      {toSplit.map((i) => (
                        <li key={i.id} aria-label={i.name} className="flex flex-col gap-2 rounded-xl border border-dashed px-3 py-2">
                          <div className={LINE}>
                            <span className={cn(TAG, "bg-muted text-muted-foreground")}>{t("project.next.tag.cut")}</span>
                            <span className={TEXT}>
                              <b className="font-semibold">{i.name}</b>{" "}
                              <span className="text-muted-foreground">
                                {i.condition ? t("project.next.waitsFor", { text: i.condition }) : t("project.next.noLot")}
                              </span>
                            </span>
                            {askSplit(i.name)}
                          </div>
                          {i.goal && <p className="text-[13px] text-muted-foreground">{i.goal}</p>}
                          {i === exitItem && <ExitCriteria />}
                        </li>
                      ))}
                      {exitHere && !exitItem && (
                        <li aria-label={t("project.next.exit")} className="flex flex-col gap-2 rounded-xl border border-dashed px-3 py-2">
                          <div className={LINE}>
                            <span className={cn(TAG, "bg-muted text-muted-foreground")}>{t("project.next.tag.cut")}</span>
                            <b className={cn(TEXT, "font-semibold")}>{t("project.next.exit")}</b>
                            {askSplit(t("project.next.exit"))}
                          </div>
                          <ExitCriteria />
                        </li>
                      )}
                    </ul>
                  </section>
                )}

                {/* 4. To tidy, nothing urgent: each line says why, and carries its button. */}
                {tidy.length > 0 && (
                  <section aria-label={t("project.tidy.title")} className={cn(PANEL, "bg-card/40")}>
                    {heading(t("project.tidy.title"), undefined, t("project.tidy.sub"))}
                    <ul className="flex flex-col gap-2.5">
                      {tidy.map((l) => (
                        <li key={l.key} className="flex flex-col gap-2">
                          <div className={LINE}>
                            <p className={TEXT}>{l.text}</p>
                            {l.action}
                          </div>
                          {l.below}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {!repo && <p className="text-sm text-muted-foreground">{t("project.pickRepo")}</p>}
                {/* No open phase to hold the settings: the repo's default flow stays reachable here. */}
                {repo && !sections.some((p) => p.phase) && <RepoFlow repo={repo} flows={data.flows} />}
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
