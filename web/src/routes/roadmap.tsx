import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Link, useLoaderData, useRevalidator } from "react-router";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Maximize2, MessagesSquare, Pencil, Plus, Search, X } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { BoardTabs, RepoTitle } from "@/components/board-tabs";
import { CollapsibleText } from "@/components/collapsible-text";
import { useStoredFold } from "@/components/fold";
import { MarkdownText } from "@/components/markdown-text";
import { BottomSheet } from "@/components/ui/sheet";
import { useT } from "@/i18n";
import { isApiErrorStatus } from "@/lib/api";
import {
  boardErrorMessage,
  orchestratorPath,
  projectPath,
  repoName,
  saveDecision,
  saveRoadmap,
  type Decision,
  type Phase,
  type Roadmap,
  type RoadmapItem,
  type RoadmapStatus,
} from "@/lib/board";
import type { RoadmapData } from "@/lib/board-loaders";
import { setStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

// The roadmap as a page to read and steer: the heading (vision, objective, next milestone, progress),
// the path (everything done as ONE milestone, now, then each planned step along a scrolling line), the
// far directions (`later` items, grouped), and on the right the decisions still to settle. The loader
// rides the root poll, so an orchestrator's PUT shows on the next tick — no timer of its own.

const STATUSES: RoadmapStatus[] = ["planned", "active", "done", "dropped", "later"];
const PANEL = "rounded-xl border bg-card shadow-(--shadow-2) p-4";
const FOCUS = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const PILL = cn("inline-flex h-8 items-center gap-1.5 rounded-sm border bg-card/70 px-3 text-sm font-medium hover:border-foreground/25", FOCUS);
const FIELD = cn("w-full rounded-lg border bg-background px-3 py-2 text-sm", FOCUS);
// Solid segments, one colour per horizon: done, now, ahead.
const SEG = { done: "bg-status-done", now: "bg-status-info", ahead: "bg-muted-foreground/35" } as const;

/** The vision's headline: its `# title`, else its first sentence; and what is left of it. Pure. */
export function visionHeadline(vision: string): { headline: string; rest: string } {
  const v = vision.trim();
  const h = /^#{1,3}\s+(.+)\n?/.exec(v);
  if (h) return { headline: h[1].trim(), rest: v.slice(h[0].length).trim() };
  const s = /^(.+?[.!?])(\s+|$)/s.exec(v);
  if (s && s[1].length <= 200) return { headline: s[1].trim(), rest: v.slice(s[0].length).trim() };
  return { headline: v, rest: "" };
}

/** The roadmap's three horizons and its count. Pure. */
export function horizons(items: RoadmapItem[]) {
  const by = (s: RoadmapStatus) => items.filter((i) => i.status === s);
  const done = by("done");
  const active = by("active");
  const planned = by("planned");
  const later = by("later");
  return { done, active, planned, later, dropped: by("dropped"), total: done.length + active.length + planned.length };
}

/** `later` ideas by direction, first-seen order; the direction-less ones last. Pure. */
export function byDirection(later: RoadmapItem[]): { direction: string | null; items: RoadmapItem[] }[] {
  const groups = new Map<string, RoadmapItem[]>();
  for (const i of later) {
    const k = i.direction?.trim() ?? "";
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  return [...groups].sort(([a], [b]) => (a === "" ? 1 : 0) - (b === "" ? 1 : 0)).map(([k, items]) => ({ direction: k || null, items }));
}

function phasesOf(phases: Phase[], itemId: string) {
  return phases.filter((p) => p.roadmapItemId === itemId).sort((a, b) => a.position - b.position);
}

function Bar({ done, total, className }: { done: number; total: number; className?: string }) {
  return (
    <span role="img" aria-label={`${done}/${total}`} className={cn("flex h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <span className="bg-status-done" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
    </span>
  );
}

export function RoadmapRoute() {
  const t = useT();
  const { repo, roadmap, phases, goal = null, progress = {} } = useLoaderData() as RoadmapData;
  const revalidator = useRevalidator();
  const [editing, setEditing] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [full, setFull] = useState(false);

  if (!repo || !roadmap) {
    return (
      <Shell repo={repo}>
        <p className="text-sm text-muted-foreground">{t(repo ? "roadmap.empty" : "roadmap.view.pickRepo")}</p>
      </Shell>
    );
  }

  const items = roadmap.items;
  const h = horizons(items);
  const decisions = roadmap.decisions ?? [];

  /** Every write is the whole document at the revision read; a 409 reloads and says so. */
  async function write(patch: Partial<Pick<Roadmap, "vision" | "items">>): Promise<boolean> {
    try {
      await saveRoadmap({ repoPath: repo!, vision: roadmap!.vision, items, revision: roadmap!.revision, ...patch });
      setStatus(t("roadmap.saved"), "success");
      return true;
    } catch (e) {
      setStatus(isApiErrorStatus(e, 409) ? t("roadmap.conflict") : boardErrorMessage(e), "error", null);
      return false;
    } finally {
      void revalidator.revalidate();
    }
  }
  const add = (item: Omit<RoadmapItem, "id" | "detail">) => write({ items: [...items, { ...item, id: crypto.randomUUID().slice(0, 8), detail: "" }] });
  const editingItem = items.find((i) => i.id === editing) ?? null;

  return (
    <Shell repo={repo}>
      <h1 className="sr-only">{t("roadmap.view.title", { name: repoName(repo) })}</h1>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <Cap roadmap={roadmap} goal={goal?.text ?? null} next={h.planned[0] ?? null} done={h.done.length} total={h.total} onSave={(vision) => write({ vision })} />
          <section aria-labelledby="roadmap-path" className={cn(PANEL, "flex min-w-0 flex-col gap-3")}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 id="roadmap-path" className="text-lg font-semibold">{t("roadmap.path")}</h2>
              <span className="text-sm tabular-nums text-muted-foreground">
                {t("roadmap.path.count", { done: h.done.length, active: h.active.length, planned: h.planned.length, later: h.later.length })}
              </span>
            </div>
            <Path
              h={h}
              phases={phases}
              progress={progress}
              onOpen={setEditing}
              onHistory={() => setHistoryOpen(!historyOpen)}
              historyOpen={historyOpen}
              onExpand={() => setFull(true)}
              onAddStep={(name) => add({ name, goal: "", status: "planned" })}
            />
            {historyOpen && <History repo={repo} h={h} phases={phases} onOpen={setEditing} />}
            <Directions later={h.later} onOpen={setEditing} onAdd={(name, direction) => add({ name, goal: "", status: "later", ...(direction ? { direction } : {}) })} />
          </section>
          <NowDetail repo={repo} active={h.active} next={h.planned[0] ?? null} phases={phases} progress={progress} onOpen={setEditing} />
          <p className="px-1 text-xs text-muted-foreground">{t("roadmap.view.live", { revision: roadmap.revision })}</p>
        </div>
        <Decisions repo={repo} items={items} decisions={decisions} onDone={() => void revalidator.revalidate()} />
      </div>

      {full && (
        <FullPath onClose={() => setFull(false)}>
          <Path h={h} phases={phases} progress={progress} onOpen={setEditing} big onClose={() => setFull(false)} />
        </FullPath>
      )}
      <StepSheet
        item={editingItem}
        items={items}
        phases={phases}
        decisions={decisions}
        onClose={() => setEditing(null)}
        onSave={async (next) => (await write({ items: next })) && setEditing(null)}
      />
    </Shell>
  );
}

function Shell({ repo, children }: { repo: string | null; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col lg:max-w-none">
      <AppHeader children={<RepoTitle repos={repo ? [{ path: repo, name: repoName(repo) }] : []} />} />
      <BoardTabs />
      <main className="w-full px-4 pb-24 pt-5 lg:px-6">{children}</main>
    </div>
  );
}

// ── The heading ────────────────────────────────────────────────────────────

function Cap({ roadmap, goal, next, done, total, onSave }: {
  roadmap: Roadmap;
  goal: string | null;
  next: RoadmapItem | null;
  done: number;
  total: number;
  onSave: (vision: string) => Promise<boolean>;
}) {
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null);
  const { headline, rest } = visionHeadline(roadmap.vision);
  return (
    <section aria-labelledby="roadmap-cap" className="flex flex-col gap-4 rounded-2xl border border-status-info/40 bg-card/70 p-5">
      <div className="flex items-center gap-2">
        <h2 id="roadmap-cap" className="text-sm font-semibold text-muted-foreground">{t("roadmap.cap")}</h2>
        {draft === null && (
          <button type="button" onClick={() => setDraft(roadmap.vision)} className={cn(PILL, "ml-auto h-7 px-2.5 text-xs")}>
            <Pencil className="size-3.5" />
            {t("roadmap.cap.edit")}
          </button>
        )}
      </div>
      {draft !== null ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onSave(draft)) setDraft(null);
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t("roadmap.cap.visionLabel")}</span>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={8} className={FIELD} autoFocus />
          </label>
          <div className="flex gap-2">
            <button type="submit" className={cn(PILL, "bg-foreground text-background hover:bg-foreground/90")}>{t("roadmap.save")}</button>
            <button type="button" onClick={() => setDraft(null)} className={PILL}>{t("roadmap.cancel")}</button>
          </div>
        </form>
      ) : roadmap.vision ? (
        <div className="flex flex-col gap-2">
          <p className="text-balance text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{headline}</p>
          {rest && (
            <CollapsibleText lines={4}>
              <MarkdownText text={rest} className="max-w-prose text-sm text-muted-foreground" />
            </CollapsibleText>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("roadmap.cap.noVision")}</p>
      )}
      <dl className="grid gap-3 border-t pt-3 sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t("roadmap.cap.goal")}</dt>
          <dd className={cn("mt-0.5 line-clamp-2 text-sm font-medium", !goal && "text-muted-foreground")}>{goal ?? t("roadmap.cap.noGoal")}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t("roadmap.cap.next")}</dt>
          <dd className="mt-0.5 text-sm font-medium">
            {next ? next.name : <span className="text-muted-foreground">{t("roadmap.cap.noNext")}</span>}
            {next?.condition && <span className="block text-xs font-normal text-muted-foreground">{t("roadmap.path.waits", { condition: next.condition })}</span>}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t("roadmap.cap.progress")}</dt>
          <dd className="mt-0.5 flex flex-col gap-1.5 text-sm font-medium tabular-nums">
            {t("roadmap.cap.progressValue", { count: done, done, total })}
            <Bar done={done} total={total} />
          </dd>
        </div>
      </dl>
    </section>
  );
}

// ── The path ───────────────────────────────────────────────────────────────

type H = ReturnType<typeof horizons>;

function Path({ h, phases, progress, onOpen, onHistory, historyOpen, onExpand, onAddStep, big = false, onClose }: {
  h: H;
  phases: Phase[];
  progress: Record<string, { done: number; total: number }>;
  onOpen: (id: string) => void;
  onHistory?: () => void;
  historyOpen?: boolean;
  onExpand?: () => void;
  onAddStep?: (name: string) => void;
  big?: boolean;
  onClose?: () => void;
}) {
  const t = useT();
  const track = useRef<HTMLOListElement>(null);
  const nowRef = useRef<HTMLLIElement>(null);
  const [hidden, setHidden] = useState(0);
  const [adding, setAdding] = useState<string | null>(null);
  const w = big ? "w-56" : "w-[150px]";

  // How many planned milestones sit past the right edge — what the fade announces.
  const measure = () => {
    const el = track.current;
    if (!el) return;
    const edge = el.scrollLeft + el.clientWidth;
    setHidden([...el.querySelectorAll<HTMLElement>("[data-ahead]")].filter((n) => n.offsetLeft + n.offsetWidth / 2 > edge).length);
  };
  // Opened on Now: the past is one milestone to its left, the rest of the line ahead.
  useLayoutEffect(() => {
    const el = track.current;
    if (el && nowRef.current) el.scrollLeft = Math.max(0, nowRef.current.offsetLeft - el.offsetLeft - (big ? 240 : 160));
    measure();
  }, [big]);
  const scroll = (dir: 1 | -1) => track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.8, behavior: "smooth" });
  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") scroll(1);
      else if (e.key === "ArrowLeft") scroll(-1);
      else if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const last = h.done[h.done.length - 1];
  const milestone = (seg: keyof typeof SEG, body: React.ReactNode, extra?: { ref?: React.Ref<HTMLLIElement>; ahead?: boolean; key?: string }) => (
    <li key={extra?.key} ref={extra?.ref} data-ahead={extra?.ahead ? "" : undefined} className={cn("flex shrink-0 snap-start flex-col", w)}>
      <span aria-hidden="true" className="relative flex h-5 items-center">
        <span className={cn("h-1 w-full", SEG[seg])} />
        <span className={cn("absolute left-0 size-3.5 rounded-full border-2 border-background", SEG[seg], seg === "now" && "size-4 ring-2 ring-status-info/40")} />
      </span>
      <div className="flex min-w-0 flex-col gap-1 pr-3 pt-2">{body}</div>
    </li>
  );
  const stepButton = (it: RoadmapItem, cls?: string) => (
    <button type="button" onClick={() => onOpen(it.id)} className={cn("text-left font-semibold leading-snug hover:underline", big ? "text-base" : "text-sm", FOCUS, cls)}>
      {it.name}
    </button>
  );

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {!big && (
        <div className="flex items-center justify-end gap-1.5">
          <button type="button" onClick={() => scroll(-1)} aria-label={t("roadmap.path.prev")} className={cn(PILL, "w-8 justify-center px-0")}>
            <ChevronLeft className="size-4" />
          </button>
          <button type="button" onClick={() => scroll(1)} aria-label={t("roadmap.path.next")} className={cn(PILL, "w-8 justify-center px-0")}>
            <ChevronRight className="size-4" />
          </button>
          <button type="button" onClick={onExpand} className={PILL}>
            <Maximize2 className="size-4" />
            {t("roadmap.path.expand")}
          </button>
        </div>
      )}
      {big && (
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => scroll(-1)} aria-label={t("roadmap.path.prev")} className={cn(PILL, "w-9 justify-center px-0")}>
            <ChevronLeft className="size-4" />
          </button>
          <button type="button" onClick={() => scroll(1)} aria-label={t("roadmap.path.next")} className={cn(PILL, "w-9 justify-center px-0")}>
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
      <div className="relative">
        <ol
          ref={track}
          onScroll={measure}
          aria-label={t("roadmap.path.aria")}
          className={cn(
            "flex snap-x overflow-x-auto pb-2 [scrollbar-width:thin]",
            hidden > 0 && "[mask-image:linear-gradient(to_right,black_calc(100%-5rem),transparent)]",
          )}
        >
          {milestone(
            "done",
            <>
              <span className={cn("font-semibold leading-snug", big ? "text-base" : "text-sm")}>
                {last ? t("roadmap.path.done", { count: h.done.length, last: last.name }) : t("roadmap.path.noneDone")}
              </span>
              {onHistory && h.done.length + h.dropped.length > 0 && (
                <button type="button" onClick={onHistory} aria-expanded={historyOpen} className={cn("inline-flex items-center gap-1 self-start text-xs font-medium text-muted-foreground hover:text-foreground", FOCUS)}>
                  {t("roadmap.path.see")}
                  <ChevronDown className={cn("size-3.5 transition-transform", historyOpen && "rotate-180")} />
                </button>
              )}
            </>,
            { key: "done" },
          )}
          {(h.active.length ? h.active : [null]).map((it, i) =>
            milestone(
              "now",
              <>
                <span className="text-xs font-medium text-status-info">{t("roadmap.path.now")}</span>
                {it ? stepButton(it) : <span className="text-sm text-muted-foreground">{t("roadmap.path.nothingNow")}</span>}
                {it && big && it.goal && <span className="line-clamp-2 text-sm text-muted-foreground">{it.goal}</span>}
                {it && <NowBar phases={phasesOf(phases, it.id)} progress={progress} />}
              </>,
              { key: it?.id ?? "now", ref: i === 0 ? nowRef : undefined },
            ),
          )}
          {h.planned.map((it) =>
            milestone(
              "ahead",
              <>
                {stepButton(it)}
                {(big || !it.condition) && it.goal && <span className={cn("text-muted-foreground", big ? "line-clamp-2 text-sm" : "line-clamp-1 text-xs")}>{it.goal}</span>}
                {it.condition && <span className="text-xs text-muted-foreground">{t("roadmap.path.waits", { condition: it.condition })}</span>}
              </>,
              { key: it.id, ahead: true },
            ),
          )}
          {big &&
            byDirection(h.later).map((g) => (
              <li key={g.direction ?? ""} className={cn("flex shrink-0 snap-start flex-col", w)}>
                <span aria-hidden="true" className="flex h-5 items-center">
                  <span className="h-0 w-full border-t-2 border-dashed border-muted-foreground/40" />
                </span>
                <div className="flex flex-col gap-1 pr-3 pt-2">
                  <span className="text-sm font-semibold">{g.direction ?? t("roadmap.later.none")}</span>
                  {g.items.map((it) => stepButton(it, "text-sm font-normal text-muted-foreground"))}
                </div>
              </li>
            ))}
          {onAddStep && (
            <li className={cn("flex shrink-0 flex-col", w)}>
              <span aria-hidden="true" className="flex h-5 items-center">
                <span className="h-0 w-full border-t-2 border-dashed border-muted-foreground/30" />
              </span>
              <div className="pt-2">
                {adding === null ? (
                  <button type="button" onClick={() => setAdding("")} className={cn(PILL, "h-7 px-2.5 text-xs")}>
                    <Plus className="size-3.5" />
                    {t("roadmap.path.addStep")}
                  </button>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (adding.trim()) onAddStep(adding.trim());
                      setAdding(null);
                    }}
                  >
                    <input
                      autoFocus
                      value={adding}
                      onChange={(e) => setAdding(e.target.value)}
                      onBlur={() => !adding.trim() && setAdding(null)}
                      aria-label={t("roadmap.path.stepName")}
                      placeholder={t("roadmap.path.stepName")}
                      className={cn(FIELD, "h-8 py-1")}
                    />
                  </form>
                )}
              </div>
            </li>
          )}
        </ol>
        {hidden > 0 && (
          <span className="pointer-events-none absolute right-0 top-6 rounded-sm border bg-background px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
            {t("roadmap.path.more", { count: hidden })}
          </span>
        )}
      </div>
    </div>
  );
}

function NowBar({ phases, progress }: { phases: Phase[]; progress: Record<string, { done: number; total: number }> }) {
  const sum = phases.reduce((a, p) => ({ done: a.done + (progress[p.id]?.done ?? 0), total: a.total + (progress[p.id]?.total ?? 0) }), { done: 0, total: 0 });
  if (!sum.total) return null;
  return (
    <span className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
      <Bar done={sum.done} total={sum.total} />
      {sum.done}/{sum.total}
    </span>
  );
}

/** Full screen is a fixed overlay, not the Fullscreen API (absent on iPhone) — PageFrame's way. On a touch
 *  screen that has the API, it also asks for landscape; refused, the line scrolls sideways all the same. */
function FullPath({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !window.matchMedia?.("(pointer: coarse)").matches || !el.requestFullscreen) return;
    el.requestFullscreen()
      .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape"))
      .catch(() => {});
    return () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label={t("roadmap.path")} className="fixed inset-0 z-50 flex flex-col gap-4 overflow-y-auto bg-background p-4 lg:p-8">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-xl font-semibold">{t("roadmap.path")}</h2>
        <button type="button" onClick={onClose} autoFocus className={PILL}>
          <X className="size-4" />
          {t("common.close")}
        </button>
      </div>
      {children}
    </div>
  );
}

function History({ repo, h, phases, onOpen }: { repo: string; h: H; phases: Phase[]; onOpen: (id: string) => void }) {
  const t = useT();
  const row = (it: RoadmapItem) => {
    const mine = phasesOf(phases, it.id);
    const at = Math.max(0, ...mine.map((p) => p.closedAt ?? 0));
    return (
      <li key={it.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5 py-1.5 text-sm">
        <span className="text-xs tabular-nums text-muted-foreground">{at ? new Date(at).toLocaleDateString() : ""}</span>
        <span className="min-w-0">
          <button type="button" onClick={() => onOpen(it.id)} className={cn("text-left font-medium hover:underline", it.status === "dropped" && "text-muted-foreground line-through", FOCUS)}>
            {it.name}
          </button>
          {mine.map((p) => (
            <Link key={p.id} to={`/board/recette?repo=${encodeURIComponent(repo)}&phase=${encodeURIComponent(p.id)}`} className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline">
              {p.closedAt ? <Check className="size-3 text-status-done" aria-label={t("roadmap.view.validated")} /> : null}
              {mine.length > 1 ? p.name : t("roadmap.history.delivered")}
            </Link>
          ))}
        </span>
      </li>
    );
  };
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-background/40 p-3">
      <h3 className="text-sm font-semibold">{t("roadmap.history")}</h3>
      <ol className="divide-y">{[...h.done].reverse().map(row)}</ol>
      {h.dropped.length > 0 && (
        <>
          <h3 className="mt-2 text-sm font-semibold text-muted-foreground">{t("roadmap.history.dropped")}</h3>
          <ul className="divide-y">{h.dropped.map(row)}</ul>
        </>
      )}
    </div>
  );
}

function Directions({ later, onOpen, onAdd }: { later: RoadmapItem[]; onOpen: (id: string) => void; onAdd: (name: string, direction: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<{ name: string; direction: string } | null>(null);
  const groups = byDirection(later);
  const shown = groups.find((g) => (g.direction ?? "") === open);
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <h3 className="text-sm font-semibold">{t("roadmap.later")}</h3>
      {!groups.length && <p className="text-sm text-muted-foreground">{t("roadmap.later.empty")}</p>}
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => (
          <button
            key={g.direction ?? ""}
            type="button"
            aria-expanded={open === (g.direction ?? "")}
            onClick={() => setOpen(open === (g.direction ?? "") ? null : (g.direction ?? ""))}
            className={cn(
              "inline-flex items-center gap-2 rounded-sm border-2 border-dashed px-3 py-1 text-sm hover:border-foreground/40",
              open === (g.direction ?? "") ? "border-foreground/50 bg-muted/60" : "border-muted-foreground/40",
              FOCUS,
            )}
          >
            <span className="font-medium">{g.direction ?? t("roadmap.later.none")}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{t("roadmap.later.count", { count: g.items.length })}</span>
          </button>
        ))}
        {form === null && (
          <button type="button" onClick={() => setForm({ name: "", direction: open ?? "" })} className={PILL}>
            <Plus className="size-4" />
            {t("roadmap.later.add")}
          </button>
        )}
      </div>
      {shown && (
        <ul className="flex flex-col gap-1 pl-1">
          {shown.items.map((it) => (
            <li key={it.id} className="text-sm">
              <button type="button" onClick={() => onOpen(it.id)} className={cn("text-left hover:underline", FOCUS)}>
                {it.name}
              </button>
              {it.goal && <span className="text-muted-foreground">, {it.goal}</span>}
            </li>
          ))}
        </ul>
      )}
      {form && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (form.name.trim()) onAdd(form.name.trim(), form.direction.trim());
            setForm(null);
          }}
        >
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted-foreground">
            {t("roadmap.later.idea")}
            <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={FIELD} />
          </label>
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted-foreground">
            {t("roadmap.later.direction")}
            <input list="roadmap-directions" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} className={FIELD} />
            <datalist id="roadmap-directions">
              {groups.filter((g) => g.direction).map((g) => <option key={g.direction} value={g.direction!} />)}
            </datalist>
          </label>
          <button type="submit" className={cn(PILL, "h-9 bg-foreground text-background hover:bg-foreground/90")}>{t("roadmap.later.add")}</button>
          <button type="button" onClick={() => setForm(null)} className={cn(PILL, "h-9")}>{t("roadmap.cancel")}</button>
        </form>
      )}
    </div>
  );
}

function NowDetail({ repo, active, next, phases, progress, onOpen }: {
  repo: string;
  active: RoadmapItem[];
  next: RoadmapItem | null;
  phases: Phase[];
  progress: Record<string, { done: number; total: number }>;
  onOpen: (id: string) => void;
}) {
  const t = useT();
  return (
    <section aria-labelledby="roadmap-now" className={cn(PANEL, "flex flex-col gap-3")}>
      <h2 id="roadmap-now" className="text-lg font-semibold">{t("roadmap.path.now")}</h2>
      {!active.length && (
        <p className="text-sm text-muted-foreground">
          {t("roadmap.path.nothingNow")}
          {next && <>. {t("roadmap.cap.next")} : <b className="font-medium text-foreground">{next.name}</b></>}
        </p>
      )}
      {active.map((it) => {
        const mine = phasesOf(phases, it.id);
        return (
          <article key={it.id} className="flex flex-col gap-2 border-t pt-3 first-of-type:border-t-0 first-of-type:pt-0">
            <div className="flex items-baseline gap-2">
              <h3 className="min-w-0 flex-1 text-base font-semibold">{it.name}</h3>
              <button type="button" onClick={() => onOpen(it.id)} className={cn(PILL, "h-7 px-2.5 text-xs")}>{t("roadmap.now.details")}</button>
            </div>
            {it.goal && (
              <p className="text-sm">
                <span className="text-muted-foreground">{t("roadmap.now.goal")} : </span>
                {it.goal}
              </p>
            )}
            {!mine.length && <p className="text-sm text-muted-foreground">{t("roadmap.now.noPhase")}</p>}
            {mine.map((p) => {
              const pr = progress[p.id] ?? { done: 0, total: 0 };
              return (
                <div key={p.id} className="flex flex-col gap-1.5 rounded-xl border bg-background/40 p-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                    <span className="font-medium">{p.name}</span>
                    <span className="tabular-nums text-muted-foreground">{t("roadmap.now.left", { count: pr.total - pr.done, total: pr.total })}</span>
                    <Link to={`${projectPath(repo)}#phase-${p.id}`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "ml-auto")}>
                      {t("roadmap.now.openPhase")}
                    </Link>
                  </div>
                  <Bar done={pr.done} total={pr.total} />
                </div>
              );
            })}
          </article>
        );
      })}
    </section>
  );
}

// ── A step's sheet: read it whole, edit it, move it ────────────────────────

function StepSheet({ item, items, phases, decisions, onClose, onSave }: {
  item: RoadmapItem | null;
  items: RoadmapItem[];
  phases: Phase[];
  decisions: Decision[];
  onClose: () => void;
  onSave: (items: RoadmapItem[]) => Promise<unknown>;
}) {
  const t = useT();
  const [draft, setDraft] = useState<RoadmapItem | null>(item);
  useEffect(() => setDraft(item), [item]);
  const index = item ? items.findIndex((i) => i.id === item.id) : -1;
  const move = (dir: -1 | 1) => {
    const next = [...items];
    const [it] = next.splice(index, 1);
    next.splice(index + dir, 0, it);
    void onSave(next);
  };
  const mine = item ? phasesOf(phases, item.id) : [];
  const theirs = item ? decisions.filter((d) => d.itemId === item.id) : [];
  const set = (k: keyof RoadmapItem, v: string) => draft && setDraft({ ...draft, [k]: v });
  return (
    <BottomSheet open={!!item} onClose={onClose} title={item?.name}>
      {draft && item && (
        <form
          data-vaul-no-drag
          className="flex flex-col gap-3 overflow-y-auto px-4 pb-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.name.trim()) void onSave(items.map((i) => (i.id === item.id ? { ...draft, name: draft.name.trim() } : i)));
          }}
        >
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="flex-1 tabular-nums">{t("roadmap.step.position", { n: index + 1, total: items.length })}</span>
            <button type="button" disabled={index <= 0} onClick={() => move(-1)} className={cn(PILL, "h-7 px-2.5 text-xs disabled:opacity-40")}>
              <ChevronLeft className="size-3.5" />
              {t("roadmap.step.earlier")}
            </button>
            <button type="button" disabled={index >= items.length - 1} onClick={() => move(1)} className={cn(PILL, "h-7 px-2.5 text-xs disabled:opacity-40")}>
              {t("roadmap.step.later")}
              <ChevronRight className="size-3.5" />
            </button>
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("roadmap.step.name")}
            <input value={draft.name} onChange={(e) => set("name", e.target.value)} className={FIELD} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("roadmap.step.goal")}
            <input value={draft.goal} onChange={(e) => set("goal", e.target.value)} className={FIELD} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("roadmap.step.status")}
            <select value={draft.status} onChange={(e) => set("status", e.target.value)} className={FIELD}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{t(`roadmap.status.${s}`)}</option>
              ))}
            </select>
          </label>
          {draft.status === "later" ? (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t("roadmap.later.direction")}
              <input value={draft.direction ?? ""} onChange={(e) => set("direction", e.target.value)} className={FIELD} />
            </label>
          ) : (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t("roadmap.step.condition")}
              <input value={draft.condition ?? ""} onChange={(e) => set("condition", e.target.value)} className={FIELD} />
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("roadmap.step.detail")}
            <textarea value={draft.detail ?? ""} onChange={(e) => set("detail", e.target.value)} rows={6} className={FIELD} />
          </label>
          {item.detail ? (
            <CollapsibleText className="text-muted-foreground">
              <MarkdownText text={item.detail} className="text-sm" />
            </CollapsibleText>
          ) : (
            <p className="text-sm text-muted-foreground">{t("roadmap.noDetail")}</p>
          )}
          {mine.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">{t("roadmap.view.phases")}</span>
              <ul className="flex flex-wrap gap-1.5">
                {mine.map((p) => (
                  <li key={p.id} className={cn("inline-flex items-center gap-1 rounded-sm border px-2.5 py-0.5 text-xs", p.closedAt && "border-status-done/50")}>
                    {p.closedAt ? <Check className="size-3 text-status-done" aria-label={t("roadmap.view.validated")} /> : null}
                    {p.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {theirs.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">{t("roadmap.phaseDecisions")}</span>
              <ul aria-label={t("roadmap.phaseDecisions")} className="flex flex-col gap-1 text-sm text-muted-foreground">
                {theirs.map((d) => (
                  <li key={d.id}>
                    <span className="font-medium text-foreground">{t(`roadmap.decision.${d.status}`)} : </span>
                    {d.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex gap-2">
            <button type="submit" className={cn(PILL, "bg-foreground text-background hover:bg-foreground/90")}>{t("roadmap.save")}</button>
            <button type="button" onClick={onClose} className={PILL}>{t("roadmap.cancel")}</button>
          </div>
        </form>
      )}
    </BottomSheet>
  );
}

// ── Decisions ──────────────────────────────────────────────────────────────

function Decisions({ repo, items, decisions, onDone }: { repo: string; items: RoadmapItem[]; decisions: Decision[]; onDone: () => void }) {
  const t = useT();
  const open = decisions.filter((d) => d.status === "open");
  const leaning = decisions.filter((d) => d.status === "leaning");
  const decided = decisions.filter((d) => d.status === "decided");
  const [leaningOpen, setLeaningOpen] = useStoredFold("roadmap-leaning", true);
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);
  const q = query.trim().toLowerCase();
  const found = q ? decided.filter((d) => d.text.toLowerCase().includes(q)) : all ? [...decided].reverse() : [];
  const lastDecided = decided[decided.length - 1];
  const line = (d: Decision, settle: boolean) => <DecisionLine key={d.id} repo={repo} d={d} step={items.find((i) => i.id === d.itemId)?.name} settle={settle} onDone={onDone} />;

  return (
    <aside aria-label={t("roadmap.journal")} className="flex min-w-0 flex-col gap-4">
      <section aria-labelledby="dec-open" className={cn(PANEL, "flex flex-col gap-3 border-status-blocked/50")}>
        <h2 id="dec-open" className="flex items-baseline gap-2 text-lg font-semibold">
          {t("roadmap.dec.open")}
          <span className="text-sm font-normal tabular-nums text-muted-foreground">{open.length}</span>
        </h2>
        {open.length ? <ul className="flex flex-col divide-y">{open.map((d) => line(d, true))}</ul> : <p className="text-sm text-muted-foreground">{t("roadmap.dec.openEmpty")}</p>}
      </section>
      {leaning.length > 0 && (
        <section className={cn(PANEL, "flex flex-col gap-2")}>
          <button type="button" onClick={() => setLeaningOpen(!leaningOpen)} aria-expanded={leaningOpen} className={cn("flex items-center gap-2 text-left text-lg font-semibold", FOCUS)}>
            {t("roadmap.dec.leaning")}
            <span className="text-sm font-normal tabular-nums text-muted-foreground">{leaning.length}</span>
            <ChevronDown className={cn("ml-auto size-4 text-muted-foreground transition-transform", leaningOpen && "rotate-180")} />
          </button>
          {leaningOpen && <ul className="flex flex-col divide-y">{leaning.map((d) => line(d, true))}</ul>}
        </section>
      )}
      <section aria-labelledby="dec-decided" className={cn(PANEL, "flex flex-col gap-3")}>
        <h2 id="dec-decided" className="flex items-baseline gap-2 text-lg font-semibold">
          {t("roadmap.dec.decided")}
          <span className="text-sm font-normal tabular-nums text-muted-foreground">{decided.length}</span>
        </h2>
        {lastDecided && !q && !all && (
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">{t("roadmap.dec.last")}</span>
            <ul>{line(lastDecided, false)}</ul>
          </div>
        )}
        {decided.length > 0 && (
          <label className="relative">
            <span className="sr-only">{t("roadmap.dec.search")}</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("roadmap.dec.search")} className={cn(FIELD, "h-9 pl-8")} />
          </label>
        )}
        {q && !found.length && <p className="text-sm text-muted-foreground">{t("roadmap.dec.noMatch")}</p>}
        {found.length > 0 && <ul className="flex flex-col divide-y">{found.map((d) => line(d, false))}</ul>}
        {!q && decided.length > 1 && (
          <button type="button" onClick={() => setAll(!all)} className={cn("self-start text-sm font-medium text-muted-foreground hover:text-foreground", FOCUS)}>
            {all ? t("roadmap.dec.less") : t("roadmap.dec.all", { count: decided.length })}
          </button>
        )}
      </section>
    </aside>
  );
}

/** One decision: its short form, the whole text on a tap; settling and talking it over for the unsettled. */
function DecisionLine({ repo, d, step, settle, onDone }: { repo: string; d: Decision; step?: string; settle: boolean; onDone: () => void }) {
  const t = useT();
  const [whole, setWhole] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  async function record(status: "decided" | "leaning") {
    try {
      await saveDecision(repo, { id: d.id, text: (answer ?? d.text).trim() || d.text, status, itemId: d.itemId, ...(d.cardId ? { cardId: d.cardId } : {}), ...(d.domain ? { domain: d.domain } : {}) });
      setStatus(t("roadmap.dec.settled"), "success");
      setAnswer(null);
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    } finally {
      onDone();
    }
  }
  return (
    <li className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0">
      <button type="button" onClick={() => setWhole(!whole)} aria-expanded={whole} className={cn("text-left text-sm", FOCUS)}>
        {d.domain === "product" && <span className="mr-1.5 rounded bg-muted px-1 text-xs font-medium">{t("roadmap.decision.product")}</span>}
        <span className={cn(!whole && "line-clamp-2")}>{d.text}</span>
        {step && <span className="mt-0.5 block text-xs text-muted-foreground">{step}</span>}
      </button>
      {/* A leaning one shows its actions once unfolded: nine of them in a row would read as noise. */}
      {settle && answer === null && (d.status === "open" || whole) && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setAnswer(d.text)} className={cn(PILL, "h-7 px-2.5 text-xs")}>
            <Check className="size-3.5" />
            {t("roadmap.dec.settle")}
          </button>
          <Link to={orchestratorPath(repo, t("roadmap.dec.talkDraft", { text: d.text }))} className={cn(PILL, "h-7 px-2.5 text-xs")}>
            <MessagesSquare className="size-3.5" />
            {t("roadmap.dec.talk")}
          </Link>
        </div>
      )}
      {answer !== null && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("roadmap.dec.answer")}
            <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={3} className={FIELD} autoFocus />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void record("decided")} className={cn(PILL, "h-7 bg-foreground px-2.5 text-xs text-background hover:bg-foreground/90")}>
              {t("roadmap.dec.asDecided")}
            </button>
            {d.status === "open" && (
              <button type="button" onClick={() => void record("leaning")} className={cn(PILL, "h-7 px-2.5 text-xs")}>
                {t("roadmap.dec.asLeaning")}
              </button>
            )}
            <button type="button" onClick={() => setAnswer(null)} className={cn(PILL, "h-7 px-2.5 text-xs")}>{t("roadmap.cancel")}</button>
          </div>
        </div>
      )}
    </li>
  );
}
