import { useState } from "react";
import { Hand } from "lucide-react";
import { useRevalidator } from "react-router";

import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { boardErrorMessage, holdCard, releaseCard } from "@/lib/board";
import { setStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

/** « En main » (ADR 0058): the operator is talking to this card's worker, the lead stays out. */
export function HeldChip({ className }: { className?: string }) {
  const t = useT();
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-sm bg-destructive/15 px-2 py-0.5 text-xs font-semibold text-destructive", className)}>
      <Hand className="size-3.5" aria-hidden="true" />
      {t("held.chip")}
    </span>
  );
}

/** The chip while held, and the one gesture either way: « Je le prends » / « Rendre au lead ». */
export function HeldControl({ cardId, held, className }: { cardId: string; held: boolean; className?: string }) {
  const t = useT();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      await (held ? releaseCard(cardId) : holdCard(cardId));
    } catch (e) {
      setStatus(boardErrorMessage(e), "error");
    } finally {
      setBusy(false);
    }
    revalidator.revalidate();
  };
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {held && <HeldChip />}
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void toggle()}>
        {t(held ? "held.release" : "held.take")}
      </Button>
    </span>
  );
}
