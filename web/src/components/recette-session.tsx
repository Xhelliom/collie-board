import { useEffect, useRef, useState } from "react";
import { Check, Images, SkipForward, X, ZoomIn } from "lucide-react";

import { GalleryImg } from "@/components/gallery-img";
import { buttonVariants } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { useT } from "@/i18n";
import { deliverableUrl } from "@/lib/board";
import { openLightbox } from "@/lib/lightbox";
import { stepDevice, type CheckStatus, type Device, type RecetteEntry, type RecetteStep } from "@/lib/recette";
import { cn } from "@/lib/utils";

import { FOCUS, KoNote, StepActions, Thread, useVerdict, VerdictButtons, VERDICTS } from "./recette-entry";

// « Vérifier une à une »: one step at a time, large — what to do, what to see, where, the three verdicts
// (keys O / N / P), the session's progress, a filter by device. Its place lives in the URL (the
// route's `session` and `step` params), so « Aller voir » and back lands on the same step.

export type SessionDevice = "all" | Device;

interface Item {
  e: RecetteEntry;
  s: RecetteStep;
}

/** The steps of these entries a device shows, in order. Pure. */
export function sessionItems(entries: readonly RecetteEntry[], device: SessionDevice): Item[] {
  return entries.flatMap((e) => e.steps.filter((s) => device === "all" || stepDevice(s) === device).map((s) => ({ e, s })));
}

const keyOf = (i: Item) => `${i.e.cardId}/${i.s.id}`;

export function RecetteSession({
  entries,
  device,
  stepKey,
  onDevice,
  onStep,
  onQuit,
  onChange,
}: {
  entries: RecetteEntry[];
  device: SessionDevice;
  stepKey: string | null;
  onDevice: (d: SessionDevice) => void;
  onStep: (key: string | null) => void;
  onQuit: () => void;
  onChange: () => Promise<void>;
}) {
  const t = useT();
  // The deliveries this session started with: one validated mid-session keeps its place in the count.
  const [cards] = useState(() => new Set(entries.map((e) => e.cardId)));
  const items = sessionItems(
    entries.filter((e) => cards.has(e.cardId)),
    device,
  );
  const atKey = items.findIndex((i) => keyOf(i) === stepKey);
  const index = atKey >= 0 ? atKey : items.findIndex((i) => !i.s.verdict);
  const item = index >= 0 ? items[index]! : null;
  const [tally, setTally] = useState({ ok: 0, ko: 0, skip: 0 });
  const quitRef = useRef<HTMLButtonElement>(null);
  useEffect(() => quitRef.current?.focus(), []);

  return (
    <div role="dialog" aria-modal="true" aria-label={t("recette.oneByOne")} className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex flex-col gap-2.5 border-b px-4 py-3 lg:px-8">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button ref={quitRef} type="button" onClick={onQuit} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2", FOCUS)}>
            <X aria-hidden />
            {t("recette.session.quit")}
          </button>
          <div className="flex min-w-[10rem] flex-1 flex-col gap-1.5">
            <span className="text-xs tabular-nums text-muted-foreground">{t("recette.session.progress", { n: index + 1 > 0 ? index + 1 : items.length, total: items.length })}</span>
            <span className="h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={items.filter((i) => i.s.verdict).length}>
              <span className="block h-full rounded-full bg-status-done" style={{ width: `${items.length ? (items.filter((i) => i.s.verdict).length / items.length) * 100 : 0}%` }} />
            </span>
          </div>
          <span className="flex items-center gap-3 text-xs tabular-nums" aria-label={t("recette.session.tally")}>
            <span className="inline-flex items-center gap-1 text-status-done"><Check className="size-3.5" aria-label={t("recette.step.markOk")} />{tally.ok}</span>
            <span className="inline-flex items-center gap-1 text-destructive"><X className="size-3.5" aria-label={t("recette.step.markKo")} />{tally.ko}</span>
            <span className="inline-flex items-center gap-1 text-muted-foreground"><SkipForward className="size-3.5" aria-label={t("recette.step.markSkip")} />{tally.skip}</span>
          </span>
        </div>
        <div role="group" aria-label={t("recette.session.device")} className="flex gap-1.5">
          {(["all", "desktop", "phone"] as const).map((d) => (
            <Chip key={d} label={t(`recette.session.${d}`)} active={device === d} onClick={() => onDevice(d)} />
          ))}
        </div>
      </header>

      {item ? (
        <SessionStep
          key={keyOf(item)}
          item={item}
          onChange={onChange}
          onJudged={(status) => {
            setTally((x) => ({ ...x, [status]: x[status] + 1 }));
            if (status === "ko") return onStep(keyOf(item)); // pinned: the optional note is offered here
            const next = [...items.slice(index + 1), ...items.slice(0, index)].find((i) => !i.s.verdict);
            onStep(next ? keyOf(next) : "done");
          }}
          onNext={() => {
            const next = [...items.slice(index + 1), ...items.slice(0, index)].find((i) => !i.s.verdict);
            onStep(next ? keyOf(next) : "done");
          }}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <Check className="size-8 text-status-done" aria-hidden />
          <p className="text-lg font-semibold">{t("recette.session.done")}</p>
          <button type="button" onClick={onQuit} className={cn(buttonVariants({ variant: "secondary" }), FOCUS)}>
            {t("recette.session.quit")}
          </button>
        </div>
      )}
    </div>
  );
}

function SessionStep({ item: { e, s }, onChange, onJudged, onNext }: { item: Item; onChange: () => Promise<void>; onJudged: (s: CheckStatus) => void; onNext: () => void }) {
  const t = useT();
  const { busy, send, addNote } = useVerdict(e, onChange);
  const [koed, setKoed] = useState(false);
  const shots = e.shots.map((n) => deliverableUrl(e.cardId, n));
  const at = s.shot && e.shots.includes(s.shot) ? e.shots.indexOf(s.shot) : 0;
  const shot = s.shot && !e.shots.includes(s.shot) ? deliverableUrl(e.cardId, s.shot) : shots[at];

  async function judge(status: CheckStatus) {
    if (busy || !(await send(s.id, status))) return;
    if (status === "ko") setKoed(true);
    onJudged(status);
  }

  // O / N / P, as the buttons say — not while typing the note.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const el = ev.target as HTMLElement | null;
      if (ev.ctrlKey || ev.metaKey || ev.altKey || el?.closest("input, textarea, [contenteditable]")) return;
      const v = VERDICTS.find((x) => x.key === ev.key.toLowerCase());
      if (!v) return;
      ev.preventDefault();
      void judge(v.status);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-28 lg:pb-8">
      <div className="mx-auto grid w-full max-w-screen-xl gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_30rem] lg:gap-10 lg:p-8">
        {shot ? (
          <button
            type="button"
            onClick={() => (e.shots.includes(s.shot ?? e.shots[0]!) ? openLightbox(shots, at) : openLightbox([shot]))}
            aria-label={t("deliv.open", { name: s.shot ?? e.shots[0]! })}
            className={cn("relative h-60 overflow-hidden rounded-sm border bg-muted/40 lg:h-[36rem]", FOCUS)}
          >
            <GalleryImg path={shot} alt={s.shot ?? e.shots[0]!} className="size-full object-contain" />
            <ZoomIn className="absolute bottom-2 right-2 size-7 rounded-full bg-background/85 p-1.5 text-foreground shadow" />
          </button>
        ) : (
          <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-sm border border-dashed text-sm text-muted-foreground lg:h-[36rem]">
            <Images className="size-6" aria-hidden />
            {t("recette.session.noShot")}
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-2">
            <span className="text-sm text-muted-foreground">{e.capability}</span>
            <Thread entry={e} />
          </div>
          <section className="flex flex-col gap-1.5">
            <h2 className="text-xs font-medium text-muted-foreground">{t("recette.session.todo")}</h2>
            <p className="text-xl font-semibold leading-snug lg:text-2xl">{s.text}</p>
          </section>
          {s.expected && (
            <section className="flex flex-col gap-1.5">
              <h2 className="text-xs font-medium text-muted-foreground">{t("recette.session.expect")}</h2>
              <p className="text-base leading-relaxed lg:text-lg">{s.expected}</p>
            </section>
          )}
          <StepActions entry={e} step={s} />
          <div className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-3 gap-2 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:static lg:border-0 lg:bg-transparent lg:p-0">
            <VerdictButtons big status={s.verdict?.status} busy={busy} onPick={(v) => void judge(v)} />
          </div>
          {(koed || s.verdict?.status === "ko") && (
            <div className="flex flex-col gap-2 rounded-xl bg-destructive/8 p-3">
              <KoNote busy={busy} onAdd={(n) => void addNote(s.id, n).then((ok) => ok && onNext())} />
              <button type="button" onClick={onNext} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "self-start", FOCUS)}>
                {t("recette.session.continue")}
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
