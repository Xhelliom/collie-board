import { useEffect, useState } from "react";
import { Link, useLoaderData, useSearchParams } from "react-router";
import { Check, ChevronDown, CircleDashed, CircleHelp, ListChecks, RotateCcw, Search, SkipForward, Sparkles, X, Images } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { BoardTabs, RepoTitle } from "@/components/board-tabs";
import { Entry, FOCUS, MOTION, PrLink, STATE_TONE } from "@/components/recette-entry";
import { RecetteSession, type SessionDevice } from "@/components/recette-session";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { SectionLabel } from "@/components/ui/section-label";
import { getLocale, useT } from "@/i18n";
import { boardErrorMessage, deliverableUrl, loadSort, repoName, saveSort, sortOf, type CardSort } from "@/lib/board";
import { assignedToMe, useIdentities } from "@/lib/identities";
import { openLightbox } from "@/lib/lightbox";
import { ago } from "@/lib/project-facts";
import {
  byDelivery,
  dayMark,
  fetchRecette,
  isPending,
  loadGrouping,
  matchesQuery,
  recetteCounts,
  saveGrouping,
  type Grouping,
  type RecetteEntry,
  type RecetteGroup,
} from "@/lib/recette";
import { setStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

// The recette: a timeline of what was delivered, newest first — one entry per capability (a merged
// card), its captures, its steps to check by hand. « À vérifier » keeps what still waits; « Tout
// l'historique » keeps the validated ones too, folded in green: the page is also the project's history.

const SESSION_DEVICES = ["all", "desktop", "phone"] as const;

export function RecetteRoute() {
  const t = useT();
  const loaded = useLoaderData() as { repo: string | null; groups: RecetteGroup[] };
  const [groups, setGroups] = useState(loaded.groups);
  useEffect(() => setGroups(loaded.groups), [loaded]);
  const { repo } = loaded;
  // `phase=<id>` (the Roadmap's « what was delivered »): that phase only, validated entries included.
  // `session=<device>` (+ `step=<card>/<step>`): the one-by-one session, in the URL so « Aller voir » comes back to it.
  const [params, setParams] = useSearchParams();
  const phaseId = params.get("phase");
  const sessionRaw = params.get("session");
  const session = SESSION_DEVICES.find((d) => d === sessionRaw) ?? null;
  const phaseName = phaseId ? groups.flatMap((g) => g.entries).find((e) => e.phaseId === phaseId)?.phase : null;
  const [everything, setEverything] = useState(!!phaseId);
  const [mineOnly, setMineOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [grouping, setGrouping] = useState(loadGrouping);
  // Same remembered choice as the board's: one device, one sort.
  const [sort, setSort] = useState(loadSort);
  const pickSort = (next: CardSort | null) => {
    setSort(next);
    saveSort(next);
  };
  const identities = useIdentities();

  const counts = recetteCounts(groups.flatMap((g) => g.entries));
  const hasShared = groups.some((g) => g.entries.some((e) => e.repoPath && identities[e.repoPath]));
  const hasBusiness = groups.some((g) => g.entries.some((e) => sortOf(e) === "business"));
  const keep = (e: RecetteEntry, all: boolean) =>
    (all || isPending(e)) &&
    (!phaseId || e.phaseId === phaseId) &&
    matchesQuery(e, query) &&
    (!mineOnly || assignedToMe(e, identities)) &&
    (!sort || sortOf(e) === sort);
  const shown = groups.map((g) => ({ ...g, entries: g.entries.filter((e) => keep(e, everything)) })).filter((g) => g.entries.length > 0);
  const flat = shown.flatMap((g) => g.entries).sort((a, b) => b.deliveredAt - a.deliveredAt);
  // The newest delivery still waiting opens; the older ones read as one line each.
  const openId = flat.find(isPending)?.cardId;
  const gallery = flat.flatMap((e) => e.shots.map((s) => deliverableUrl(e.cardId, s)));
  // The session walks what is still to check under the same filters, whatever the history switch says.
  const toCheck = groups.flatMap((g) => g.entries).filter((e) => keep(e, false)).sort((a, b) => b.deliveredAt - a.deliveredAt);
  const pickGrouping = (g: Grouping) => {
    setGrouping(g);
    saveGrouping(g);
  };
  const setParam = (key: string, value: string | null) =>
    setParams((p) => (value === null ? p.delete(key) : p.set(key, value), p), { replace: key !== "session" || value === null ? true : false });

  async function refresh() {
    try {
      setGroups((await fetchRecette(repo)).groups);
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    }
  }

  const entry = (e: RecetteEntry) => <Entry key={e.cardId} entry={e} defaultOpen={e.cardId === openId} onChange={refresh} />;

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col lg:max-w-none">
      <AppHeader children={<RepoTitle repos={repo ? [{ path: repo, name: repoName(repo) }] : []} subtitle={t("recette.count", { count: counts.todo })} />} />
      <BoardTabs />

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 pb-24 lg:p-5">
        <div className="flex w-full max-w-5xl flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h1 className="text-lg font-semibold lg:text-xl">{t(everything ? "recette.headingAll" : "recette.heading")}</h1>
              <p className="text-sm text-muted-foreground">{t("recette.summary", { count: flat.length, steps: flat.reduce((n, e) => n + e.steps.length, 0) })}</p>
            </div>
            {toCheck.some((e) => e.steps.some((s) => !s.verdict)) && (
              <Button variant="brand" className="rounded-[10px]" onClick={() => setParam("session", "all")}>
                <ListChecks aria-hidden />
                {t("recette.oneByOne")}
              </Button>
            )}
          </div>
          <Counter counts={counts} />
          <Help />
          <div className="flex flex-wrap items-center gap-2">
            {phaseId && <Chip label={`✕ ${phaseName ?? t("recette.filter.phase")}`} active onClick={() => setParam("phase", null)} />}
            <Chip label={t("recette.filter.todo")} active={!everything} onClick={() => setEverything(false)} />
            <Chip label={t("recette.filter.all")} active={everything} onClick={() => setEverything(true)} />
            {(hasShared || mineOnly) && <Chip label={t("people.toMe")} active={mineOnly} onClick={() => setMineOnly(!mineOnly)} />}
            {(hasBusiness || sort) && (
              <>
                <span className="mx-1 h-5 w-px bg-border" />
                <Chip label={t("filter.code")} active={sort === "code"} onClick={() => pickSort(sort === "code" ? null : "code")} />
                <Chip label={t("filter.business")} active={sort === "business"} onClick={() => pickSort(sort === "business" ? null : "business")} />
              </>
            )}
            <span className="mx-1 h-5 w-px bg-border" />
            <Chip label={t("recette.group.timeline")} active={grouping === "timeline"} onClick={() => pickGrouping("timeline")} />
            <Chip label={t("recette.group.usage")} active={grouping === "usage"} onClick={() => pickGrouping("usage")} />
            <Chip label={t("recette.group.delivery")} active={grouping === "delivery"} onClick={() => pickGrouping("delivery")} />
          </div>
          <div className="flex items-center gap-2">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">{t("recette.search")}</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("recette.search")}
                className={cn("h-10 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm", FOCUS)}
              />
            </label>
            {gallery.length > 0 && (
              <button
                type="button"
                onClick={() => openLightbox(gallery, 0)}
                className={cn("inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold hover:bg-muted/60", FOCUS, MOTION)}
              >
                <Images className="size-4" />
                {t("recette.gallery", { count: gallery.length })}
              </button>
            )}
          </div>

          {shown.length === 0 ? (
            <p className="px-2 py-16 text-center text-sm text-muted-foreground">{t(counts.todo + counts.ko + counts.ok ? "recette.emptyFiltered" : "recette.empty")}</p>
          ) : grouping === "timeline" ? (
            <Timeline entries={flat} render={entry} />
          ) : grouping === "usage" ? (
            shown.map((g) => (
              <section key={g.usage ?? ""} className="flex flex-col gap-2.5">
                <div className="mx-1 mt-1 flex flex-wrap items-center gap-2">
                  <SectionLabel>{g.usage ?? t("recette.otherUse")}</SectionLabel>
                  <StatePills entries={g.entries} />
                </div>
                <div className="flex flex-col gap-2">{g.entries.map(entry)}</div>
              </section>
            ))
          ) : (
            // Phase › lot (its PR, its merge) › entries, the newest merge on top.
            byDelivery(flat).map((p) => (
              <section key={p.phase ?? ""} className="flex flex-col gap-2.5">
                <div className="mx-1 mt-2 flex flex-wrap items-center gap-2">
                  <SectionLabel>{p.phase ?? t("recette.noPhase")}</SectionLabel>
                  <StatePills entries={p.lots.flatMap((l) => l.entries)} />
                </div>
                {p.lots.map((l) => (
                  <div key={l.runId ?? l.lot ?? ""} className="flex flex-col gap-2 border-l-2 border-border pl-3">
                    <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">{l.lot ?? t("recette.noLot")}</span>
                      {l.prUrl && <PrLink url={l.prUrl} />}
                      <span>{t("recette.merged", { ago: ago(l.at) })}</span>
                    </h3>
                    {l.entries.map(entry)}
                  </div>
                ))}
              </section>
            ))
          )}
        </div>
      </main>
      {session && (
        <RecetteSession
          entries={toCheck}
          device={session}
          stepKey={params.get("step")}
          onDevice={(d: SessionDevice) => setParams((p) => (p.set("session", d), p.delete("step"), p), { replace: true })}
          onStep={(k) => setParam("step", k)}
          onQuit={() => setParams((p) => (p.delete("session"), p.delete("step"), p), { replace: true })}
          onChange={refresh}
        />
      )}
    </div>
  );
}

/** The timeline: a day mark (Aujourd'hui, Hier, a date) on each day's first delivery, a rail, the entries. */
function Timeline({ entries, render }: { entries: RecetteEntry[]; render: (e: RecetteEntry) => React.ReactNode }) {
  const t = useT();
  const label = (ts: number) => {
    const mark = dayMark(ts);
    return mark ? t(`recette.day.${mark}`) : new Date(ts).toLocaleDateString(getLocale(), { weekday: "long", day: "numeric", month: "long" });
  };
  return (
    <ol className="flex flex-col">
      {entries.map((e, i) => {
        const day = label(e.deliveredAt);
        const first = i === 0 || label(entries[i - 1]!.deliveredAt) !== day;
        const last = i === entries.length - 1;
        return (
          <li key={e.cardId} className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-x-3 lg:grid-cols-[6.5rem_0.75rem_minmax(0,1fr)]">
            {/* On a phone the day mark is a line of its own; on a wide screen, the rail's left column. */}
            {first && <span className="col-span-2 pb-1.5 pt-2 text-xs font-medium text-muted-foreground first:pt-0 lg:hidden">{day}</span>}
            <span className="hidden pt-3 text-right text-xs font-medium text-muted-foreground lg:block">{first ? day : null}</span>
            <span className="flex flex-col items-center" aria-hidden>
              <span className={cn("mt-4 size-2.5 shrink-0 rounded-full", isPending(e) ? STATE_TONE[e.state] : "bg-status-done")} />
              {!last && <span className="mt-1 w-px flex-1 bg-border" />}
            </span>
            <div className="min-w-0 pb-3">{render(e)}</div>
          </li>
        );
      })}
    </ol>
  );
}

/** « How it works », folded by default: what each verdict does, where a « Pas bon » goes, the session. */
function Help() {
  const t = useT();
  return (
    <details className="group rounded-lg border bg-muted/30 text-sm">
      <summary className={cn("flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-3 py-2 font-medium hover:bg-muted/60", FOCUS, MOTION)}>
        <CircleHelp className="size-4 text-muted-foreground" />
        {t("recette.help")}
        <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform motion-reduce:transition-none group-open:rotate-180" />
      </summary>
      <ul className="flex flex-col gap-1.5 px-3 pb-3 pt-1 text-muted-foreground">
        <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-status-done" />{t("recette.help.ok")}</li>
        <li className="flex gap-2"><X className="mt-0.5 size-4 shrink-0 text-status-blocked" />{t("recette.help.ko")}</li>
        <li className="flex gap-2"><SkipForward className="mt-0.5 size-4 shrink-0" />{t("recette.help.skip")}</li>
        <li className="flex gap-2"><Sparkles className="mt-0.5 size-4 shrink-0" />{t("recette.help.prepare")}</li>
        <li className="flex gap-2"><ListChecks className="mt-0.5 size-4 shrink-0" />{t("recette.help.session")}</li>
        <li className="flex gap-2"><RotateCcw className="mt-0.5 size-4 shrink-0" />{t("recette.help.change")}</li>
      </ul>
    </details>
  );
}

/** A group's states at a glance: one pill per state present. */
function StatePills({ entries }: { entries: readonly RecetteEntry[] }) {
  const t = useT();
  const c = recetteCounts(entries);
  return (
    <span className="flex gap-1">
      {(["todo", "ko", "ok"] as const).map(
        (k) =>
          c[k] > 0 && (
            <span key={k} className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[11px] font-semibold tabular-nums", STATE_TEXT[k])}>
              <span className={cn("size-1.5 rounded-full", STATE_TONE[k])} />
              {c[k]} {t(`recette.state.${k}`)}
            </span>
          ),
      )}
    </span>
  );
}

const STATE_TEXT = { todo: "text-brand", ok: "text-status-done", ko: "text-status-blocked" } as const;

/** The header figure: one bar, three tones — read at a glance, not a sentence. */
function Counter({ counts }: { counts: { todo: number; ok: number; ko: number } }) {
  const t = useT();
  const total = counts.todo + counts.ok + counts.ko;
  const parts = (["todo", "ok", "ko"] as const).map((k) => ({ k, n: counts[k] }));
  return (
    <div className="flex flex-col gap-1.5" role="img" aria-label={t("recette.counter", counts)}>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
        {total > 0 && parts.map(({ k, n }) => n > 0 && <span key={k} className={STATE_TONE[k]} style={{ width: `${(n / total) * 100}%` }} />)}
      </div>
      <div className="flex gap-3 text-xs tabular-nums text-muted-foreground">
        {parts.map(({ k, n }) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className={cn("size-2 rounded-full", STATE_TONE[k])} />
            {n} {t(`recette.state.${k}`)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The project page's shortcut: « N to test », absent at zero. Read once per repo, not polled. */
/** How many tests wait in the repo's recette — read once per repo, 0 on an older bridge. */
export function useRecetteTodo(repo: string | null): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    fetchRecette(repo, ctl.signal).then(
      (r) => setN(r.groups.flatMap((g) => g.entries).filter((e) => e.state === "todo").length),
      () => {}, // an older bridge: no chip
    );
    return () => ctl.abort();
  }, [repo]);
  return n;
}

export function RecetteChip({ repo }: { repo: string | null }) {
  const t = useT();
  const n = useRecetteTodo(repo);
  if (n === 0) return null;
  return (
    <Link
      to={`/board/recette${repo ? `?repo=${encodeURIComponent(repo)}` : ""}`}
      className="inline-flex items-center gap-1.5 rounded-full border border-brand/35 bg-brand/16 px-2.5 py-[3px] text-xs font-semibold text-brand"
    >
      <CircleDashed className="size-3" />
      {t("recette.chip", { count: n })}
    </Link>
  );
}
