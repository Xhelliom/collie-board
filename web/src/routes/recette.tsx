import { useEffect, useState } from "react";
import { Link, useLoaderData, useNavigate, useSearchParams } from "react-router";
import { Check, ChevronDown, ChevronRight, CircleDashed, CircleHelp, GitPullRequest, Images, RotateCcw, Search, SkipForward, X, ZoomIn } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { BoardTabs, RepoTitle } from "@/components/board-tabs";
import { GalleryImg } from "@/components/gallery-img";
import { Chip } from "@/components/ui/chip";
import { SectionLabel } from "@/components/ui/section-label";
import { useT } from "@/i18n";
import { boardErrorMessage, cardPath, deliverableUrl, loadSort, projectPath, repoName, saveSort, sortOf, type CardSort } from "@/lib/board";
import { assignedToMe, useIdentities } from "@/lib/identities";
import { openLightbox } from "@/lib/lightbox";
import { ago } from "@/lib/project-facts";
import {
  byDelivery,
  fetchRecette,
  isPending,
  loadGrouping,
  matchesQuery,
  postVerdict,
  prLabel,
  recetteCounts,
  saveGrouping,
  stepSettled,
  type CheckStatus,
  type Grouping,
  type RecetteEntry,
  type RecetteGroup,
  type RecetteStep,
} from "@/lib/recette";
import { setStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

// The recette: what the operator can now DO, to try by hand — one line per capability, unfolded in
// place into its steps (« Do » then « Expect », never clipped) and its captures. Under the title, the
// thread back to its delivery: project › phase › lot › card · PR. What is validated leaves the default
// view; a step settles out of sight as soon as it is ticked.

const STATE_TONE = { todo: "bg-brand", ok: "bg-status-done", ko: "bg-status-blocked" } as const;
const STATE_EDGE = { todo: "border-l-brand", ok: "border-l-status-done", ko: "border-l-status-blocked" } as const;
const STATE_TEXT = { todo: "text-brand", ok: "text-status-done", ko: "text-status-blocked" } as const;
const FOCUS = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const MOTION = "transition-colors duration-150 motion-reduce:transition-none";

export function RecetteRoute() {
  const t = useT();
  const loaded = useLoaderData() as { repo: string | null; groups: RecetteGroup[] };
  const [groups, setGroups] = useState(loaded.groups);
  useEffect(() => setGroups(loaded.groups), [loaded]);
  const { repo } = loaded;
  // `phase=<id>` (the Roadmap's « what was delivered »): that phase only, validated entries included.
  const [params, setParams] = useSearchParams();
  const phaseId = params.get("phase");
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
  const shown = groups
    .map((g) => ({
      ...g,
      entries: g.entries.filter(
        (e) =>
          (everything || isPending(e)) &&
          (!phaseId || e.phaseId === phaseId) &&
          matchesQuery(e, query) &&
          (!mineOnly || assignedToMe(e, identities)) &&
          (!sort || sortOf(e) === sort),
      ),
    }))
    .filter((g) => g.entries.length > 0);
  const flat = shown.flatMap((g) => g.entries);
  // A handful to test reads unfolded; more than that, the list of titles is the overview.
  const unfold = flat.filter(isPending).length <= 3;
  const gallery = flat.flatMap((e) => e.shots.map((s) => deliverableUrl(e.cardId, s)));
  const pickGrouping = (g: Grouping) => {
    setGrouping(g);
    saveGrouping(g);
  };

  async function refresh() {
    try {
      setGroups((await fetchRecette(repo)).groups);
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    }
  }

  const entry = (e: RecetteEntry) => <Entry key={e.cardId} entry={e} defaultOpen={unfold && isPending(e)} onChange={refresh} />;

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col lg:max-w-none">
      <AppHeader children={<RepoTitle repos={repo ? [{ path: repo, name: repoName(repo) }] : []} subtitle={t("recette.count", { count: counts.todo })} />} />
      <BoardTabs />
      <h1 className="sr-only">{t("recette.title")}</h1>

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 pb-24 lg:p-5">
        <div className="flex w-full flex-col gap-3">
          <Counter counts={counts} />
          <Help />
          <div className="flex flex-wrap items-center gap-2">
            {phaseId && <Chip label={`✕ ${phaseName ?? t("recette.filter.phase")}`} active onClick={() => setParams((p) => (p.delete("phase"), p), { replace: true })} />}
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
            // A timeline: the newest merge on top, phase › lot (its PR, its merge) › entries.
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
    </div>
  );
}

/** « How it works », folded by default: what each verdict does, what leaves the list. */
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

function PrLink({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-px font-medium text-foreground hover:bg-muted/60", FOCUS, MOTION)}>
      <GitPullRequest className="size-3" />
      {prLabel(url)}
    </a>
  );
}

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

/** Project › Phase › Lot › Card · PR · delivered — each present link, nothing for what is absent. */
function Thread({ entry: e }: { entry: RecetteEntry }) {
  const t = useT();
  const chip = cn("rounded-full px-1.5 py-px hover:bg-muted hover:text-foreground", FOCUS, MOTION);
  const project = projectPath(e.repoPath);
  const crumbs = [
    e.project && <Link key="p" to={project} className={chip}>{e.project}</Link>,
    e.phase && <Link key="ph" to={project} className={chip}>{e.phase}</Link>,
    e.lot && <Link key="l" to={project} className={chip}>{e.lot}</Link>,
    <Link key="c" to={cardPath(e.cardId)} className={chip}>{t("recette.thread.card")}</Link>,
  ].filter(Boolean);
  return (
    <nav aria-label={t("recette.thread")} className="flex flex-wrap items-center gap-x-0.5 gap-y-1 px-3 pb-2.5 pl-7 text-xs text-muted-foreground">
      {crumbs.map((c, i) => (
        <span key={i} className="inline-flex items-center gap-0.5">
          {i > 0 && <ChevronRight className="size-3 opacity-60" aria-hidden />}
          {c}
        </span>
      ))}
      {e.prUrl && (
        <>
          <span aria-hidden className="mx-1">·</span>
          <PrLink url={e.prUrl} />
        </>
      )}
      <span aria-hidden className="mx-1">·</span>
      <span>{t("recette.thread.delivered", { ago: ago(e.deliveredAt) })}</span>
    </nav>
  );
}

function Entry({ entry: e, defaultOpen, onChange }: { entry: RecetteEntry; defaultOpen: boolean; onChange: () => Promise<void> }) {
  const t = useT();
  const [unfolded, setUnfolded] = useState(defaultOpen);
  const shots = e.shots.map((s) => deliverableUrl(e.cardId, s));
  const open = e.steps.filter((s) => !stepSettled(s));
  const settled = e.steps.filter(stepSettled);
  // A step's own capture opens inside the card's series when it is one of them, alone otherwise.
  const openShot = (name: string) => {
    const i = e.shots.indexOf(name);
    if (i >= 0) openLightbox(shots, i);
    else openLightbox([deliverableUrl(e.cardId, name)]);
  };
  const step = (s: RecetteStep) => (
    <Step key={s.id} n={e.steps.indexOf(s) + 1} cardId={e.cardId} step={s} onShot={openShot} onChange={onChange} />
  );
  return (
    <article className={cn("flex min-w-0 flex-col overflow-hidden rounded-[14px] border border-l-4 bg-card", STATE_EDGE[e.state], e.state === "ko" && "bg-status-blocked/5")}>
      {/* The WAI accordion: the heading holds the toggle, so heading navigation still lists the capabilities. */}
      <h2>
        <button
          type="button"
          aria-expanded={unfolded}
          onClick={() => setUnfolded(!unfolded)}
          className={cn("flex w-full items-start gap-2.5 p-3 pb-1.5 text-left hover:bg-muted/40", FOCUS, MOTION)}
        >
          <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", STATE_TONE[e.state])} aria-label={t(sortOf(e) === "business" && e.state === "todo" ? "recette.state.proofread" : `recette.state.${e.state}`)} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-semibold leading-snug">{e.capability}</span>
            {open.length > 0 && <span className={cn("text-xs font-medium", STATE_TEXT[e.state])}>{t(sortOf(e) === "business" ? "recette.toProofread" : "recette.toTest", { count: open.length })}</span>}
          </span>
          {shots.length > 0 && (
            <span className="flex shrink-0 flex-col items-center gap-0.5 text-[11px] tabular-nums text-muted-foreground">
              <GalleryImg path={shots[0]!} alt="" className="h-10 w-14 rounded border bg-muted/40 object-contain" />
              {t("recette.gallery", { count: shots.length })}
            </span>
          )}
          <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", unfolded && "rotate-180")} />
        </button>
      </h2>
      <Thread entry={e} />
      {unfolded && (
        <div className="flex flex-col gap-3 border-t px-3 pb-3 pt-3">
          {/* On a wide screen, the steps and the captures side by side. */}
          <div className={cn("flex flex-col gap-3", shots.length > 0 && "xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] xl:items-start")}>
            <div className="flex min-w-0 flex-col gap-3">
              {open.length > 0 && <ol className="flex flex-col gap-1.5">{open.map(step)}</ol>}
              {settled.length > 0 && (
                <details className="group text-xs text-muted-foreground">
                  <summary className={cn("flex cursor-pointer list-none items-center gap-1 rounded px-1 py-0.5 hover:text-foreground", FOCUS, MOTION)}>
                    <ChevronDown className="size-3.5 transition-transform motion-reduce:transition-none group-open:rotate-180" />
                    {t("recette.settled", { count: settled.length })}
                  </summary>
                  <ol className="mt-1 flex flex-col gap-1.5">{settled.map(step)}</ol>
                </details>
              )}
            </div>
            {shots.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1 xl:flex-wrap xl:overflow-visible">
                {e.shots.map((name, i) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => openLightbox(shots, i)}
                    aria-label={t("deliv.open", { name })}
                    className={cn("relative h-40 w-56 shrink-0 overflow-hidden rounded-md border bg-muted/40 hover:border-foreground/40 xl:h-32 xl:w-[13.5rem]", FOCUS, MOTION)}
                  >
                    <GalleryImg path={shots[i]!} alt={name} className="size-full object-contain" />
                    <ZoomIn className="absolute bottom-1.5 right-1.5 size-6 rounded-full bg-background/85 p-1 text-foreground shadow" />
                  </button>
                ))}
              </div>
            )}
          </div>
          <Link to={cardPath(e.cardId)} className={cn("self-start rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground", FOCUS, MOTION)}>
            {t("recette.cardDetail")}
          </Link>
        </div>
      )}
    </article>
  );
}

const VERDICTS = [
  { status: "ok", Icon: Check, label: "recette.step.markOk", short: "recette.step.shortOk", tip: "recette.step.tipOk", on: "border-status-done bg-status-done/15 text-status-done", hover: "hover:border-status-done/60 hover:text-status-done" },
  { status: "ko", Icon: X, label: "recette.step.markKo", short: "recette.step.shortKo", tip: "recette.step.tipKo", on: "border-status-blocked bg-status-blocked/15 text-status-blocked", hover: "hover:border-status-blocked/60 hover:text-status-blocked" },
  { status: "skip", Icon: SkipForward, label: "recette.step.markSkip", short: "recette.step.shortSkip", tip: "recette.step.tipSkip", on: "border-foreground/50 bg-muted text-foreground", hover: "hover:border-foreground/40 hover:text-foreground" },
] as const;

function Step({
  n,
  cardId,
  step: s,
  onShot,
  onChange,
}: {
  n: number;
  cardId: string;
  step: RecetteStep;
  onShot: (name: string) => void;
  onChange: () => Promise<void>;
}) {
  const t = useT();
  const navigate = useNavigate();
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState(s.verdict?.note ?? "");
  const [busy, setBusy] = useState(false);
  const status = s.verdict?.status;

  async function send(next: CheckStatus, followUp = false) {
    setBusy(true);
    try {
      const r = await postVerdict(cardId, s.id, { status: next, ...(next === "ko" && note.trim() ? { note: note.trim() } : {}), ...(followUp ? { followUp } : {}) });
      setNoting(false);
      if (r.followUp) {
        setStatus(t("recette.followUpMade"), "success");
        navigate(cardPath(r.followUp.id));
        return;
      }
      await onChange();
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={cn("flex flex-col gap-2 rounded-md bg-muted/40 px-2 py-2", MOTION, status === "ko" && "bg-status-blocked/10")}>
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-background text-[11px] font-semibold tabular-nums text-muted-foreground",
            status === "ok" && "text-status-done",
            status === "ko" && "text-status-blocked",
          )}
        >
          {n}
          <span className="sr-only">{t(`recette.step.${status ?? "todo"}`)}</span>
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm leading-snug">
          <p className="text-foreground">
            <span className="font-medium text-muted-foreground">{t("recette.do")}</span> {s.text}
          </p>
          {s.expected && (
            <p className="text-foreground">
              <span className="font-medium text-muted-foreground">{t("recette.expected")}</span> {s.expected}
            </p>
          )}
        </div>
        {s.shot && (
          <button
            type="button"
            onClick={() => onShot(s.shot!)}
            aria-label={t("deliv.open", { name: s.shot })}
            className={cn("relative h-12 w-16 shrink-0 overflow-hidden rounded border bg-background hover:border-foreground/40", FOCUS, MOTION)}
          >
            <GalleryImg path={deliverableUrl(cardId, s.shot)} alt={s.shot} className="size-full object-contain" />
            <ZoomIn className="absolute bottom-0.5 right-0.5 size-4 rounded-full bg-background/85 p-0.5 text-foreground" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 pl-7">
        {VERDICTS.map((v) => {
          const pressed = status === v.status;
          // The tooltip says what the click DOES; on a step already judged, that another one changes it.
          const tip = t(v.tip) + (status ? ` ${t("recette.help.change")}` : "");
          return (
            <button
              key={v.status}
              type="button"
              disabled={busy}
              onClick={() => (v.status === "ko" ? setNoting(!noting) : void send(v.status))}
              aria-label={t(v.label)}
              aria-pressed={pressed}
              title={tip}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs font-semibold text-muted-foreground disabled:opacity-50",
                FOCUS,
                MOTION,
                pressed ? v.on : v.hover,
              )}
            >
              <v.Icon className="size-3.5" aria-hidden />
              <span className="sm:hidden">{t(v.short)}</span>
              <span className="hidden sm:inline">{t(v.label)}</span>
            </button>
          );
        })}
      </div>
      {status === "ko" && s.verdict?.note && !noting && <p className="pl-7 text-xs text-status-blocked">{s.verdict.note}</p>}
      {noting && (
        <div className="flex flex-col gap-1.5 pl-7">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("recette.note")}
            aria-label={t("recette.note")}
            className={cn("h-9 rounded-md border border-border bg-background px-2 text-sm", FOCUS)}
          />
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void send("ko")}
              title={t("recette.step.tipKo")}
              className={cn("h-8 rounded-md border bg-background px-2.5 text-xs font-semibold hover:bg-muted/60", FOCUS, MOTION)}
            >
              {t("recette.saveKo")}
            </button>
            <button
              type="button"
              disabled={busy || !note.trim()}
              onClick={() => void send("ko", true)}
              title={t("recette.help.ko")}
              className={cn("h-8 rounded-md bg-status-blocked/16 px-2.5 text-xs font-semibold text-status-blocked hover:bg-status-blocked/25 disabled:opacity-50", FOCUS, MOTION)}
            >
              {t("recette.followUp")}
            </button>
          </div>
        </div>
      )}
    </li>
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
