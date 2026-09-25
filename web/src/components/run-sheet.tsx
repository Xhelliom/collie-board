import { useEffect, useState } from "react";

import { AgentKindPicker } from "@/components/agent-kind-picker";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { fetchBoardPrefs, repoName, runWaves, type CardView } from "@/lib/board";

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
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  cards: CardView[];
  repoPath: string;
  onConfirm: (input: { foldInCap: number; leadAgent: string | null }) => Promise<void>;
}) {
  const [maxAgents, setMaxAgents] = useState<number | null>(null);
  const [foldInCap, setFoldInCap] = useState(DEFAULT_FOLD_IN_CAP);
  const [leadAgent, setLeadAgent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    fetchBoardPrefs(ctrl.signal)
      .then((p) => setMaxAgents(p.maxAgents))
      .catch(() => {});
    return () => ctrl.abort();
  }, [open]);

  const waves = runWaves(cards);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm({ foldInCap, leadAgent });
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={`Run ${cards.length} card${cards.length === 1 ? "" : "s"} · ${repoName(repoPath)}`}
      footer={
        <Button variant="brand" className="w-full" disabled={busy || cards.length === 0} onClick={confirm}>
          Lancer le run
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <section aria-label="Ordre" className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Ordre (tiré des dépendances)</span>
          <ol className="flex flex-col gap-1.5">
            {waves.map((wave, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="w-5 shrink-0 font-semibold tabular-nums text-muted-foreground">{i + 1}.</span>
                <span className="min-w-0">{wave.map((c) => c.title).join(" · ")}</span>
              </li>
            ))}
          </ol>
        </section>

        <p aria-label="Parallélisme" className="text-sm">
          <span className="text-muted-foreground">Parallélisme : </span>
          {maxAgents === null ? "…" : `jusqu'à ${maxAgents} agent${maxAgents === 1 ? "" : "s"} à la fois`}
        </p>

        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">Plafond de fold-ins</span>
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
          <span className="text-xs font-medium text-muted-foreground">Agent du lead</span>
          <AgentKindPicker value={leadAgent} onChange={setLeadAgent} />
        </div>
      </div>
    </BottomSheet>
  );
}
