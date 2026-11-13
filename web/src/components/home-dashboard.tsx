import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ChevronRight, GitPullRequest, RefreshCw, Target } from "lucide-react";

import { Ring } from "@/components/ring";
import { STEP_TONE } from "@/components/project-step";
import { FoldToggle } from "@/components/fold";
import { firstSentence, isOpenGoal, type OpenGoal, type OpenGoalStatus } from "@/components/goal-chip";
import { budgetPct } from "@/components/goal-panel";
import { sectionTitle } from "@/components/agent-list";
import { useT } from "@/i18n";
import { boardPath, fetchGoals, fetchLots, fetchOpenPrs, fetchPhases, fetchUsage, prsPath, projectPath, type CardView, type Lot, type Phase, type ProviderUsage } from "@/lib/board";
import { byLot, herdCounts, tileLot, type DashboardView, type RepoTile, type TileLot } from "@/lib/dashboard";
import { fetchRecette } from "@/lib/recette";
import { engineName, type MachineEngine, type PeerHerdView } from "@/lib/peers";
import type { AgentView, BridgeStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

// The home: one sentence and the herd's ring, the cards waiting as a line of links, the agents at work,
// the projects in progress, the machines and the quota. Every figure is derived from the snapshot or the
// cards the loader already polls, or fetched ONCE on mount (quota, PRs) — no timer of its own.

/** The title: who waits for you and how many work, as a sentence; the herd at work as the ring beside it. */
export function HomeHero({ agents, cards }: { agents: AgentView[]; cards: ReactNode }) {
  const t = useT();
  const [needs, working] = herdCounts(agents);
  const title =
    agents.length === 0
      ? t("home.title.none")
      : `${needs > 0 ? t("home.title.needs", { count: needs }) : t("home.title.calm")}, ${working > 0 ? t("home.title.working", { count: working }) : t("home.title.allIdle")}`;
  return (
    <header className="flex items-center gap-5 sm:gap-7">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] sm:text-3xl">{title}</h1>
        {cards}
      </div>
      {agents.length > 0 && (
        <Ring
          arcs={[{ value: working, className: "stroke-status-working" }]}
          total={agents.length}
          label={t("home.ring.working", { working, total: agents.length })}
          className="size-[72px] sm:size-24"
        >
          <span className="text-xl font-semibold leading-none tabular-nums sm:text-2xl">{working}</span>
          <span className="text-[11px] text-muted-foreground">{t("home.ring.of", { total: agents.length })}</span>
        </Ring>
      )}
    </header>
  );
}

/** « 2 cartes à relire, 5 bloquées, 2 prêtes à lancer. », each figure a link to the board filtered on it. */
export function CardsLine({ dash }: { dash: DashboardView }) {
  const t = useT();
  const to = (status: string) => `${boardPath()}?${new URLSearchParams({ status })}`;
  const parts = [
    { n: dash.review, key: "home.cards.review", status: "review" },
    { n: dash.stuck, key: "home.cards.stuck", status: "blocked,orphaned" },
    { n: dash.ready, key: "home.cards.ready", status: "ready" },
  ] as const;
  const shown = parts.filter((p) => p.n > 0);
  return (
    <p className="text-[15px] text-muted-foreground">
      {shown.length === 0
        ? t("home.cards.none")
        : shown.map((p, i) => (
            <span key={p.status}>
              {i > 0 && ", "}
              <Link to={to(p.status)} className="underline-offset-2 hover:text-foreground hover:underline">
                {t(p.key, { count: p.n })}
              </Link>
              {i === shown.length - 1 && "."}
            </span>
          ))}
    </p>
  );
}

// The card blocks' stand-ins while a cold start's cards are on the wire (audit perf #3): the same boxes,
// so nothing below moves when the figures land. Still for people who asked for less motion.
const pulse = "animate-pulse rounded bg-muted motion-reduce:animate-none";

export function CardsLineSkeleton() {
  return <div aria-busy="true" data-testid="kpis-skeleton" className={cn("h-[22px] w-64 max-w-full", pulse)} />;
}

export function ProjectRowsSkeleton() {
  const t = useT();
  return (
    <section className="flex flex-col gap-1.5" aria-label={t("home.projects.current")} aria-busy="true" data-testid="projects-skeleton">
      <h2 className={cn(sectionTitle, "mb-1")}>{t("home.projects.current")}</h2>
      {[0, 1, 2].map((i) => (
        <div key={i} className={cn("h-16", pulse, "rounded-xl")} />
      ))}
    </section>
  );
}

/** A card block whose cold-start fetch failed: said in its own slot, the agents untouched. */
export function CardsError({ label }: { label?: string }) {
  const t = useT();
  const msg = <p role="alert" className="text-sm text-destructive">{t("home.cards.error")}</p>;
  return label ? (
    <section className="flex flex-col gap-1.5" aria-label={label}>
      <h2 className={sectionTitle}>{label}</h2>
      {msg}
    </section>
  ) : (
    msg
  );
}

/** One segment per step while they fit; past that, one per status sized by its count — 150 slivers read as noise. */
const BAR_MAX = 24;
export function PhaseBar({ steps, thin }: { steps: CardView[]; thin?: boolean }) {
  const parts =
    steps.length <= BAR_MAX
      ? steps.map((s) => ({ key: s.id, tone: STEP_TONE[s.status], n: 1 }))
      : (["done", "working", "starting", "review", "blocked", "orphaned", "ready", "backlog"] as const)
          .map((st) => ({ key: st, tone: STEP_TONE[st], n: steps.filter((s) => s.status === st).length }))
          .filter((x) => x.n > 0);
  return (
    <div className="flex gap-[3px] overflow-hidden" aria-hidden="true">
      {parts.map((x) => (
        <i key={x.key} style={{ flexGrow: x.n }} className={cn(thin ? "h-[3px] min-w-[3px] basis-0 rounded-sm bg-border" : "h-[5px] min-w-[3px] basis-0 rounded-sm bg-border", x.tone)} />
      ))}
    </div>
  );
}

/** Each repo's phase table, read once per set of repos — not on the poll: a milestone changes by hand.
 *  One request for every repo (audit perf #11), grouped here by `repoPath`. */
export function useRepoPhases(paths: string[]): Record<string, Phase[]> {
  const [phases, setPhases] = useState<Record<string, Phase[]>>({});
  const key = paths.join("\n");
  useEffect(() => {
    if (!key) return setPhases({});
    const ac = new AbortController();
    void fetchPhases(undefined, ac.signal).then((r) => r.phases, () => [] as Phase[]).then((all) => {
      if (ac.signal.aborted) return;
      const byRepo: Record<string, Phase[]> = Object.fromEntries(key.split("\n").map((p) => [p, []]));
      for (const ph of all) byRepo[ph.repoPath]?.push(ph);
      setPhases(byRepo);
    });
    return () => ac.abort();
  }, [key]);
  return phases;
}

/** Each repo's lead lot (tileLot), in one request for every repo. Re-read when `stamp` moves — the
 *  cards the poll already brings — so a lot's progress follows the board without a timer of its own. */
export function useRepoLots(paths: string[], stamp: string): Record<string, TileLot | null> {
  const [lots, setLots] = useState<Record<string, TileLot | null>>({});
  const key = paths.join("\n");
  useEffect(() => {
    if (!key) return setLots({});
    const ac = new AbortController();
    void fetchLots(undefined, ac.signal).then((r) => r.runs, () => [] as Lot[]).then((all) => {
      if (ac.signal.aborted) return;
      setLots(Object.fromEntries(key.split("\n").map((p) => [p, tileLot(all.filter((l) => l.repoPath === p))])));
    });
    return () => ac.abort();
  }, [key, stamp]);
  return lots;
}

/** Each repo's « to test » count (recette entries never tried), in one request for every repo — read
 *  with the lots, on the same `stamp`, so a delivery shows without a timer of its own. */
export function useRepoToTest(paths: string[], stamp: string): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const key = paths.join("\n");
  useEffect(() => {
    if (!key) return setCounts({});
    const ac = new AbortController();
    void fetchRecette(null, ac.signal).then((r) => r.groups.flatMap((g) => g.entries), () => []).then((all) => {
      if (ac.signal.aborted) return;
      const out: Record<string, number> = {};
      for (const e of all) if (e.state === "todo" && e.repoPath) out[e.repoPath] = (out[e.repoPath] ?? 0) + 1;
      setCounts(out);
    });
    return () => ac.abort();
  }, [key, stamp]);
  return counts;
}

/** Each repo's open objective status (ADR 0056), in one request for every repo, on the lots' `stamp`. */
export function useRepoGoals(paths: string[], stamp: string): Record<string, HomeGoal> {
  const [goals, setGoals] = useState<Record<string, HomeGoal>>({});
  const key = paths.join("\n");
  useEffect(() => {
    if (!key) return setGoals({});
    const ac = new AbortController();
    void fetchGoals(undefined, ac.signal).then((r) => r.goals, () => []).then((all) => {
      if (ac.signal.aborted) return;
      const out: Record<string, HomeGoal> = {};
      for (const g of all)
        if (isOpenGoal(g.status)) out[g.repoPath] = { status: g.status, text: g.text, lots: g.spent.lots, maxLots: g.budget.maxLots, pct: budgetPct(g) };
      setGoals(out);
    });
    return () => ac.abort();
  }, [key, stamp]);
  return goals;
}

/** What a project row says of its open objective: its words, and how much of its budget is gone. */
export interface HomeGoal extends OpenGoal {
  lots: number;
  maxLots: number;
  pct: number;
}
const GOAL_TONE: Record<OpenGoalStatus, string> = { active: "text-status-done", paused: "text-status-idle", claimed: "text-status-blocked" };

function GoalCell({ goal, lot }: { goal?: HomeGoal; lot?: TileLot | null }) {
  const t = useT();
  if (!goal)
    return (
      // A phone's card says nothing of an absent objective: the phase line below is enough.
      <span className="hidden min-w-0 flex-col text-sm text-muted-foreground sm:flex">
        <span>{t("home.project.noGoal")}</span>
        {lot && lot.finishedAt === null && <span className="hidden truncate sm:block">{t("home.project.lot", { name: lot.name ?? t("home.lot.unnamed") })}</span>}
      </span>
    );
  return (
    <span className="flex min-w-0 items-start gap-2 text-sm" data-goal={goal.status}>
      <Target className={cn("mt-0.5 size-[15px] shrink-0", GOAL_TONE[goal.status])} aria-hidden="true" />
      <span className="flex min-w-0 flex-col">
        <span className="sr-only">{t("goal.title")} :</span>
        <span className="truncate">{firstSentence(goal.text)}</span>
        <span className="hidden text-muted-foreground sm:block">{t("home.project.goalBudget", { spent: goal.lots, max: goal.maxLots, pct: goal.pct })}</span>
      </span>
    </span>
  );
}

function PhaseCell({ repo }: { repo: RepoTile }) {
  const t = useT();
  const p = repo.current[0];
  if (!p) return <span className="text-sm text-muted-foreground">{t("home.project.nothing")}</span>;
  return (
    <span className="flex min-w-0 flex-col gap-1.5 text-sm">
      <span className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate">{p.title || t("home.project.loose")}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{t("home.project.steps", { done: p.done, total: p.steps.length })}</span>
      </span>
      <PhaseBar steps={p.steps} />
    </span>
  );
}

function Activity({ repo, toTest, brief }: { repo: RepoTile; toTest: number; brief?: boolean }) {
  const t = useT();
  const at = repo.active > 0 ? <span className="text-status-working">{t("home.project.working", { count: repo.active })}</span> : <span className="text-muted-foreground">{t("home.project.resting")}</span>;
  if (brief) return repo.active > 0 ? at : null;
  return (
    <span className="flex flex-col gap-0.5 text-sm">
      {at}
      {repo.waiting > 0 && <span className="font-medium text-status-blocked">{t("home.project.forYou", { count: repo.waiting })}</span>}
      {repo.blocked > 0 && <span className="font-medium text-destructive">{t("home.project.blocked", { count: repo.blocked })}</span>}
      {toTest > 0 && <span className="font-medium text-status-blocked">{t("recette.chip", { count: toTest })}</span>}
    </span>
  );
}

/** One project, one line of aligned columns on a wide screen; a small stacked card on a phone. */
function ProjectRow({ repo, lot, toTest = 0, goal }: { repo: RepoTile; lot?: TileLot | null; toTest?: number; goal?: HomeGoal }) {
  return (
    <Link
      to={projectPath(repo.path)}
      className="flex flex-col gap-2 rounded-xl border bg-card shadow-(--shadow-panel) p-3.5 transition-colors hover:border-foreground/25 sm:grid sm:min-h-16 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)_minmax(0,13rem)_7rem] sm:items-center sm:gap-x-5 sm:px-4 sm:py-2.5"
    >
      <span className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold">{repo.name}</span>
        <span className="shrink-0 text-sm sm:hidden">
          <Activity repo={repo} toTest={toTest} brief />
        </span>
      </span>
      <GoalCell goal={goal} lot={lot} />
      <PhaseCell repo={repo} />
      <span className="hidden sm:block">
        <Activity repo={repo} toTest={toTest} />
      </span>
    </Link>
  );
}

const ROWS = 5;

/** « Projets en cours »: the ones where something runs first, five rows, the rest a tap away. */
export function ProjectRows({ repos: all, lots = {}, toTest = {}, goals = {} }: { repos: RepoTile[]; lots?: Record<string, TileLot | null>; toTest?: Record<string, number>; goals?: Record<string, HomeGoal> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const running = (r: RepoTile) => r.active > 0 || lots[r.path]?.finishedAt === null;
  // sort is stable: within each half, byLot's order (running lots, then the day's, then dashboardOf's).
  const repos = byLot(all, lots).sort((a, b) => Number(running(b)) - Number(running(a)));
  if (repos.length === 0) return null;
  return (
    <section className="flex flex-col gap-1.5" aria-label={t("home.projects.current")}>
      <h2 className={cn(sectionTitle, "mb-1")}>{t("home.projects.current")}</h2>
      {(open ? repos : repos.slice(0, ROWS)).map((r) => (
        <ProjectRow key={r.path} repo={r} lot={lots[r.path]} toTest={toTest[r.path]} goal={goals[r.path]} />
      ))}
      {repos.length > ROWS && <FoldToggle open={open} onClick={() => setOpen(!open)} label={t("home.projects.all", { count: repos.length })} lessLabel={t("fold.less")} />}
    </section>
  );
}

interface Machine {
  name: string;
  state: "up" | "down" | "pending";
  engine: string | null;
  agents: number;
}

/** This machine first, then every paired peer, each with its state — from the snapshot, no request. */
export function machinesOf(local: { bridge: BridgeStatus | undefined; engine: MachineEngine | null | undefined; agents: number }, peers: readonly PeerHerdView[], here: string): Machine[] {
  return [
    { name: here, state: local.bridge === "connected" ? "up" : local.bridge === undefined ? "pending" : "down", engine: engineName(local.engine), agents: local.agents },
    ...peers.map((p): Machine => ({ name: p.peer, state: p.state === "connected" ? "up" : p.state === "pending" ? "pending" : "down", engine: engineName(p.engine), agents: p.agents.length })),
  ];
}

const MACHINE_DOT = { up: "bg-status-done", pending: "bg-status-idle", down: "border-2 border-destructive" } as const;

/** « Machines »: a list in the side column of a wide screen, a line of dots at the foot of a phone's. */
export function Machines({ machines, strip, className }: { machines: Machine[]; strip?: boolean; className?: string }) {
  const t = useT();
  const dot = (m: Machine) => <span aria-hidden className={cn("size-2 shrink-0 rounded-full", MACHINE_DOT[m.state])} />;
  const note = (m: Machine) =>
    m.state === "down" ? t("home.machines.down") : m.state === "pending" ? t("home.machines.pending") : t("home.machines.agents", { engine: m.engine ?? "herdr", count: m.agents });
  if (strip)
    return (
      <section className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 text-sm", className)} aria-label={t("home.machines")}>
        <h2 className={sectionTitle}>{t("home.machines")}</h2>
        {machines.map((m) => (
          <span key={m.name} title={note(m)} className={cn("flex items-center gap-1.5", m.state === "down" && "text-destructive")}>
            {dot(m)}
            {m.name}
            {m.state === "down" && <span className="sr-only">{note(m)}</span>}
          </span>
        ))}
      </section>
    );
  return (
    <section className={cn("flex flex-col", className)} aria-label={t("home.machines")}>
      <h2 className={cn(sectionTitle, "mb-1.5")}>{t("home.machines")}</h2>
      {machines.map((m) => (
        <div key={m.name} className="flex min-h-9 items-center gap-2.5">
          {dot(m)}
          <span className="max-w-[60%] shrink-0 truncate">{m.name}</span>
          <span className={cn("min-w-0 flex-1 truncate text-right text-sm", m.state === "down" ? "text-destructive" : "text-muted-foreground")}>{note(m)}</span>
        </div>
      ))}
    </section>
  );
}

const CRITICAL = 85;
const tone = (pct: number) => (pct >= CRITICAL ? "blocked" : pct >= 70 ? "working" : "done");

function ProviderQuota({ p, onRefresh, busy }: { p: ProviderUsage; onRefresh: () => void; busy: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // The limit that decides is the one closest to its wall — it fills the ring; the rest are the tap's.
  const worst = p.limits.reduce((hi, l) => (l.percent > (hi?.percent ?? -1) ? l : hi), p.limits[0]);
  const pct = worst?.percent ?? 0;
  return (
    <section className="flex flex-col gap-1.5" aria-label={t("home.usage.account", { label: p.label })}>
      <div className="flex items-center">
        <h2 className={cn(sectionTitle, "flex-1")}>{t("home.usage.account", { label: p.label })}</h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy}
          aria-label={t("home.usage.refresh")}
          className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
        </button>
      </div>
      <div className="flex flex-col gap-2 rounded-xl border bg-card shadow-(--shadow-panel) p-3.5">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-4 text-left">
          <Ring arcs={[{ value: pct, className: `stroke-status-${tone(pct)}` }]} total={100} label={t("home.usage.aria", { label: p.label, percent: pct })} className="size-16">
            <span className="text-sm font-semibold leading-none tabular-nums">{pct}%</span>
          </Ring>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate font-medium">{pct >= CRITICAL ? t("home.usage.atLimit") : (worst?.label.replace(/^Current\s+/i, "") ?? p.label)}</span>
            {worst?.resetsAt && <span className="truncate text-sm text-muted-foreground">{t("home.usage.resets", { when: worst.resetsAt })}</span>}
          </span>
        </button>
        {open && (
          <ul className="w-full space-y-1 text-xs text-muted-foreground">
            {p.limits.map((l) => (
              <li key={l.label} className="flex items-baseline gap-2">
                <span className="truncate">{l.label.replace(/^Current\s+/i, "")}</span>
                <span className="tabular-nums text-foreground">{l.percent}%</span>
                {l.resetsAt && <span className="ml-auto truncate text-[11px]">{t("home.usage.resets", { when: l.resetsAt })}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** « Ton compte Claude »: one quota per provider the bridge can read. Fetched on mount; nothing without a reading. */
export function UsageRings() {
  const [providers, setProviders] = useState<ProviderUsage[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (refresh: boolean, signal?: AbortSignal) => {
    setBusy(true);
    try {
      const r = await fetchUsage(refresh, signal);
      if (!signal?.aborted) setProviders(r.providers ?? (r.usage ? [{ id: "claude", label: "Claude Code", ...r.usage }] : []));
    } catch {
      /* Optional: a failed read leaves whatever was there. */
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }, []);
  useEffect(() => {
    const ac = new AbortController();
    void load(false, ac.signal);
    return () => ac.abort();
  }, [load]);
  if (providers.length === 0) return null;
  return (
    <>
      {providers.map((p) => (
        <ProviderQuota key={p.id} p={p} busy={busy} onRefresh={() => void load(true)} />
      ))}
    </>
  );
}

/** « PR ouvertes 27 » on one line, read once on arrival — nothing at zero or on an older bridge. */
export function OpenPrs() {
  const t = useT();
  const [prs, setPrs] = useState(0);
  useEffect(() => {
    void fetchOpenPrs().then((r) => setPrs(r.prs.length), () => {});
  }, []);
  if (prs === 0) return null;
  return (
    <Link to={prsPath()} className="flex min-h-9 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
      <GitPullRequest className="size-4" />
      <span className="flex-1">{t("home.prs")}</span>
      <b className="font-semibold tabular-nums text-foreground">{prs}</b>
      <ChevronRight className="size-4" />
    </Link>
  );
}
