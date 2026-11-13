import { useState } from "react";
import { Lock, Play, Rocket, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { useT } from "@/i18n";
import { boardErrorMessage, launchLot, resumeLot, type CardView } from "@/lib/board";
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
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{i + 1}.</span>
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
  const cls = "h-8 shrink-0 gap-1.5 rounded-[10px] px-3 text-sm font-semibold";
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

/**
 * A phase's body: each lot a line (status, x of y, its gesture) holding its cards one line each, then the
 * cards no lot has taken. The finished lots fold into one line — « F1 and F2 finished » — opened on demand.
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
  renderStep: (card: CardView, inLot: boolean) => React.ReactNode;
}) {
  const t = useT();
  const ids = useIdentities();
  const [showDone, setShowDone] = useState(false);
  const shown = new Set(steps.map((s) => s.id));
  const taken = new Set(lots.flatMap((pl) => pl.lot.cardIds));
  const loose = steps.filter((s) => !taken.has(s.id));
  // A lot with nothing to show under the current filter would be an empty box.
  const groups = lots.map((pl) => ({ pl, own: pl.cards.filter((c) => shown.has(c.id)) })).filter((g) => g.own.length > 0);
  const done = groups.filter((g) => lotState(g.pl).finished);
  const lot = ({ pl, own }: (typeof groups)[number]) => {
    const { planned, finished, halted } = lotState(pl);
    const owner = lotOwner(pl.lot, ids);
    const ownerName = owner ? personName(owner, ids[pl.lot.repoPath]?.me ?? null, t("people.me")) : null;
    return (
      <section key={pl.lot.id} aria-label={t("lot.aria", { name: pl.lot.name ?? "" })} className="flex min-w-0 flex-col gap-1">
        <div
          className={cn(
            "flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border px-3 py-2",
            halted ? "border-status-blocked/45 bg-status-blocked/5" : "bg-card/40",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-2 shrink-0 rounded-full",
              planned ? "bg-muted-foreground/50" : finished ? "bg-status-done" : halted ? "bg-status-blocked" : "bg-status-working",
            )}
          />
          <span className="min-w-0 text-sm font-semibold leading-snug">{pl.lot.name ?? t("run.lot")}</span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-semibold",
              planned
                ? "bg-muted text-muted-foreground"
                : finished
                  ? "bg-status-done/15 text-status-done"
                  : halted
                    ? "bg-status-blocked/15 text-status-blocked"
                    : "bg-status-working/15 text-status-working",
            )}
          >
            {planned ? t("lot.planned") : pl.lot.doneOutside ? t("lot.doneOutside") : finished ? t("lot.finished") : halted ? t("lot.halted") : ownerName ? t("people.runningAt", { name: ownerName }) : t("lot.running")}
          </span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{t("lot.of", { done: pl.done, total: pl.cards.length })}</span>
          {pl.lot.maxParallel ? (
            <span className="font-mono text-xs text-muted-foreground">
              {pl.lot.maxParallel === 1 ? t("lot.oneAtATime") : t("lot.nAtATime", { count: pl.lot.maxParallel })}
            </span>
          ) : null}
          {!finished &&
            pl.lot.overlaps?.map((o) => {
              const title = (id: string) => pl.cards.find((c) => c.id === id)?.title ?? id.slice(0, 8);
              const text = t("lot.overlap", { a: title(o.cardIds[0]), b: title(o.cardIds[1]), files: o.files.join(", ") });
              return (
                <span key={o.cardIds.join()} role="note" title={text} className="flex min-w-0 flex-1 basis-48 items-center gap-1.5 text-xs text-status-blocked">
                  <TriangleAlert className="size-3.5 shrink-0" />
                  <span className="truncate">{text}</span>
                </span>
              );
            })}
          <span className="ml-auto" />
          <LotAction pl={pl} byId={byId} onLaunched={onLaunched} />
        </div>
        {ownerName && (planned || halted) && (
          <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <Lock className="size-3.5 shrink-0" />
            <span>{t("lot.ownedBy", { name: ownerName })}</span>
          </p>
        )}
        <ul className="flex flex-col">{own.map((c) => renderStep(c, true))}</ul>
      </section>
    );
  };
  return (
    <div className="flex flex-col gap-3">
      {groups.filter((g) => !lotState(g.pl).finished).map(lot)}
      {done.length > 0 && (
        <p className="px-1 text-[13px] text-muted-foreground">
          {t("lot.doneSummary", {
            names: done.map((g) => g.pl.lot.name ?? t("run.lot")).join(", "),
            count: done.reduce((n, g) => n + g.pl.cards.length, 0),
          })}{" "}
          <button type="button" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)} className="font-semibold text-brand">
            {t(showDone ? "project.hide" : "project.see")}
          </button>
        </p>
      )}
      {showDone && done.map(lot)}
      {loose.length > 0 && (
        <div className="flex flex-col gap-1">
          {groups.length > 0 && <span className="px-1 text-xs font-semibold text-muted-foreground">{t("lot.notIn", { count: loose.length })}</span>}
          <ul className="flex flex-col">{loose.map((c) => renderStep(c, false))}</ul>
        </div>
      )}
    </div>
  );
}
