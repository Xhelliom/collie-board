import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Target } from "lucide-react";

import { useT } from "@/i18n";
import { usePendingConfirm } from "@/hooks/use-pending-confirm";
import { boardErrorMessage, cardPath, createGoal, editGoal, fetchGoals, moveGoal, type Goal, type GoalBudget, type GoalMove } from "@/lib/board";
import { setStatus } from "@/lib/status";

const OPEN = new Set(["active", "paused", "claimed"]);
const DEFAULT_BUDGET: GoalBudget = { maxLots: 10, quotaPct: 80, deadline: null };

// A date input's "2026-12-01" and back, in local time; the deadline is the end of that day.
const toDay = (ms: number | null) => (ms === null ? "" : new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 10));
const fromDay = (d: string) => (d ? new Date(`${d}T23:59:59`).getTime() : null);

const field = "rounded-md border border-border bg-background px-2 py-1.5 text-sm";

function GoalForm({ initial, onSave, onCancel }: { initial: Goal | null; onSave: (g: { text: string; criteria: string[]; budget: GoalBudget }) => void; onCancel: () => void }) {
  const t = useT();
  const [text, setText] = useState(initial?.text ?? "");
  const [criteria, setCriteria] = useState(initial?.criteria.join("\n") ?? "");
  const b = initial?.budget ?? DEFAULT_BUDGET;
  // Typed as text so a field can be emptied to type another number; checked on save.
  const [lots, setLots] = useState(String(b.maxLots));
  const [quota, setQuota] = useState(String(b.quotaPct));
  const [deadline, setDeadline] = useState<number | null>(b.deadline);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const list = criteria.split("\n").map((c) => c.trim()).filter(Boolean);
    const maxLots = Number(lots);
    const quotaPct = Number(quota);
    const ok = Number.isInteger(maxLots) && maxLots >= 1 && maxLots <= 1000 && Number.isInteger(quotaPct) && quotaPct >= 1 && quotaPct <= 100;
    if (!text.trim() || list.length === 0 || !ok) return setStatus(t("goal.invalid"), "error", 3000);
    onSave({ text: text.trim(), criteria: list, budget: { maxLots, quotaPct, deadline } });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t("goal.text")}
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t("goal.criteria")}
        <textarea value={criteria} onChange={(e) => setCriteria(e.target.value)} rows={3} className={field} />
      </label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("goal.maxLots")}
          <input type="number" min={1} max={1000} value={lots} onChange={(e) => setLots(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("goal.quotaPct")}
          <input type="number" min={1} max={100} value={quota} onChange={(e) => setQuota(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("goal.deadline")}
          <input type="date" value={toDay(deadline)} onChange={(e) => setDeadline(fromDay(e.target.value))} className={field} />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-full border px-3 py-1.5 text-xs hover:bg-muted/60">
          {t("goal.cancel")}
        </button>
        <button type="submit" className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
          {t("goal.save")}
        </button>
      </div>
    </form>
  );
}

// The repo's objective (ADR 0056), at the top of the project page. Every write here is the operator's:
// the bridge refuses them from an agent pane, which may only claim the objective reached.
export function GoalPanel({ repo, titleOf }: { repo: string; titleOf: (cardId: string) => string | undefined }) {
  const t = useT();
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [refusal, setRefusal] = useState("");
  const { pending, confirm } = usePendingConfirm();

  useEffect(() => {
    const ac = new AbortController();
    setGoals(null);
    setEditing(false);
    fetchGoals(repo, ac.signal)
      .then((r) => setGoals(r.goals))
      .catch(() => {});
    return () => ac.abort();
  }, [repo]);

  if (!goals) return null;
  const open = goals.find((g) => OPEN.has(g.status)) ?? null;
  const last = open ? null : (goals[0] ?? null);
  const put = (g: Goal) => setGoals((all) => [g, ...(all ?? []).filter((x) => x.id !== g.id)]);

  const save = async (g: { text: string; criteria: string[]; budget: GoalBudget }) => {
    try {
      put((open ? await editGoal(open.id, g) : await createGoal(repo, g)).goal);
      setEditing(false);
      setStatus(t("goal.saved"), "success", 2000);
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    }
  };
  const move = async (m: GoalMove, comment?: string) => {
    if (!open || (m === "abandon" && !confirm(open.id))) return;
    try {
      put((await moveGoal(open.id, m, comment)).goal);
      setRefusal("");
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    }
  };
  const btn = "rounded-full border px-3 py-1.5 text-xs hover:bg-muted/60";

  return (
    <section aria-label={t("goal.title")} className="flex flex-col gap-2.5 rounded-2xl border bg-card/60 p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <Target className="size-3.5" />
          {t("goal.title")}
          {open && <span className="rounded-full border px-2 py-0.5 normal-case tracking-normal">{t(`goal.status.${open.status}`)}</span>}
        </span>
        {open && !editing && (
          <button type="button" onClick={() => setEditing(true)} className={btn}>
            {t("goal.edit")}
          </button>
        )}
      </div>
      {editing ? (
        <GoalForm initial={open} onSave={(g) => void save(g)} onCancel={() => setEditing(false)} />
      ) : !open ? (
        <>
          <p className="text-xs text-muted-foreground">{t("goal.none")}</p>
          {last && <p className="text-xs text-muted-foreground">{t("goal.last", { text: last.text, status: t(`goal.status.${last.status}`) })}</p>}
          <button type="button" onClick={() => setEditing(true)} className="self-start rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
            {t("goal.define")}
          </button>
        </>
      ) : (
        <>
          <p className="text-[15px] font-medium">{open.text}</p>
          <div>
            <span className="text-xs text-muted-foreground">{t("goal.criteriaTitle")}</span>
            <ul className="mt-1 list-disc pl-5">
              {open.criteria.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs tabular-nums text-muted-foreground">
            <span>{t("goal.lots", { spent: open.spent.lots, max: open.budget.maxLots })}</span>
            <span>
              {open.spent.quotaPct === null
                ? t("goal.quotaUnknown", { max: open.budget.quotaPct })
                : t("goal.quota", { spent: open.spent.quotaPct, max: open.budget.quotaPct })}
            </span>
            {open.budget.deadline !== null && <span>{t("goal.until", { date: new Date(open.budget.deadline).toLocaleDateString() })}</span>}
          </div>
          {open.spent.cardIds.length > 0 && (
            <div>
              <span className="text-xs text-muted-foreground">{t("goal.cards")}</span>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {open.spent.cardIds.map((id) => (
                  <li key={id}>
                    <Link to={cardPath(id)} className="inline-block max-w-[28ch] truncate rounded-full border px-2 py-0.5 text-xs hover:bg-muted/60">
                      {titleOf(id) ?? id.slice(0, 8)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {open.status === "claimed" && (
            <>
              <p className="rounded-lg border border-brand/45 p-2 text-xs">{t("goal.claimedHint")}</p>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t("goal.refusal")}
                <textarea value={refusal} onChange={(e) => setRefusal(e.target.value)} rows={2} maxLength={2000} className={field} />
              </label>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void move("achieve")} className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
              {t("goal.achieve")}
            </button>
            {open.status === "active" ? (
              <button type="button" onClick={() => void move("pause")} className={btn}>
                {t("goal.pause")}
              </button>
            ) : open.status === "claimed" ? (
              // A claim is refused with a reason: that reason is what sends the orchestrator back to work.
              <button type="button" disabled={!refusal.trim()} onClick={() => void move("resume", refusal.trim())} className={`${btn} disabled:opacity-50`}>
                {t("goal.refuse")}
              </button>
            ) : (
              <button type="button" onClick={() => void move("resume")} className={btn}>
                {t("goal.resume")}
              </button>
            )}
            <button type="button" onClick={() => void move("abandon")} className={btn}>
              {pending === open.id ? t("goal.abandonConfirm") : t("goal.abandon")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
