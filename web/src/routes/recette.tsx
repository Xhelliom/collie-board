import { useEffect, useState } from "react";
import { Link, useLoaderData, useNavigate, useSearchParams } from "react-router";
import { Check, ChevronDown, CircleDashed, Images, Search, SkipForward, X, ZoomIn } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { BoardTabs } from "@/components/board-tabs";
import { GalleryImg } from "@/components/gallery-img";
import { Chip } from "@/components/ui/chip";
import { SectionLabel } from "@/components/ui/section-label";
import { useT } from "@/i18n";
import { boardErrorMessage, cardPath, deliverableUrl, repoName } from "@/lib/board";
import { assignedToMe, useIdentities } from "@/lib/identities";
import { openLightbox } from "@/lib/lightbox";
import { ago } from "@/lib/project-facts";
import {
  fetchRecette,
  isPending,
  lastVisit,
  markVisit,
  matchesQuery,
  postVerdict,
  recetteCounts,
  stepSettled,
  type CheckStatus,
  type RecetteEntry,
  type RecetteGroup,
  type RecetteStep,
} from "@/lib/recette";
import { setStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

// The recette: what the operator can now DO, to try by hand — one line per capability, unfolded in
// place into its steps (« Do » then « Expect », never clipped) and its captures, and nothing the
// project page already says (no PR, no file). What is validated leaves the default view; a step
// settles out of sight as soon as it is ticked.

const STATE_TONE = { todo: "bg-muted-foreground", ok: "bg-status-done", ko: "bg-status-blocked" } as const;

export function RecetteRoute() {
  const t = useT();
  const loaded = useLoaderData() as { repo: string | null; groups: RecetteGroup[] };
  const [groups, setGroups] = useState(loaded.groups);
  useEffect(() => setGroups(loaded.groups), [loaded]);
  const { repo } = loaded;
  const [params] = useSearchParams();
  // The previous visit, read once — this visit then becomes the next one's mark.
  const [visit] = useState(() => lastVisit(repo));
  useEffect(() => markVisit(repo), [repo]);
  const [period, setPeriod] = useState<"visit" | "all">(params.get("period") === "all" || visit === 0 ? "all" : "visit");
  const [everything, setEverything] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const [query, setQuery] = useState("");
  const identities = useIdentities();

  const inPeriod = groups.map((g) => ({ ...g, entries: g.entries.filter((e) => period === "all" || e.deliveredAt >= visit) }));
  const counts = recetteCounts(inPeriod.flatMap((g) => g.entries));
  const hasShared = inPeriod.some((g) => g.entries.some((e) => e.repoPath && identities[e.repoPath]));
  const shown = inPeriod
    .map((g) => ({
      ...g,
      entries: g.entries.filter(
        (e) =>
          (everything || isPending(e)) &&
          matchesQuery(e, query) &&
          (!mineOnly || assignedToMe(e, identities)),
      ),
    }))
    .filter((g) => g.entries.length > 0);
  // A handful to test reads unfolded; more than that, the list of titles is the overview.
  const unfold = shown.flatMap((g) => g.entries).filter(isPending).length <= 3;
  const gallery = shown.flatMap((g) => g.entries.flatMap((e) => e.shots.map((s) => deliverableUrl(e.cardId, s))));

  async function refresh() {
    try {
      setGroups((await fetchRecette(repo)).groups);
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    }
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col lg:max-w-none">
      <AppHeader title={t("recette.title")} subtitle={t("recette.count", { count: counts.todo })} />
      <BoardTabs repos={repo ? [{ path: repo, name: repoName(repo) }] : []} />
      <h1 className="sr-only">{t("recette.title")}</h1>

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 pb-24 lg:p-5">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          <Counter counts={counts} />
          <div className="flex flex-wrap items-center gap-2">
            <Chip label={t("recette.period.visit")} active={period === "visit"} onClick={() => setPeriod("visit")} />
            <Chip label={t("recette.period.all")} active={period === "all"} onClick={() => setPeriod("all")} />
            <span className="mx-1 h-5 w-px bg-border" />
            <Chip label={t("recette.filter.todo")} active={!everything} onClick={() => setEverything(false)} />
            <Chip label={t("recette.filter.all")} active={everything} onClick={() => setEverything(true)} />
            {(hasShared || mineOnly) && <Chip label={t("people.toMe")} active={mineOnly} onClick={() => setMineOnly(!mineOnly)} />}
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
                className="h-10 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm"
              />
            </label>
            {gallery.length > 0 && (
              <button
                type="button"
                onClick={() => openLightbox(gallery, 0)}
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold hover:bg-muted/60"
              >
                <Images className="size-4" />
                {t("recette.gallery", { count: gallery.length })}
              </button>
            )}
          </div>

          {shown.length === 0 ? (
            <p className="px-2 py-16 text-center text-sm text-muted-foreground">{t(counts.todo + counts.ko + counts.ok ? "recette.emptyFiltered" : "recette.empty")}</p>
          ) : (
            shown.map((g) => (
              <section key={g.usage ?? ""} className="flex flex-col gap-2.5">
                <SectionLabel className="mx-1 mt-1">{g.usage ?? t("recette.otherUse")}</SectionLabel>
                <div className="flex flex-col gap-2">
                  {g.entries.map((e) => (
                    <Entry key={e.cardId} entry={e} defaultOpen={unfold && isPending(e)} onChange={refresh} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </main>
    </div>
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
    <article className="flex min-w-0 flex-col rounded-[14px] border bg-card">
      {/* The WAI accordion: the heading holds the toggle, so heading navigation still lists the capabilities. */}
      <h2>
        <button type="button" aria-expanded={unfolded} onClick={() => setUnfolded(!unfolded)} className="flex w-full items-start gap-2.5 p-3 text-left">
          <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", STATE_TONE[e.state])} aria-label={t(`recette.state.${e.state}`)} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-semibold leading-snug">{e.capability}</span>
            <span className="text-xs text-muted-foreground">{[e.phase, e.lot, ago(e.deliveredAt)].filter(Boolean).join(" · ")}</span>
            {open.length > 0 && <span className="text-xs font-medium text-foreground">{t("recette.toTest", { count: open.length })}</span>}
          </span>
          {shots.length > 0 && (
            <span className="flex shrink-0 flex-col items-center gap-0.5 text-[11px] tabular-nums text-muted-foreground">
              <GalleryImg path={shots[0]!} alt="" className="h-10 w-14 rounded border bg-muted/40 object-contain" />
              {t("recette.gallery", { count: shots.length })}
            </span>
          )}
          <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", unfolded && "rotate-180")} />
        </button>
      </h2>
      {unfolded && (
        <div className="flex flex-col gap-3 border-t px-3 pb-3 pt-3">
          {open.length > 0 && <ol className="flex flex-col gap-1.5">{open.map(step)}</ol>}
          {shots.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {e.shots.map((name, i) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => openLightbox(shots, i)}
                  aria-label={t("deliv.open", { name })}
                  className="relative h-40 w-56 shrink-0 overflow-hidden rounded-md border bg-muted/40 hover:border-foreground/40"
                >
                  <GalleryImg path={shots[i]!} alt={name} className="size-full object-contain" />
                  <ZoomIn className="absolute bottom-1.5 right-1.5 size-6 rounded-full bg-background/85 p-1 text-foreground shadow" />
                </button>
              ))}
            </div>
          )}
          {settled.length > 0 && (
            <details className="group text-xs text-muted-foreground">
              <summary className="flex cursor-pointer list-none items-center gap-1">
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                {t("recette.settled", { count: settled.length })}
              </summary>
              <ol className="mt-1 flex flex-col gap-1.5">{settled.map(step)}</ol>
            </details>
          )}
          <Link to={cardPath(e.cardId)} className="self-start rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/60">
            {t("recette.cardDetail")}
          </Link>
        </div>
      )}
    </article>
  );
}

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

  const btn = "inline-flex size-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground disabled:opacity-50";
  return (
    <li className="flex flex-col gap-1.5 rounded-md bg-muted/40 px-2 py-2">
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
            className="relative h-12 w-16 shrink-0 overflow-hidden rounded border bg-background"
          >
            <GalleryImg path={deliverableUrl(cardId, s.shot)} alt={s.shot} className="size-full object-contain" />
            <ZoomIn className="absolute bottom-0.5 right-0.5 size-4 rounded-full bg-background/85 p-0.5 text-foreground" />
          </button>
        )}
        <div className="flex shrink-0 gap-1">
          <button type="button" disabled={busy} onClick={() => void send("ok")} aria-label={t("recette.step.markOk")} aria-pressed={status === "ok"} className={cn(btn, status === "ok" && "border-status-done text-status-done")}>
            <Check className="size-4" />
          </button>
          <button type="button" disabled={busy} onClick={() => setNoting(!noting)} aria-label={t("recette.step.markKo")} aria-pressed={status === "ko"} className={cn(btn, status === "ko" && "border-status-blocked text-status-blocked")}>
            <X className="size-4" />
          </button>
          <button type="button" disabled={busy} onClick={() => void send("skip")} aria-label={t("recette.step.markSkip")} aria-pressed={status === "skip"} className={cn(btn, status === "skip" && "text-foreground")}>
            <SkipForward className="size-4" />
          </button>
        </div>
      </div>
      {status === "ko" && s.verdict?.note && !noting && <p className="pl-7 text-xs text-status-blocked">{s.verdict.note}</p>}
      {noting && (
        <div className="flex flex-col gap-1.5 pl-7">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("recette.note")}
            aria-label={t("recette.note")}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          />
          <div className="flex flex-wrap gap-1.5">
            <button type="button" disabled={busy} onClick={() => void send("ko")} className="h-8 rounded-md border px-2.5 text-xs font-semibold">
              {t("recette.saveKo")}
            </button>
            <button
              type="button"
              disabled={busy || !note.trim()}
              onClick={() => void send("ko", true)}
              className="h-8 rounded-md bg-status-blocked/16 px-2.5 text-xs font-semibold text-status-blocked disabled:opacity-50"
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
export function RecetteChip({ repo }: { repo: string | null }) {
  const t = useT();
  const [n, setN] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    fetchRecette(repo, ctl.signal).then(
      (r) => setN(r.groups.flatMap((g) => g.entries).filter((e) => e.state === "todo").length),
      () => {}, // an older bridge: no chip
    );
    return () => ctl.abort();
  }, [repo]);
  if (n === 0) return null;
  return (
    <Link
      to={`/board/recette?${repo ? `repo=${encodeURIComponent(repo)}&` : ""}period=all`}
      className="inline-flex items-center gap-1.5 rounded-full border border-brand/35 bg-brand/16 px-2.5 py-[3px] text-xs font-semibold text-brand"
    >
      <CircleDashed className="size-3" />
      {t("recette.chip", { count: n })}
    </Link>
  );
}
