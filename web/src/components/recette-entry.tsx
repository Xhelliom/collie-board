import { useState } from "react";
import { Link } from "react-router";
import { ArrowUpRight, Check, ChevronDown, Circle, CircleDot, GitPullRequest, Images, SkipForward, Smartphone, Sparkles, X, ZoomIn } from "lucide-react";

import { ActorToken } from "@/components/actor-token";
import { GalleryImg } from "@/components/gallery-img";
import { buttonVariants } from "@/components/ui/button";
import { getLocale, useT } from "@/i18n";
import { ApiError } from "@/lib/api";
import { boardErrorMessage, cardPath, deliverableUrl, projectPath, repoName, sortOf } from "@/lib/board";
import { openLightbox } from "@/lib/lightbox";
import { ago } from "@/lib/project-facts";
import { isPending, postVerdict, prepareStep, prLabel, stepDevice, stepTarget, type CheckStatus, type RecetteEntry, type RecetteStep } from "@/lib/recette";
import { setStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

// One delivery of the Recette timeline: what the operator can now do, the thread back to its card, the
// captures to look at, and its steps — the current one carrying where to go, the orchestrator's help
// and the verdict. Shared with the one-by-one session (recette-session.tsx).

export const STATE_TONE = { todo: "bg-brand", ok: "bg-status-done", ko: "bg-destructive" } as const;
const STATE_EDGE = { todo: "border-l-brand", ok: "border-l-status-done", ko: "border-l-destructive" } as const;
export const FOCUS = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
export const MOTION = "transition-colors duration-150 motion-reduce:transition-none";

export const VERDICTS = [
  { status: "ok", key: "o", Icon: Check, label: "recette.step.markOk", tip: "recette.step.tipOk", on: "border-status-done bg-status-done/15 text-status-done", idle: "text-status-done hover:border-status-done/60 hover:bg-status-done/10" },
  { status: "ko", key: "n", Icon: X, label: "recette.step.markKo", tip: "recette.step.tipKo", on: "border-destructive bg-destructive/15 text-destructive", idle: "text-destructive hover:border-destructive/60 hover:bg-destructive/10" },
  { status: "skip", key: "p", Icon: SkipForward, label: "recette.step.markSkip", tip: "recette.step.tipSkip", on: "border-foreground/50 bg-muted text-foreground", idle: "text-muted-foreground hover:border-foreground/40 hover:text-foreground" },
] as const;

/** The step's time of delivery, as the timeline reads it: « 14:05 ». */
export const clock = (ts: number) => new Date(ts).toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit" });

/**
 * A verdict, sent. « Pas bon » always files (or reuses) the correction card — no cause asked; a note
 * added afterwards lands in that same card.
 */
export function useVerdict(e: RecetteEntry, onChange: () => Promise<void>) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  async function run(stepId: string, status: CheckStatus, note?: string): Promise<boolean> {
    setBusy(true);
    try {
      const r = await postVerdict(e.cardId, stepId, { status, ...(status === "ko" ? { followUp: true } : {}), ...(note ? { note } : {}) });
      if (note) setStatus(t("recette.noteAdded"), "success");
      else if (r.followUp && r.followUp.id !== e.fixCardId) setStatus(t("recette.followUpMade"), "success");
      await onChange();
      return true;
    } catch (err) {
      setStatus(boardErrorMessage(err), "error", null);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, send: (stepId: string, status: CheckStatus) => run(stepId, status), addNote: (stepId: string, note: string) => run(stepId, "ko", note) };
}

/** « Aller voir » and « Me préparer le test » — two real buttons, where they lead written small below. */
export function StepActions({ entry: e, step: s, className }: { entry: RecetteEntry; step: RecetteStep; className?: string }) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  const target = stepTarget(s, e.cardId, e.repoPath);
  const button = cn(buttonVariants({ variant: "secondary", size: "sm" }), FOCUS);
  async function prepare() {
    setAsking(true);
    try {
      await prepareStep(e.cardId, s.id);
      setStatus(t("recette.prepare.sent"), "success", 5000);
    } catch (err) {
      setStatus(err instanceof ApiError && err.status === 409 ? t("recette.prepare.none") : boardErrorMessage(err), "error", null);
    } finally {
      setAsking(false);
    }
  }
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex flex-wrap gap-1.5">
        <Link to={target.to} className={button}>
          <ArrowUpRight aria-hidden />
          {t("recette.goSee")}
        </Link>
        <button type="button" disabled={asking} onClick={() => void prepare()} className={button}>
          <Sparkles aria-hidden />
          {t("recette.prepare")}
        </button>
      </div>
      <span className="text-xs text-muted-foreground">{t(`recette.where.${target.where}`, { repo: e.repoPath ? repoName(e.repoPath) : "" })}</span>
    </div>
  );
}

/** The three verdicts. `big`: the session's — tall, with their key. */
export function VerdictButtons({ status, busy, onPick, big }: { status?: CheckStatus; busy: boolean; onPick: (s: CheckStatus) => void; big?: boolean }) {
  const t = useT();
  return (
    <>
      {VERDICTS.map((v) => {
        const pressed = status === v.status;
        return (
          <button
            key={v.status}
            type="button"
            disabled={busy}
            onClick={() => onPick(v.status)}
            aria-pressed={pressed}
            aria-keyshortcuts={big ? v.key.toUpperCase() : undefined}
            title={t(v.tip) + (status ? ` ${t("recette.help.change")}` : "")}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-md border bg-background font-semibold disabled:opacity-50",
              big ? "h-14 rounded-xl text-base" : "h-8 px-2.5 text-xs",
              FOCUS,
              MOTION,
              pressed ? v.on : v.idle,
            )}
          >
            <v.Icon className={big ? "size-5" : "size-3.5"} aria-hidden />
            {t(v.label)}
            {big && <kbd className="ml-1 hidden font-sans text-xs font-normal text-muted-foreground lg:inline">{v.key.toUpperCase()}</kbd>}
          </button>
        );
      })}
    </>
  );
}

/** The optional note after a « Pas bon »: it lands in the correction card. */
export function KoNote({ busy, onAdd }: { busy: boolean; onAdd: (note: string) => void }) {
  const t = useT();
  const [note, setNote] = useState("");
  return (
    <form
      className="flex flex-wrap gap-1.5"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (note.trim()) onAdd(note.trim());
      }}
    >
      <input
        value={note}
        onChange={(ev) => setNote(ev.target.value)}
        placeholder={t("recette.note")}
        aria-label={t("recette.note")}
        className={cn("h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm", FOCUS)}
      />
      <button type="submit" disabled={busy || !note.trim()} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9", FOCUS)}>
        {t("recette.addNote")}
      </button>
    </form>
  );
}

export function PrLink({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-1 rounded-sm border px-2 py-px font-medium text-foreground hover:bg-muted/60", FOCUS, MOTION)}>
      <GitPullRequest className="size-3" />
      {prLabel(url)}
    </a>
  );
}

/** The thread back to the delivery, as chips: project, phase, lot, « carte : … », PR, the hour. */
export function Thread({ entry: e }: { entry: RecetteEntry }) {
  const t = useT();
  const chip = cn("rounded-sm bg-muted px-2 py-px text-muted-foreground hover:bg-muted/70 hover:text-foreground", FOCUS, MOTION);
  const project = projectPath(e.repoPath);
  return (
    <nav aria-label={t("recette.thread")} className="flex flex-wrap items-center gap-1.5 text-xs">
      {e.project && <Link to={project} className={chip}>{e.project}</Link>}
      {e.phase && <Link to={project} className={chip}>{e.phase}</Link>}
      {e.lot && <Link to={project} className={chip}>{e.lot}</Link>}
      <Link to={cardPath(e.cardId)} className={cn("rounded-sm bg-brand/12 px-2 py-px font-medium text-brand hover:bg-brand/20", FOCUS, MOTION)}>
        {t("recette.thread.card", { title: e.title ?? e.capability })}
      </Link>
      {e.prUrl && <PrLink url={e.prUrl} />}
      <span className="inline-flex items-center gap-1.5">
        <ActorToken actor="agent" />
        <time dateTime={new Date(e.deliveredAt).toISOString()} title={t("recette.thread.delivered", { ago: ago(e.deliveredAt) })} className="tabular-nums text-muted-foreground">
        {clock(e.deliveredAt)}
      </time>
      </span>
    </nav>
  );
}

function StepIcon({ step: s, current }: { step: RecetteStep; current: boolean }) {
  const t = useT();
  const status = s.verdict?.status;
  const cls = "mt-0.5 size-4 shrink-0";
  const label = <span className="sr-only">{t(`recette.step.${status ?? "todo"}`)}</span>;
  if (status === "ok") return <span>{label}<Check className={cn(cls, "text-status-done")} aria-hidden /></span>;
  if (status === "ko") return <span>{label}<X className={cn(cls, "text-destructive")} aria-hidden /></span>;
  if (status === "skip") return <span>{label}<SkipForward className={cn(cls, "text-muted-foreground")} aria-hidden /></span>;
  return <span>{label}{current ? <CircleDot className={cn(cls, "text-brand")} aria-hidden /> : <Circle className={cn(cls, "text-muted-foreground")} aria-hidden />}</span>;
}

/** « 5 vérifications, 2 faites » — or « aucune faite ». */
export function useChecksLine() {
  const t = useT();
  return (e: RecetteEntry) => {
    const done = e.steps.filter((s) => s.verdict).length;
    return `${t("recette.checks", { count: e.steps.length })}, ${done ? t("recette.checksDone", { count: done }) : t("recette.checksNone")}`;
  };
}

/** The first step still without a verdict — else a KO one, else none. */
const firstOpen = (e: RecetteEntry) => (e.steps.find((s) => !s.verdict) ?? e.steps.find((s) => s.verdict?.status === "ko"))?.id ?? null;

export function Entry({ entry: e, defaultOpen, onChange }: { entry: RecetteEntry; defaultOpen: boolean; onChange: () => Promise<void> }) {
  const t = useT();
  const checksLine = useChecksLine();
  const [unfolded, setUnfolded] = useState(defaultOpen);
  const [current, setCurrent] = useState<string | null>(() => firstOpen(e));
  const [picked, setPicked] = useState<number | null>(null);
  const { busy, send, addNote } = useVerdict(e, onChange);
  const shots = e.shots.map((s) => deliverableUrl(e.cardId, s));
  const validated = !isPending(e);
  const cur = e.steps.find((s) => s.id === current) ?? null;
  // The visual follows the current step's own capture until a thumbnail is picked.
  const stepShot = cur?.shot ? e.shots.indexOf(cur.shot) : -1;
  const shown = picked ?? (stepShot >= 0 ? stepShot : 0);
  const business = sortOf(e) === "business";
  const open = e.steps.filter((s) => !s.verdict || s.verdict.status === "ko");

  async function verdict(s: RecetteStep, status: CheckStatus) {
    if (!(await send(s.id, status))) return;
    if (status === "ko") return; // stays current: the optional note is offered there
    const after = e.steps.slice(e.steps.indexOf(s) + 1).find((x) => !x.verdict);
    setCurrent(after?.id ?? null);
    setPicked(null);
  }

  const toggle = (
    <h2>
      <button
        type="button"
        aria-expanded={unfolded}
        onClick={() => setUnfolded(!unfolded)}
        className={cn("flex w-full items-start gap-2 rounded-md text-left hover:text-foreground/80", FOCUS, MOTION)}
      >
        <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", STATE_TONE[e.state])} aria-label={t(business && e.state === "todo" ? "recette.state.proofread" : `recette.state.${e.state}`)} />
        <span className={cn("min-w-0 flex-1 font-semibold leading-snug", unfolded ? "text-base lg:text-lg" : "text-sm")}>{e.capability}</span>
        <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", unfolded && "rotate-180")} aria-hidden />
      </button>
    </h2>
  );
  const status = (
    <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
      {validated && e.state === "ok" && (
        <span className="inline-flex items-center gap-1 font-semibold text-status-done">
          <Check className="size-3.5" aria-hidden />
          {t("recette.validated")}
        </span>
      )}
      {!validated && open.length > 0 && (
        <span className={cn("font-medium", e.state === "ko" ? "text-destructive" : "text-brand")}>{t(business ? "recette.toProofread" : "recette.toTest", { count: open.length })}</span>
      )}
      <span>{checksLine(e)}</span>
    </span>
  );

  if (!unfolded) {
    return (
      <article className={cn("flex min-w-0 items-center gap-3 rounded-sm border border-l-4 bg-card p-2.5", STATE_EDGE[e.state], validated && "bg-status-done/5")}>
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onClick={() => setUnfolded(true)}
          className="hidden h-16 w-24 shrink-0 overflow-hidden rounded-md border bg-muted/40 sm:block"
        >
          {shots[0] ? <GalleryImg path={shots[0]} alt="" className="size-full object-contain" /> : <Images className="m-auto size-5 text-muted-foreground/60" />}
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Thread entry={e} />
          {toggle}
          {status}
        </div>
        <button
          type="button"
          onClick={() => setUnfolded(true)}
          className={cn(buttonVariants({ variant: "secondary", size: "sm" }), FOCUS)}
        >
          {t("recette.verify")}
        </button>
      </article>
    );
  }

  return (
    <article className={cn("flex min-w-0 flex-col overflow-hidden rounded-sm border border-l-4 bg-card", STATE_EDGE[e.state], e.state === "ko" && "bg-destructive/5")}>
      <div className={cn("flex flex-col", shots.length > 0 && "lg:grid lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]")}>
        {shots.length > 0 && (
          // What to look at: one capture large, the others as thumbnails — each capture shown once.
          <div className="flex flex-col gap-2 border-b bg-muted/30 p-2.5 lg:border-b-0 lg:border-r">
            <button
              type="button"
              onClick={() => openLightbox(shots, shown)}
              aria-label={t("deliv.open", { name: e.shots[shown]! })}
              className={cn("relative h-52 w-full overflow-hidden rounded-md border bg-background hover:border-foreground/40 lg:h-64", FOCUS, MOTION)}
            >
              <GalleryImg path={shots[shown]!} alt={e.shots[shown]!} className="size-full object-contain" />
              <ZoomIn className="absolute bottom-1.5 right-1.5 size-6 rounded-full bg-background/85 p-1 text-foreground shadow" />
            </button>
            {shots.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                {e.shots.map((name, i) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setPicked(i)}
                    aria-label={name}
                    aria-pressed={i === shown}
                    className={cn("h-10 w-14 shrink-0 overflow-hidden rounded border bg-background", i === shown ? "ring-2 ring-brand" : "opacity-70 hover:opacity-100", FOCUS, MOTION)}
                  >
                    <GalleryImg path={shots[i]!} alt="" className="size-full object-contain" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-3 p-3 lg:p-4">
          <Thread entry={e} />
          {toggle}
          {status}
          <ol className="flex flex-col gap-1">
            {e.steps.map((s) => {
              const isCurrent = s.id === current;
              return (
                <li key={s.id} className={cn("flex flex-col gap-2.5 rounded-lg px-2 py-1.5", MOTION, isCurrent && "bg-muted/60 py-2.5", s.verdict?.status === "ko" && "bg-destructive/10")}>
                  <button
                    type="button"
                    onClick={() => setCurrent(isCurrent ? null : s.id)}
                    aria-current={isCurrent ? "step" : undefined}
                    className={cn("grid w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-2.5 rounded text-left text-sm leading-snug", FOCUS)}
                  >
                    <StepIcon step={s} current={isCurrent} />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className={cn(s.verdict?.status === "ok" ? "text-muted-foreground line-through" : "text-foreground", isCurrent && "font-medium")}>{s.text}</span>
                      {s.expected && <span className="text-muted-foreground">{s.expected}</span>}
                    </span>
                    {stepDevice(s) === "phone" ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Smartphone className="size-3" aria-hidden />
                        {t("recette.phone")}
                      </span>
                    ) : (
                      <span />
                    )}
                  </button>
                  {isCurrent && (
                    <div className="flex flex-col gap-2.5 pl-[1.625rem]">
                      <div className="flex flex-wrap items-start justify-between gap-2.5">
                        <StepActions entry={e} step={s} />
                        <div className="flex flex-wrap gap-1.5">
                          <VerdictButtons status={s.verdict?.status} busy={busy} onPick={(v) => void verdict(s, v)} />
                        </div>
                      </div>
                      {s.shot && (
                        <button
                          type="button"
                          onClick={() => (e.shots.includes(s.shot!) ? setPicked(e.shots.indexOf(s.shot!)) : openLightbox([deliverableUrl(e.cardId, s.shot!)]))}
                          className={cn("self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline", FOCUS)}
                        >
                          {t("recette.shot.see")}
                        </button>
                      )}
                      {s.verdict?.status === "ko" && (
                        <>
                          {s.verdict.note && <p className="text-xs text-destructive">{s.verdict.note}</p>}
                          <KoNote busy={busy} onAdd={(n) => void addNote(s.id, n)} />
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {/* Where a « Pas bon » ends — said here, and true: the bridge files the card so. */}
          <p className="rounded-md bg-destructive/8 px-2.5 py-2 text-xs text-muted-foreground">
            {e.phase ? t("recette.koWhere", { phase: e.phase, card: e.title ?? e.capability }) : t("recette.koWhereNoPhase", { card: e.title ?? e.capability })}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {e.fixCardId && (
              <Link to={cardPath(e.fixCardId)} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "text-destructive", FOCUS)}>
                {t("recette.fixCard")}
              </Link>
            )}
            <Link to={cardPath(e.cardId)} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-muted-foreground", FOCUS)}>
              {t("recette.cardDetail")}
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
