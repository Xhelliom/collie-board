import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useRevalidator } from "react-router";

import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { useT } from "@/i18n";
import { boardErrorMessage } from "@/lib/board";
import { duration } from "@/lib/project-facts";
import { checkedByDefault, closeTidy, fetchTidy, TIDY_REASONS, type TidyCandidate } from "@/lib/tidy";

// « Ménage »: the panes that no longer serve, grouped by why, each with its age. Bare shells start
// unchecked (the operator may be typing in one). Closing takes a second tap that names the count —
// the bridge then closes only what is still proposed, so a pane that went back to work stays.
export function TidySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const revalidator = useRevalidator();
  // ponytail: the threshold is not remembered between openings — store it if 2 h keeps being changed.
  const [hours, setHours] = useState(2);
  const [list, setList] = useState<TidyCandidate[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setError(null);
    setConfirm(false);
    fetchTidy(hours)
      .then(({ candidates }) => {
        if (!live) return;
        setList(candidates);
        setChecked(new Set(candidates.filter(checkedByDefault).map((c) => c.paneId)));
      })
      .catch((e) => live && setError(boardErrorMessage(e)));
    return () => {
      live = false;
    };
  }, [open, hours, done]);

  const toggle = (id: string) =>
    setChecked((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });

  async function close() {
    setBusy(true);
    setError(null);
    try {
      const r = await closeTidy([...checked], hours);
      if (r.failed.length) setError(r.failed.map((f) => `${f.paneId}: ${f.error}`).join("\n"));
      setDone(r.closed.length);
      void revalidator.revalidate();
    } catch (e) {
      setError(boardErrorMessage(e));
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  const n = checked.size;
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t("tidy.title")}
      footer={
        confirm ? (
          <div className="flex w-full gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>
              {t("tidy.cancel")}
            </Button>
            <Button variant="destructive" className="flex-1" disabled={busy} onClick={() => void close()}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t("tidy.confirm", { count: n })}
            </Button>
          </div>
        ) : (
          <Button variant="brand" className="w-full" disabled={n === 0} onClick={() => setConfirm(true)}>
            {t("tidy.close", { count: n })}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4" data-vaul-no-drag>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t("tidy.idleAfter")}
          <input
            type="number"
            min={0.5}
            step={0.5}
            value={hours}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v > 0) setHours(v);
            }}
            className="h-8 w-16 rounded-md border border-border bg-background px-2 text-sm tabular-nums"
          />
          {t("tidy.hours")}
        </label>
        {done !== null && <p role="status" className="text-sm">{t("tidy.closed", { count: done })}</p>}
        {error && (
          <p role="alert" className="whitespace-pre-line text-sm text-destructive">
            {error}
          </p>
        )}
        {list === null && !error && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
        {list?.length === 0 && <p className="text-sm text-muted-foreground">{t("tidy.empty")}</p>}
        {TIDY_REASONS.map((reason) => {
          const rows = list?.filter((c) => c.reason === reason) ?? [];
          if (rows.length === 0) return null;
          return (
            <section key={reason} className="flex flex-col gap-1.5">
              <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
                {t(`tidy.reason.${reason}`)} <span className="opacity-70">({rows.length})</span>
              </h3>
              {rows.map((c) => (
                <label key={c.paneId} className="flex min-h-11 items-center gap-3 rounded-lg px-1 py-1.5 hover:bg-accent">
                  <input type="checkbox" className="size-4 shrink-0" checked={checked.has(c.paneId)} onChange={() => toggle(c.paneId)} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">{c.cardTitle ?? c.label ?? `${c.workspaceLabel} · ${c.agent}`}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {c.workspaceLabel}
                      {c.since !== null && ` · ${t(`tidy.since.${reason}`, { duration: duration(Date.now() - c.since) })}`}
                    </span>
                  </span>
                </label>
              ))}
            </section>
          );
        })}
      </div>
    </BottomSheet>
  );
}
