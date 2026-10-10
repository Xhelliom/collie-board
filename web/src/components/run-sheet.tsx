import { useEffect, useState } from "react";

import { AgentKindPicker } from "@/components/agent-kind-picker";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { GateSheet } from "@/components/gate-sheet";
import { useT } from "@/i18n";
import { fetchBoardPrefs, fetchRepos, repoName, runWaves, type CardView, type Phase } from "@/lib/board";

/** The fold-in cap a run starts with. Small on purpose: past it, a follow-up is a card for later. */
const DEFAULT_FOLD_IN_CAP = 2;

// The "Run these" confirmation (ADR 0017): everything the gesture consents to, shown BEFORE it is
// given — the order `dependsOn` implies, how many agents run at once, how far the run may grow, and
// which agent leads it. Confirming records the run; the coordinator is what starts the cards.
export function RunSheet({
  open,
  onClose,
  cards,
  repoPath,
  phases,
  phaseId: initialPhase,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  cards: CardView[];
  repoPath: string;
  /** The repo's phases, to file a planned lot under one (ADR 0021). */
  phases: Phase[];
  /** The phase the board is filtered on, pre-selected. */
  phaseId: string | null;
  onConfirm: (input: {
    foldInCap: number;
    leadAgent: string | null;
    planned?: boolean;
    phaseId?: string | null;
    name?: string;
    maxParallel?: number | null;
  }) => Promise<void>;
}) {
  const t = useT();
  const [maxAgents, setMaxAgents] = useState<number | null>(null);
  const [foldInCap, setFoldInCap] = useState(DEFAULT_FOLD_IN_CAP);
  const [leadAgent, setLeadAgent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lotName, setLotName] = useState("");
  // Null follows the board's own cap; 1 is sequential. The planner usually decides (ADR 0021).
  const [maxParallel, setMaxParallel] = useState<number | null>(null);
  const [lotPhase, setLotPhase] = useState<string | null>(initialPhase);
  // The repo's gate (ADR 0020): null = none yet, undefined = not known (yet, or the bridge didn't say).
  const [gate, setGate] = useState<string | null | undefined>(undefined);
  const [gateOpen, setGateOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    fetchBoardPrefs(ctrl.signal)
      .then((p) => setMaxAgents(p.maxAgents))
      .catch(() => {});
    fetchRepos({ all: true }, ctrl.signal)
      .then((r) => setGate(r.repos.find((x) => x.path === repoPath)?.gate ?? null))
      .catch(() => {});
    return () => ctrl.abort();
  }, [open, repoPath]);

  const waves = runWaves(cards);

  async function confirm(plan = false) {
    setBusy(true);
    try {
      await onConfirm(
        plan
          ? { foldInCap, leadAgent, planned: true, phaseId: lotPhase, name: lotName.trim(), maxParallel }
          : { foldInCap, leadAgent, maxParallel },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t("run.title", { count: cards.length, repo: repoName(repoPath) })}
      footer={
        <div className="flex flex-col gap-2">
          <Button variant="brand" className="w-full" disabled={busy || cards.length === 0} onClick={() => void confirm()}>
            {t("run.launch")}
          </Button>
          {/* A planned lot holds its cards and drives nothing: it is launched later, from the project view. */}
          <Button
            variant="outline"
            className="w-full"
            disabled={busy || cards.length === 0 || lotName.trim() === ""}
            onClick={() => void confirm(true)}
          >
            {t("run.plan")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <section aria-label={t("run.order")} className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t("run.orderHint")}</span>
          <ol className="flex flex-col gap-1.5">
            {waves.map((wave, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="w-5 shrink-0 font-semibold tabular-nums text-muted-foreground">{i + 1}.</span>
                <span className="min-w-0">{wave.map((c) => c.title).join(" · ")}</span>
              </li>
            ))}
          </ol>
        </section>

        <label aria-label={t("run.parallel")} className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0">
            <span className="text-muted-foreground">{t("run.parallel")} : </span>
            {maxAgents === null ? "…" : t("run.parallelBoard", { count: maxAgents })}
          </span>
          <select
            aria-label={t("run.parallelCap")}
            value={maxParallel ?? ""}
            onChange={(e) => setMaxParallel(e.target.value ? Number(e.target.value) : null)}
            className="h-10 shrink-0 rounded-lg border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <option value="">{t("run.parallelAuto")}</option>
            <option value="1">{t("run.parallelOne")}</option>
            <option value="2">{t("run.parallelN", { count: 2 })}</option>
            <option value="3">{t("run.parallelN", { count: 3 })}</option>
            <option value="4">{t("run.parallelN", { count: 4 })}</option>
          </select>
        </label>

        {gate !== undefined && (
          <div aria-label={t("run.gate")} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0">
              <span className="text-muted-foreground">{t("run.gate")} : </span>
              {gate ? (
                <code className="break-all">{gate}</code>
              ) : (
                t("run.gateNone")
              )}
            </span>
            <Button variant="outline" className="h-8 shrink-0 px-3 text-xs" onClick={() => setGateOpen(true)}>
              {gate ? t("run.gateEdit") : t("run.gateSet")}
            </Button>
          </div>
        )}

        <div aria-label={t("run.lot")} className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">{t("run.lotHint")}</span>
          <input
            type="text"
            value={lotName}
            onChange={(e) => setLotName(e.target.value)}
            placeholder={t("run.lotName")}
            maxLength={200}
            className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          {phases.length > 0 && (
            <select
              aria-label={t("run.lotPhase")}
              value={lotPhase ?? ""}
              onChange={(e) => setLotPhase(e.target.value || null)}
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <option value="">{t("run.noPhase")}</option>
              {phases.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">{t("run.foldCap")}</span>
          <input
            type="number"
            min={0}
            max={20}
            value={foldInCap}
            onChange={(e) => setFoldInCap(Math.max(0, Math.min(20, Math.trunc(Number(e.target.value) || 0))))}
            className="h-10 w-20 rounded-lg border border-border bg-background px-3 text-right tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t("run.leadAgent")}</span>
          <AgentKindPicker value={leadAgent} onChange={setLeadAgent} />
        </div>
      </div>
    </BottomSheet>
    {/* A sibling, not a child: the gate sheet is its own surface and the run's choices stay put under it. */}
    <GateSheet open={gateOpen} onClose={() => setGateOpen(false)} repoPath={repoPath} gate={gate} onSaved={setGate} />
    </>
  );
}
