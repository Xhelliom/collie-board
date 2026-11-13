import { useState } from "react";
import { StatusSignal } from "@/components/status-signal";
import { Lock, Play, Rocket, Trash2, TriangleAlert } from "lucide-react";

import { MENU_ITEM, MoreActions } from "@/components/project-more";
import { buttonVariants, Button } from "@/components/ui/button";
import { usePendingConfirm } from "@/hooks/use-pending-confirm";
import { BottomSheet } from "@/components/ui/sheet";
import { useT } from "@/i18n";
import { boardErrorMessage, deleteLot, launchLot, resumeLot, type CardView } from "@/lib/board";
import { lotOwner, personName, useIdentities } from "@/lib/identities";
import type { ProjectLot } from "@/lib/project";
import { setStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

// A phase's lots (ADR 0021). A PLANNED lot holds its cards and drives nothing; "Launch this lot" is
// the operator's consent (ADR 0017) — given once, for exactly the cards listed in the sheet, in the
// order they will start. Nothing here can be reached by the planning agent: the bridge refuses the
// launch to any caller carrying a pane header.

function LaunchSheet({
  lot,
  byId,
  onClose,
  onLaunched,
}: {
  lot: ProjectLot;
  byId: Map<string, CardView>;
  onClose: () => void;
  onLaunched: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const name = lot.lot.name ?? t("lot.fallbackName");

  async function go() {
    setBusy(true);
    try {
      await launchLot(lot.lot.id);
      setStatus(t("lot.launched", { name }), "success");
      onLaunched();
      onClose();
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={t("lot.sheetTitle", { name })}
      footer={
        <div className="flex w-full gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t("lot.cancel")}
          </Button>
          <Button variant="brand" className="flex-1" disabled={busy || lot.cards.length === 0} onClick={() => void go()}>
            {busy ? t("lot.launching") : t("lot.launchN", { count: lot.cards.length })}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t("lot.consent")}</p>
        <ol className="flex flex-col gap-1.5">
          {lot.cards.map((c, i) => {
            const after = c.dependsOn ? byId.get(c.dependsOn) : undefined;
            return (
              <li key={c.id} className="flex gap-2 text-sm">
                <span className="text-xs text-muted-foreground">{i + 1}.</span>
                <span className="min-w-0">
                  <b className="font-semibold">{c.title}</b>
                  {after && <span className="text-muted-foreground">{t("lot.after", { title: after.title })}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </BottomSheet>
  );
}

/** Where a lot stands, from its row and its cards. */
export function lotState(pl: ProjectLot) {
  // Planned but every card already done (by hand, in another lot): nothing left to launch.
  const planned = pl.lot.launchedAt === null && !pl.lot.doneOutside;
  // The bridge's word when it has one: a one-PR lot files its cards before its PR lands.
  const finished = pl.lot.finished ?? (pl.cards.length > 0 && pl.done === pl.cards.length);
  const halted = !planned && !finished && pl.lot.halted != null;
  return { planned, finished, halted };
}

/**
 * A lot's one gesture — « Launch this lot » (through the consent sheet) or « Resume » — greyed on another
 * pair's lot (ADR 0048 §7). Nothing when the lot runs or is over.
 */
export function LotAction({ pl, byId, onLaunched, label }: { pl: ProjectLot; byId: Map<string, CardView>; onLaunched: () => void; label?: string }) {
  const t = useT();
  const ids = useIdentities();
  const [launching, setLaunching] = useState(false);
  const [resuming, setResuming] = useState(false);
  const { planned, halted } = lotState(pl);
  const owner = lotOwner(pl.lot, ids);
  // A halted lot is the operator's: resuming picks each halted card up at the step it stopped on.
  async function resume() {
    const name = pl.lot.name ?? t("lot.fallbackName");
    setResuming(true);
    try {
      await resumeLot(pl.lot.id);
      setStatus(t("lot.resumed", { name }), "success");
      onLaunched();
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    } finally {
      setResuming(false);
    }
  }
  const cls = "h-11 sm:h-8 shrink-0 gap-1.5 rounded-sm px-3 text-sm font-semibold";
  if (planned)
    return (
      <>
        <Button variant="brand" className={cls} disabled={pl.cards.length === 0 || !!owner} title={owner ?? undefined} onClick={() => setLaunching(true)}>
          <Rocket className="size-4" />
          {t("lot.launch")}
        </Button>
        {launching && <LaunchSheet lot={pl} byId={byId} onClose={() => setLaunching(false)} onLaunched={onLaunched} />}
      </>
    );
  if (halted)
    return (
      <Button variant="brand" className={cls} disabled={resuming || !!owner} title={owner ?? undefined} onClick={() => void resume()}>
        <Play className="size-4" />
        {resuming ? t("lot.resuming") : (label ?? t("lot.resume"))}
      </Button>
    );
  return null;
}

/** Where a card of a planned lot will start: the first, with the others at launch, or after the one before. */
function startNote(pl: ProjectLot, cardId: string, t: ReturnType<typeof useT>) {
  const i = pl.cards.findIndex((c) => c.id === cardId);
  return i === 0 ? t("lot.first") : i < (pl.lot.maxParallel ?? pl.cards.length) ? t("lot.atLaunch") : t("lot.waitsPrev");
}

type Tag = "ready" | "next" | null;
const TAG_CLS: Record<Exclude<Tag, null>, string> = { ready: "bg-status-done/15 text-status-done", next: "bg-muted text-muted-foreground" };
const ROW = "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2";
const SMALL = "h-11 shrink-0 rounded-sm px-3 text-sm font-semibold sm:h-8";

/**
 * A phase's lots, in order, each labelled (v2, 13/11): the running and halted ones with their cards, the
 * READY one (the next to launch) with its cards and how each will start, the ones NEXT in one line each,
 * the EMPTY ones — planned with no card, nothing to launch — to delete, then the finished ones in one line.
 * The cards no lot has taken come last.
 */
export function PhaseLots({
  lots,
  steps,
  byId,
  onLaunched,
  renderStep,
}: {
  lots: ProjectLot[];
  /** The steps to show (the filter already applied). */
  steps: CardView[];
  byId: Map<string, CardView>;
  onLaunched: () => void;
  /** `note`: how the card will start, for a planned lot's. */
  renderStep: (card: CardView, inLot: boolean, note?: string) => React.ReactNode;
}) {
  const t = useT();
  const ids = useIdentities();
  const [showDone, setShowDone] = useState(false);
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const { pending, confirm } = usePendingConfirm();
  const shown = new Set(steps.map((s) => s.id));
  const taken = new Set(lots.flatMap((pl) => pl.lot.cardIds));
  const loose = steps.filter((s) => !taken.has(s.id));
  // A lot with nothing to show under the current filter would be an empty box — but a lot with no card at
  // all is shown, to be deleted.
  const groups = lots.map((pl) => ({ pl, own: pl.cards.filter((c) => shown.has(c.id)) }));
  const withCards = groups.filter((g) => g.own.length > 0);
  const live = withCards.filter((g) => !lotState(g.pl).planned && !lotState(g.pl).finished);
  const [ready, ...later] = withCards.filter((g) => lotState(g.pl).planned);
  const empty = groups.filter((g) => g.pl.cards.length === 0 && lotState(g.pl).planned);
  const done = withCards.filter((g) => lotState(g.pl).finished);

  const remove = async (lotIds: string[], key: string) => {
    if (!confirm(key)) return;
    try {
      for (const id of lotIds) await deleteLot(id);
      onLaunched();
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    }
  };
  const nameOf = (pl: ProjectLot) => pl.lot.name ?? t("run.lot");
  const pace = (pl: ProjectLot) => (pl.lot.maxParallel === 1 ? t("lot.oneAtATime") : pl.lot.maxParallel ? t("lot.nAtATime", { count: pl.lot.maxParallel }) : null);
  const deleteItem = (pl: ProjectLot) => (
    <button type="button" role="menuitem" data-keep-open onClick={() => void remove([pl.lot.id], pl.lot.id)} className={cn(MENU_ITEM, "text-destructive")}>
      <Trash2 className="size-4" />
      {pending === pl.lot.id ? t("lot.deleteConfirm") : t("lot.delete", { name: nameOf(pl) })}
    </button>
  );

  const block = ({ pl, own }: (typeof groups)[number], tag: Tag) => {
    const { planned, finished, halted } = lotState(pl);
    const owner = lotOwner(pl.lot, ids);
    const ownerName = owner ? personName(owner, ids[pl.lot.repoPath]?.me ?? null, t("people.me")) : null;
    return (
      <section key={pl.lot.id} aria-label={t("lot.aria", { name: pl.lot.name ?? "" })} className="flex min-w-0 flex-col gap-1">
        <div className={cn(ROW, halted ? "border-destructive/45 bg-destructive/5" : tag === "ready" ? "border-status-done/40 bg-card/40" : "bg-card/40")}>
          {tag ? (
            <span className={cn("rounded-sm px-2 py-0.5 text-xs font-semibold", TAG_CLS[tag])}>{t(tag === "ready" ? "lot.tag.ready" : "lot.tag.next")}</span>
          ) : (
            <StatusSignal status={finished ? "done" : halted ? "stuck" : "working"} decorative />
          )}
          <span className="min-w-0 flex-1 basis-48 text-sm leading-snug">
            <b className="font-semibold">{nameOf(pl)}</b>{" "}
            <span className="text-muted-foreground">
              {planned
                ? [t("lot.cards", { count: pl.cards.length }), pace(pl)].filter(Boolean).join(", ")
                : [t("lot.of", { done: pl.done, total: pl.cards.length }), pace(pl)].filter(Boolean).join(", ")}
            </span>
          </span>
          {!planned && (
            <span
              className={cn(
                "rounded-sm px-2 py-0.5 text-xs font-semibold",
                finished ? "bg-status-done/15 text-status-done" : halted ? "bg-destructive/15 text-destructive" : "bg-status-working/15 text-status-working",
              )}
            >
              {pl.lot.doneOutside ? t("lot.doneOutside") : finished ? t("lot.finished") : halted ? t("lot.halted") : ownerName ? t("people.runningAt", { name: ownerName }) : t("lot.running")}
            </span>
          )}
          {!finished &&
            pl.lot.overlaps?.map((o) => {
              const title = (id: string) => pl.cards.find((c) => c.id === id)?.title ?? id.slice(0, 8);
              const text = t("lot.overlap", { a: title(o.cardIds[0]), b: title(o.cardIds[1]), files: o.files.join(", ") });
              return (
                <span key={o.cardIds.join()} role="note" className="flex min-w-0 basis-full items-start gap-1.5 text-xs text-destructive">
                  <TriangleAlert className="mt-px size-3.5 shrink-0" />
                  <span>{text}</span>
                </span>
              );
            })}
          <span className="ml-auto flex items-center gap-2">
            <LotAction pl={pl} byId={byId} onLaunched={onLaunched} />
            {planned && <MoreActions label={t("lot.more", { name: nameOf(pl) })}>{deleteItem(pl)}</MoreActions>}
          </span>
        </div>
        {ownerName && (planned || halted) && (
          <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <Lock className="size-3.5 shrink-0" />
            <span>{t("lot.ownedBy", { name: ownerName })}</span>
          </p>
        )}
        <ul className="flex flex-col">{own.map((c) => renderStep(c, true, planned ? startNote(pl, c.id, t) : undefined))}</ul>
      </section>
    );
  };

  return (
    <div className="flex flex-col gap-2.5">
      {live.map((g) => block(g, null))}
      {ready && block(ready, "ready")}
      {later.map((g) =>
        opened.has(g.pl.lot.id) ? (
          block(g, "next")
        ) : (
          <div key={g.pl.lot.id} role="group" aria-label={t("lot.aria", { name: g.pl.lot.name ?? "" })} className={cn(ROW, "bg-card/40")}>
            <span className={cn("rounded-sm px-2 py-0.5 text-xs font-semibold", TAG_CLS.next)}>{t("lot.tag.next")}</span>
            <span className="min-w-0 flex-1 basis-48 text-sm leading-snug">
              <b className="font-semibold">{nameOf(g.pl)}</b> <span className="text-muted-foreground">{t("lot.nextLine", { count: g.pl.cards.length })}</span>
            </span>
            <Button variant="outline" className={SMALL} aria-expanded={false} onClick={() => setOpened((s) => new Set(s).add(g.pl.lot.id))}>
              {t("lot.seeCards")}
            </Button>
          </div>
        ),
      )}
      {empty.length > 0 && (
        <div role="group" aria-label={t("lot.tag.empty")} className={cn(ROW, "border-dashed")}>
          <span className="rounded-sm bg-brand/15 px-2 py-0.5 text-xs font-semibold text-brand">{t("lot.tag.empty")}</span>
          <span className="min-w-0 flex-1 basis-48 text-sm leading-snug text-muted-foreground">
            {t("lot.emptyLine", { names: empty.map((g) => nameOf(g.pl)).join(", ") })}
          </span>
          <span className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              className={cn(SMALL, pending === "empty" ? "border-destructive bg-destructive text-destructive-foreground" : "text-destructive")}
              onClick={() => void remove(empty.map((g) => g.pl.lot.id), "empty")}
            >
              <Trash2 className="size-4" />
              {pending === "empty" ? t("lot.deleteConfirm") : empty.length === 1 ? t("lot.deleteOne") : t("lot.deleteAll", { count: empty.length })}
            </Button>
            {empty.length > 1 && <MoreActions label={t("lot.emptyMore")}>{empty.map((g) => <span key={g.pl.lot.id}>{deleteItem(g.pl)}</span>)}</MoreActions>}
          </span>
        </div>
      )}
      {done.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 px-1 text-[13px] text-muted-foreground">
          <span>{t("lot.doneLine", { lots: t("project.next.lots", { count: done.length }), cards: t("lot.cards", { count: done.reduce((n, g) => n + g.pl.cards.length, 0) }) })}</span>
          <button type="button" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "ml-1")}>
            {t(showDone ? "project.hide" : "project.see")}
          </button>
        </p>
      )}
      {showDone && done.map((g) => block(g, null))}
      {loose.length > 0 && (
        <div className="flex flex-col gap-1">
          {groups.length > 0 && <span className="px-1 text-xs font-semibold text-muted-foreground">{t("lot.notIn", { count: loose.length })}</span>}
          <ul className="flex flex-col">{loose.map((c) => renderStep(c, false))}</ul>
        </div>
      )}
    </div>
  );
}
