import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { ChevronRight, GitPullRequest, RefreshCw } from "lucide-react";

import { Kpi } from "@/components/kpi";
import { Ring } from "@/components/ring";
import { STEP_TONE } from "@/components/project-step";
import { useFold } from "@/components/fold";
import { useT } from "@/i18n";
import { getNotifyLog } from "@/lib/api";
import { boardPath, cardPath, fetchOpenPrs, fetchPhases, fetchUsage, prsPath, projectPath, type CardView, type Phase, type ProviderUsage } from "@/lib/board";
import { herdCounts, type DashboardView, type RepoTile } from "@/lib/dashboard";
import { panePath } from "@/lib/nav";
import { ago, rich } from "@/lib/project-facts";
import type { AgentView, NotifyLogEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

// The home dashboard around the herd triage (agent-list.tsx stays the heart of the screen). Every
// figure here is derived from the cards the loader already polls, or fetched ONCE on mount (quota, PRs,
// activity) — the same posture as the quota gauge it grew from: no timer of its own.

const sectionTitle = "text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground";

/** The hero: one sentence, and the herd as a ring — rouge = needs you, bleu = working, gris = idle. */
export function HomeHero({ agents }: { agents: AgentView[] }) {
  const t = useT();
  const [needs, working, idle] = herdCounts(agents);
  const parts = [
    agents.length === 0 ? t("home.sum.none") : needs > 0 ? t("home.sum.needs", { count: needs }) : t("home.sum.calm"),
    working > 0 && t("home.sum.working", { count: working }),
  ].filter(Boolean);
  return (
    <header className="flex items-center justify-between gap-5">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-[0.14em] text-status-done">
          <span className="size-[7px] rounded-full bg-current shadow-[0_0_10px_currentColor]" />
          {t("home.eyebrow")}
        </div>
        <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-muted-foreground">{rich(`${parts.join(", ")}.`)}</p>
      </div>
      <Ring
        arcs={[
          { value: needs, className: "stroke-status-blocked" },
          { value: working, className: "stroke-status-working" },
          { value: idle, className: "stroke-status-idle" },
        ]}
        total={agents.length}
        label={t("home.ring.aria", { needs, working, idle })}
        className="size-28 sm:size-36"
      >
        <span className="text-4xl font-bold leading-none tabular-nums">{agents.length}</span>
        <span className="text-[11px] text-muted-foreground">{t("home.ring.agents")}</span>
      </Ring>
    </header>
  );
}

export function HomeKpis({ dash }: { dash: DashboardView }) {
  const t = useT();
  // Each figure leads to the board filtered on its status(es); the section title names the object
  // (cards, not panes — the hero above counts panes).
  const to = (status: string) => `${boardPath()}?${new URLSearchParams({ status })}`;
  return (
    <section className="flex flex-col gap-2.5" aria-label={t("home.kpi.title")}>
      <h2 className={sectionTitle}>{t("home.kpi.title")}</h2>
      <div className="grid grid-cols-4 gap-2 [&>*]:min-w-0">
        <Kpi compact to={to("review")} label={t("home.kpi.review")} value={dash.review} tone="bg-brand" />
        <Kpi compact to={to("blocked,orphaned")} label={t("home.kpi.stuck")} value={dash.stuck} tone="bg-status-blocked" />
        <Kpi compact to={to("ready")} label={t("home.kpi.ready")} value={dash.ready} tone="bg-muted-foreground" />
        <Kpi compact to={to("done")} label={t("home.kpi.delivered")} value={dash.delivered} tone="bg-status-done" />
      </div>
    </section>
  );
}

// The card blocks' stand-ins while a cold start's cards are on the wire (audit perf #3): the same boxes,
// so nothing below moves when the figures land. Still for people who asked for less motion.
const pulse = "animate-pulse rounded bg-muted motion-reduce:animate-none";

export function HomeKpisSkeleton() {
  const t = useT();
  return (
    <section className="flex flex-col gap-2.5" aria-label={t("home.kpi.title")} aria-busy="true" data-testid="kpis-skeleton">
      <h2 className={sectionTitle}>{t("home.kpi.title")}</h2>
      <div className="grid grid-cols-4 gap-2 [&>*]:min-w-0">
        {(["home.kpi.review", "home.kpi.stuck", "home.kpi.ready", "home.kpi.delivered"] as const).map((k) => (
          <div key={k} className="rounded-xl border bg-card/70 p-2.5">
            <span className="block truncate text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t(k)}</span>
            {/* text-2xl leading-none: the figure is exactly h-6. */}
            <div className={cn("mt-1.5 h-6 w-8", pulse)} />
          </div>
        ))}
      </div>
    </section>
  );
}

/** ponytail: three tiles of one phase each, the usual fold — a herd of one repo shrinks once, at arrival. */
export function ProjectTilesSkeleton() {
  const t = useT();
  return (
    <section className="flex flex-col gap-2.5" aria-label={t("home.projects")} aria-busy="true" data-testid="projects-skeleton">
      <h2 className={sectionTitle}>{t("home.projects")}</h2>
      <div className="grid gap-2.5 [&>*]:min-w-0 sm:grid-cols-2 lg:grid-cols-1">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex h-[7.25rem] flex-col gap-2.5 rounded-xl border bg-card/70 p-3.5">
            <div className={cn("h-4 w-1/3", pulse)} />
            <div className={cn("h-3 w-2/3", pulse)} />
            <div className={cn("h-[5px] w-full", pulse)} />
          </div>
        ))}
      </div>
    </section>
  );
}

/** A card block whose cold-start fetch failed: said in its own slot, the triage untouched. */
export function CardsError({ label }: { label: string }) {
  const t = useT();
  return (
    <section className="flex flex-col gap-2.5" aria-label={label}>
      <h2 className={sectionTitle}>{label}</h2>
      <p role="alert" className="text-sm text-status-blocked">{t("home.cards.error")}</p>
    </section>
  );
}

/** One segment per step while they fit; past that, one per status sized by its count — 150 slivers read as noise. */
const BAR_MAX = 24;
function PhaseBar({ steps }: { steps: CardView[] }) {
  const parts =
    steps.length <= BAR_MAX
      ? steps.map((s) => ({ key: s.id, tone: STEP_TONE[s.status], n: 1 }))
      : (["done", "working", "starting", "review", "blocked", "orphaned", "ready", "backlog"] as const)
          .map((st) => ({ key: st, tone: STEP_TONE[st], n: steps.filter((s) => s.status === st).length }))
          .filter((x) => x.n > 0);
  return (
    <div className="flex gap-[3px] overflow-hidden" aria-hidden="true">
      {parts.map((x) => (
        <i key={x.key} style={{ flexGrow: x.n }} className={cn("h-[5px] min-w-[3px] basis-0 rounded-[3px] bg-border", x.tone)} />
      ))}
    </div>
  );
}

/** Phases a tile lists before « +n »: a repo with five in flight must not take a screen on a phone. */
const PHASES_SHOWN = 2;

function ProjectTile({ repo }: { repo: RepoTile }) {
  const t = useT();
  return (
    <Link
      to={projectPath(repo.path)}
      className="flex flex-col gap-2.5 rounded-xl border bg-card/70 p-3.5 transition-[transform,border-color] duration-300 hover:-translate-y-0.5 hover:border-foreground/25"
    >
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold">{repo.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{ago(repo.updatedAt)}</span>
      </div>
      {repo.current.slice(0, PHASES_SHOWN).map((p) => (
        <div key={p.key} className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{p.title || t("home.project.loose")}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{p.done} / {p.steps.length}</span>
          </div>
          <PhaseBar steps={p.steps} />
        </div>
      ))}
      <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        {repo.current.length > PHASES_SHOWN && <span>+{repo.current.length - PHASES_SHOWN}</span>}
        {repo.current.length === 0 && <span>{t("home.project.idle", { count: repo.closedCount })}</span>}
        {repo.active > 0 && <span className="text-status-working">{t("home.project.flight", { count: repo.active })}</span>}
        {repo.waiting > 0 && <span className="font-semibold text-brand">{t("home.project.waiting", { count: repo.waiting })}</span>}
      </div>
    </Link>
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

export function ProjectTiles({ repos }: { repos: RepoTile[] }) {
  const t = useT();
  const { shown, toggle } = useFold(repos, 3);
  if (repos.length === 0) return null;
  return (
    <section className="flex flex-col gap-2.5" aria-label={t("home.projects")}>
      <h2 className={sectionTitle}>{t("home.projects")}</h2>
      <div className="grid gap-2.5 [&>*]:min-w-0 sm:grid-cols-2 lg:grid-cols-1">
        {shown.map((r) => (
          <ProjectTile key={r.path} repo={r} />
        ))}
      </div>
      {toggle}
    </section>
  );
}

const CRITICAL = 85;
const tone = (pct: number) => (pct >= CRITICAL ? "blocked" : pct >= 70 ? "working" : "done");

function ProviderRing({ p }: { p: ProviderUsage }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // The limit that decides is the one closest to its wall — it fills the ring; the rest are the tap's.
  const worst = p.limits.reduce((hi, l) => Math.max(hi, l.percent), 0);
  return (
    <div className="flex flex-col items-center gap-2">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex flex-col items-center gap-1.5">
        <Ring
          arcs={[{ value: worst, className: `stroke-status-${tone(worst)}` }]}
          total={100}
          label={t("home.usage.aria", { label: p.label, percent: worst })}
          className="size-24"
        >
          <span className="text-2xl font-bold leading-none tabular-nums">{worst}%</span>
        </Ring>
        <span className="text-xs text-muted-foreground">{worst >= CRITICAL ? t("home.usage.atLimit") : p.label}</span>
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
  );
}

/** One ring per provider the bridge can read (Claude today). Fetched on mount; nothing when there is no reading. */
export function UsageRings() {
  const t = useT();
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
    <section className="flex flex-col gap-2.5" aria-label={t("home.usage")}>
      <div className="flex items-center">
        <h2 className={cn(sectionTitle, "flex-1")}>{t("home.usage")}</h2>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={busy}
          aria-label={t("home.usage.refresh")}
          className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
        </button>
      </div>
      <div className="flex flex-wrap justify-around gap-4 rounded-xl border bg-card/70 p-3.5">
        {providers.map((p) => (
          <ProviderRing key={p.id} p={p} />
        ))}
      </div>
    </section>
  );
}

const VERB = {
  blocked: "home.activity.blocked",
  done: "home.activity.done",
  stalled: "home.activity.stalled",
  ready: "home.activity.ready",
  note: "home.activity.note",
} as const;

/** Open PRs, read once on arrival — nothing at zero or on an older bridge. */
export function OpenPrs() {
  const t = useT();
  const [prs, setPrs] = useState(0);
  useEffect(() => {
    void fetchOpenPrs().then((r) => setPrs(r.prs.length), () => {});
  }, []);
  if (prs === 0) return null;
  return (
    <Link to={prsPath()} className="flex items-center gap-2 rounded-xl border bg-card/70 p-3.5 text-sm hover:border-foreground/25">
      <GitPullRequest className="size-4 text-muted-foreground" />
      <span className="flex-1">{t("home.prs")}</span>
      <b className="tabular-nums">{prs}</b>
      <ChevronRight className="size-4 text-muted-foreground" />
    </Link>
  );
}

/** The last few alerts (the bell's log), read once on arrival. Degrades to nothing on an older bridge. */
export function HomeActivity({ session }: { session: string | undefined }) {
  const t = useT();
  const [log, setLog] = useState<NotifyLogEntry[] | null>(null);
  useEffect(() => {
    let live = true; // the reply can land after unmount (or test teardown)
    void getNotifyLog().then((e) => live && setLog(e.slice(0, 5)), () => live && setLog([]));
    return () => { live = false; };
  }, []);
  return (
    <section className="flex flex-col gap-2.5" aria-label={t("home.activity")}>
      <h2 className={sectionTitle}>{t("home.activity")}</h2>
      {log === null ? (
        <div aria-hidden className="h-9 rounded-md bg-muted/50 motion-safe:animate-pulse" />
      ) : log.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("home.activity.empty")}</p>
      ) : (
        <ul className="flex flex-col">
          {log.map((e) => {
            const to = e.paneId ? panePath(e.paneId, session) : e.cardId ? cardPath(e.cardId) : null;
            const body = (
              <>
                <span className="min-w-0 flex-1 truncate">
                  <b className="font-semibold">{e.cardTitle ?? e.workspaceLabel ?? e.agent ?? ""}</b> {t(VERB[e.status])}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{ago(e.ts)}</span>
              </>
            );
            return (
              <li key={e.id}>
                {to ? (
                  <Link to={to} className="flex min-h-9 items-baseline gap-2 text-sm hover:text-foreground">
                    {body}
                  </Link>
                ) : (
                  <div className="flex min-h-9 items-baseline gap-2 text-sm">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
