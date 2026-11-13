import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Target } from "lucide-react";

import { useT } from "@/i18n";
import { usePendingConfirm } from "@/hooks/use-pending-confirm";
import { boardErrorMessage, cardPath, createGoal, deleteGoal, editGoal, fetchGoals, moveGoal, type Goal, type GoalBudget, type GoalMove } from "@/lib/board";
import { setStatus } from "@/lib/status";
import { cn } from "@/lib/utils";
import { GOAL_SURFACE, isOpenGoal, type OpenGoal } from "@/components/goal-chip";

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

// How much of the budget is gone — the larger of lots and quota, as the bridge's checkpoints read it (goal-mode.ts).
export const budgetPct = (g: Pick<Goal, "spent" | "budget">) =>
  Math.min(100, Math.round(100 * Math.max(g.spent.lots / g.budget.maxLots, g.spent.quotaPct === null ? 0 : g.spent.quotaPct / g.budget.quotaPct)));

// While the objective is open, lot reports go here instead of the phone; checkpoints too.
function GoalJournal({ goal }: { goal: Goal }) {
  const t = useT();
  if (!goal.journal) return null;
  return (
    <div>
      <span className="text-xs text-muted-foreground">{t("goal.journal")}</span>
      {goal.journal.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">{t("goal.journalEmpty")}</p>
      ) : (
        <ul className="mt-1 flex max-h-72 flex-col gap-1.5 overflow-y-auto">
          {goal.journal.map((j, i) => (
            <li key={`${j.ts}-${i}`} className={`rounded-lg border p-2 text-xs ${j.type === "goal.checkpoint" ? "border-brand/45" : ""}`}>
              <div className="flex justify-between gap-2 text-muted-foreground">
                <span className="font-medium">{t(j.reason ? `goal.entry.${j.reason}` : "goal.entry.lot")}</span>
                <time dateTime={new Date(j.ts).toISOString()}>{new Date(j.ts).toLocaleString()}</time>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap">{j.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The repo's objective (ADR 0056), at the top of the project page. Every write here is the operator's:
// the bridge refuses them from an agent pane, which may only claim the objective reached.
/** `noOrchestrator`: the repo has no orchestrator pane, so setting or resuming the objective wakes nobody.
 *  `onGoal`: the open objective as this panel holds it, for the page header to wear. */
export function GoalPanel({
  repo,
  titleOf,
  noOrchestrator = false,
  onGoal,
  quietWhenEmpty = false,
  editSignal = 0,
}: {
  repo: string;
  titleOf: (cardId: string) => string | undefined;
  noOrchestrator?: boolean;
  onGoal?: (g: OpenGoal | null) => void;
  /** Nothing at all when there is no objective, none prepared and none past: the page says it in one line. */
  quietWhenEmpty?: boolean;
  /** Bumped by the page's « Set an objective »: opens the form here. */
  editSignal?: number;
}) {
  const t = useT();
  const [goals, setGoals] = useState<Goal[] | null>(null);
  // Which form is open: the objective's, or the next one's.
  const [editing, setEditing] = useState<"open" | "next" | null>(null);
  const [refusal, setRefusal] = useState("");
  // Which detail is unfolded: the page shows the objective in a few lines, the rest one tap away.
  const [shown, setShown] = useState<"criteria" | "cards" | "journal" | "next" | null>(null);
  const { pending, confirm } = usePendingConfirm();

  useEffect(() => {
    const ac = new AbortController();
    setGoals(null);
    setEditing(null);
    fetchGoals(repo, ac.signal)
      .then((r) => setGoals(r.goals))
      .catch(() => {});
    return () => ac.abort();
  }, [repo]);

  const open = goals?.find((g) => OPEN.has(g.status)) ?? null;
  const openStatus = open && isOpenGoal(open.status) ? open.status : null;
  const openText = open?.text ?? "";
  // Said once the goals are read: before that, « no objective » would be a guess.
  const loaded = goals !== null;
  useEffect(() => {
    if (loaded) onGoal?.(openStatus ? { status: openStatus, text: openText } : null);
  }, [loaded, openStatus, openText, onGoal]);

  useEffect(() => {
    if (!editSignal) return;
    setEditing("open");
    requestAnimationFrame(() => document.getElementById("goal")?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
  }, [editSignal]);

  if (!goals) return null;
  const queued = goals.find((g) => g.status === "queued") ?? null;
  const past = goals.filter((g) => g.status === "achieved" || g.status === "abandoned").sort((a, b) => (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt));
  if (quietWhenEmpty && !open && !queued && past.length === 0 && editing === null) return null;
  const put = (g: Goal) => setGoals((all) => [g, ...(all ?? []).filter((x) => x.id !== g.id)]);
  const fail = (e: unknown) => setStatus(boardErrorMessage(e), "error", null);

  const save = async (g: { text: string; criteria: string[]; budget: GoalBudget }) => {
    try {
      const target = editing === "next" ? queued : open;
      put((target ? await editGoal(target.id, g) : await createGoal(repo, g, editing === "next")).goal);
      setEditing(null);
      setStatus(t("goal.saved"), "success", 2000);
    } catch (e) {
      fail(e);
    }
  };
  const move = async (m: GoalMove, comment?: string) => {
    const g = m === "activate" ? queued : open;
    if (!g || (m === "abandon" && !confirm(g.id))) return;
    try {
      put((await moveGoal(g.id, m, comment)).goal);
      setRefusal("");
      // Validating started the next objective, if one waited: read it back as the bridge has it.
      if (m === "achieve" && queued) setGoals((await fetchGoals(repo)).goals);
    } catch (e) {
      fail(e);
    }
  };
  const drop = async () => {
    if (!queued || !confirm(`next:${queued.id}`)) return;
    try {
      await deleteGoal(queued.id);
      setGoals((all) => (all ?? []).filter((x) => x.id !== queued.id));
    } catch (e) {
      fail(e);
    }
  };
  const btn = "rounded-full border px-3 py-1.5 text-xs hover:bg-muted/60";
  const link = "text-xs font-semibold text-brand";
  const fold = (k: "criteria" | "cards" | "journal" | "next") => setShown((v) => (v === k ? null : k));
  const pct = open ? budgetPct(open) : 0;
  const gauge = (label: string, value: string, fill?: number, tone = "bg-status-done") => (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm tabular-nums">{value}</span>
      {fill !== undefined && (
        <span className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <i className={cn("block h-full rounded-full", tone)} style={{ width: `${Math.min(100, fill)}%` }} />
        </span>
      )}
    </div>
  );

  return (
    <section id="goal" aria-label={t("goal.title")} className={cn("flex flex-col gap-3 rounded-2xl border p-4 text-sm", openStatus ? GOAL_SURFACE[openStatus] : "bg-card/70")}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-semibold">
          <Target className="size-4 text-muted-foreground" />
          {t("goal.title")}
          {open && <span className="rounded-full border px-2 py-0.5 text-xs font-medium">{t(`goal.status.${open.status}`)}</span>}
          {open?.origin === "agent" && <span className="text-xs font-normal text-muted-foreground">{t("goal.byAgent")}</span>}
        </h2>
        {open && !editing && (
          <button type="button" onClick={() => setEditing("open")} className={link}>
            {t("goal.edit")}
          </button>
        )}
      </div>
      {editing === "open" ? (
        <GoalForm initial={open} onSave={(g) => void save(g)} onCancel={() => setEditing(null)} />
      ) : !open ? (
        <>
          <p className="text-xs text-muted-foreground">{t("goal.none")}</p>
          <button type="button" onClick={() => setEditing("open")} className="self-start rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
            {t("goal.define")}
          </button>
        </>
      ) : (
        <>
          <p className="text-[15px] font-medium leading-snug">{open.text}</p>
          {open.status === "active" && !noOrchestrator && <p className="text-xs font-medium text-status-done">{t("goal.runningHint")}</p>}
          {noOrchestrator && open.status === "active" && <p className="rounded-lg border border-status-blocked/50 p-2 text-xs">{t("goal.noOrchestrator")}</p>}
          <div role="group" aria-label={t("goal.progress")} className="grid grid-cols-3 gap-3">
            {gauge(t("goal.gauge.lots"), t("goal.gauge.lotsOf", { spent: open.spent.lots, max: open.budget.maxLots }), (100 * open.spent.lots) / open.budget.maxLots)}
            <div role="progressbar" aria-label={t("goal.gauge.budget")} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              {gauge(t("goal.gauge.budget"), t("goal.gauge.budgetUsed", { pct }), pct, pct >= 100 ? "bg-destructive" : "bg-muted-foreground")}
            </div>
            {gauge(
              t("goal.gauge.quota"),
              open.spent.quotaPct === null ? `${open.budget.quotaPct} %` : t("goal.gauge.quotaOf", { spent: open.spent.quotaPct, max: open.budget.quotaPct }),
            )}
          </div>
          {(open.progress || open.budget.deadline !== null) && (
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground">
              {open.progress && (
                <>
                  <span>{t("goal.lotsDone", { n: open.progress.lotsDone })}</span>
                  <span>{t("goal.cardsDone", { n: open.progress.cardsDone })}</span>
                  {open.progress.cardsBlocked > 0 && <span className="text-destructive">{t("goal.cardsBlocked", { n: open.progress.cardsBlocked })}</span>}
                  {open.progress.recettes > 0 && <span>{t("goal.recettes", { n: open.progress.recettes })}</span>}
                </>
              )}
              {open.budget.deadline !== null && <span>{t("goal.until", { date: new Date(open.budget.deadline).toLocaleDateString() })}</span>}
            </p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <button type="button" aria-expanded={shown === "criteria"} onClick={() => fold("criteria")} className={link}>
              {t("goal.link.criteria", { count: open.criteria.length })}
            </button>
            {open.spent.cardIds.length > 0 && (
              <button type="button" aria-expanded={shown === "cards"} onClick={() => fold("cards")} className={link}>
                {t("goal.link.cards", { count: open.spent.cardIds.length })}
              </button>
            )}
            {open.journal && (
              <button type="button" aria-expanded={shown === "journal"} onClick={() => fold("journal")} className={link}>
                {t("goal.link.journal")}
              </button>
            )}
          </div>
          {(shown === "criteria" || open.status === "claimed") && (
            <ul className="list-disc pl-5">
              {open.criteria.map((c, i) => (
                <li key={i}>
                  {c}
                  {open.status === "claimed" && open.claim?.proofs[i] && (
                    <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">
                      <span className="font-medium">{t("goal.proof")}</span> {open.claim.proofs[i]}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {shown === "cards" && (
            <ul className="flex flex-wrap gap-1.5">
              {open.spent.cardIds.map((id) => (
                <li key={id}>
                  <Link to={cardPath(id)} className="inline-block max-w-[28ch] truncate rounded-full border px-2 py-0.5 text-xs hover:bg-muted/60">
                    {titleOf(id) ?? id.slice(0, 8)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {shown === "journal" && <GoalJournal goal={open} />}
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
            <button type="button" onClick={() => void move("abandon")} className={cn(btn, "text-destructive")}>
              {pending === open.id ? t("goal.abandonConfirm") : t("goal.abandon")}
            </button>
          </div>
        </>
      )}
      {/* The next objective, in one line: prepared while one is open, started when the operator validates it. */}
      {editing === "next" ? (
        <div className="flex flex-col gap-2 border-t pt-2.5">
          <span className="text-xs font-semibold text-muted-foreground">{t("goal.next")}</span>
          <GoalForm initial={queued} onSave={(g) => void save(g)} onCancel={() => setEditing(null)} />
        </div>
      ) : queued ? (
        <div className="flex flex-col gap-1.5 border-t pt-2.5">
          <div className="flex min-w-0 items-center gap-2 text-[13px]">
            <span className="shrink-0 text-muted-foreground">{t("goal.then")}</span>
            <span className="min-w-0 flex-1 truncate font-medium" title={queued.text}>
              {queued.text}
            </span>
            {queued.origin === "agent" && <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{t("goal.byAgent")}</span>}
            {!editing && (
              <span className="flex shrink-0 gap-3">
                <button type="button" aria-expanded={shown === "next"} onClick={() => fold("next")} className={link}>
                  {t(shown === "next" ? "goal.hide" : "goal.see")}
                </button>
                <button type="button" onClick={() => setEditing("next")} className={link}>
                  {t("goal.edit")}
                </button>
                <button type="button" onClick={() => void drop()} className={cn(link, "text-destructive")}>
                  {pending === `next:${queued.id}` ? t("goal.deleteConfirm") : t("goal.delete")}
                </button>
              </span>
            )}
          </div>
          {(shown === "next" || !open) && (
            <>
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                {queued.criteria.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">{t(open ? "goal.nextHint" : "goal.nextOrphan")}</p>
              {!open && !editing && (
                <button type="button" onClick={() => void move("activate")} className="self-start rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
                  {t("goal.activate")}
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        open &&
        !editing && (
          <button type="button" onClick={() => setEditing("next")} className={`${link} self-start`}>
            {t("goal.prepareNext")}
          </button>
        )
      )}
      {past.length > 0 && (
        <details className="border-t pt-1.5">
          <summary className="flex min-h-11 cursor-pointer select-none items-center text-xs font-semibold text-muted-foreground">{t("goal.history", { n: past.length })}</summary>
          <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
            {past.map((g) => (
              <li key={g.id} className="rounded-lg border p-2 text-xs">
                <div className="flex flex-wrap justify-between gap-x-2 text-muted-foreground">
                  <span className={g.status === "achieved" ? "font-medium text-foreground" : "font-medium"}>{t(`goal.status.${g.status}`)}</span>
                  <span className="tabular-nums">
                    {new Date(g.createdAt).toLocaleDateString()} → {g.endedAt === null ? "?" : new Date(g.endedAt).toLocaleDateString()} · {t("goal.historyLots", { n: g.spent.lots })}
                  </span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap">{g.text}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
