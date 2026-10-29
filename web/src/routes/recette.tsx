import { useEffect, useState } from "react";
import { Link, useLoaderData, useNavigate, useSearchParams } from "react-router";
import { ArrowUpRight, Check, ChevronDown, CircleDashed, Images, Search, SkipForward, X } from "lucide-react";

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

// The recette: what the operator can now DO, to try by hand — captures first, one line per step, and
// nothing the project page already says (no PR, no file). What is validated leaves the default view;
// a step settles out of sight as soon as it is ticked.

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

      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 pb-24 lg:p-5">
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
              <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2 xl:grid-cols-3">
                {g.entries.map((e) => (
                  <Entry key={e.cardId} entry={e} onChange={refresh} />
                ))}
              </div>
            </section>
          ))
        )}
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

function Entry({ entry: e, onChange }: { entry: RecetteEntry; onChange: () => Promise<void> }) {
  const t = useT();
  const shots = e.shots.map((s) => deliverableUrl(e.cardId, s));
  const open = e.steps.filter((s) => !stepSettled(s));
  const settled = e.steps.filter(stepSettled);
  return (
    <article className="flex min-w-0 flex-col gap-2.5 overflow-hidden rounded-[14px] border bg-card p-3">
      {shots.length > 0 && (
        <div className="-mx-3 -mt-3 flex snap-x gap-1.5 overflow-x-auto rounded-t-[14px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {e.shots.map((name, i) => (
            <button
              key={name}
              type="button"
              onClick={() => openLightbox(shots, i)}
              aria-label={t("deliv.open", { name })}
              className={cn("block h-48 shrink-0 snap-start overflow-hidden bg-muted/40", shots.length === 1 ? "w-full" : "w-[85%]")}
            >
              <GalleryImg path={shots[i]!} alt={name} className="size-full object-cover object-top" />
            </button>
          ))}
        </div>
      )}
      <header className="flex items-start gap-2">
        <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", STATE_TONE[e.state])} aria-label={t(`recette.state.${e.state}`)} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="text-sm font-semibold leading-snug">{e.capability}</h2>
          <span className="text-xs text-muted-foreground">{[e.phase, e.lot, ago(e.deliveredAt)].filter(Boolean).join(" · ")}</span>
        </div>
        <Link to={cardPath(e.cardId)} aria-label={t("recette.openCard")} title={t("recette.openCard")} className="-m-1 p-1 text-muted-foreground">
          <ArrowUpRight className="size-4" />
        </Link>
      </header>
      {open.length > 0 && (
        <ul className="flex flex-col gap-1">
          {open.map((s) => (
            <Step key={s.id} cardId={e.cardId} step={s} onChange={onChange} />
          ))}
        </ul>
      )}
      {settled.length > 0 && (
        <details className="group text-xs text-muted-foreground">
          <summary className="flex cursor-pointer list-none items-center gap-1">
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
            {t("recette.settled", { count: settled.length })}
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {settled.map((s) => (
              <Step key={s.id} cardId={e.cardId} step={s} onChange={onChange} />
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

const STEP_ICON = { ok: Check, ko: X, skip: SkipForward } as const;

function Step({ cardId, step: s, onChange }: { cardId: string; step: RecetteStep; onChange: () => Promise<void> }) {
  const t = useT();
  const navigate = useNavigate();
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState(s.verdict?.note ?? "");
  const [busy, setBusy] = useState(false);
  const status = s.verdict?.status;
  const Icon = status ? STEP_ICON[status] : CircleDashed;

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
    <li className="flex flex-col gap-1.5 rounded-md bg-muted/40 px-2 py-1.5">
      <div className="flex items-center gap-2">
        <Icon
          className={cn("size-4 shrink-0", status === "ok" && "text-status-done", status === "ko" && "text-status-blocked", !status && "text-muted-foreground")}
          aria-label={t(`recette.step.${status ?? "todo"}`)}
        />
        <span className="line-clamp-2 min-w-0 flex-1 text-sm leading-snug text-foreground" title={s.expected ? `${s.text} → ${s.expected}` : s.text}>
          {s.text}
          {s.expected && <span className="text-muted-foreground"> → {s.expected}</span>}
        </span>
        <button type="button" disabled={busy} onClick={() => void send("ok")} aria-label={t("recette.step.markOk")} className={cn(btn, status === "ok" && "border-status-done text-status-done")}>
          <Check className="size-4" />
        </button>
        <button type="button" disabled={busy} onClick={() => setNoting(!noting)} aria-label={t("recette.step.markKo")} className={cn(btn, status === "ko" && "border-status-blocked text-status-blocked")}>
          <X className="size-4" />
        </button>
        <button type="button" disabled={busy} onClick={() => void send("skip")} aria-label={t("recette.step.markSkip")} className={cn(btn, status === "skip" && "text-foreground")}>
          <SkipForward className="size-4" />
        </button>
      </div>
      {status === "ko" && s.verdict?.note && !noting && <p className="pl-6 text-xs text-status-blocked">{s.verdict.note}</p>}
      {noting && (
        <div className="flex flex-col gap-1.5 pl-6">
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
