import { useState } from "react";
import { Lock, Play } from "lucide-react";

import { useT } from "@/i18n";
import { usePendingConfirm } from "@/hooks/use-pending-confirm";
import { boardErrorMessage, takeOverCard, type CardView } from "@/lib/board";
import { claimHolder, personName, useIdentities } from "@/lib/identities";
import { Button } from "@/components/ui/button";

/** Another pair's claim on a shared card (ADR 0048 §7), or null when this pair may launch it. */
export function useClaimHolder(card: CardView) {
  return claimHolder(card, useIdentities());
}

/**
 * Start, greyed with who holds the card and since when — and « Reprendre la main », a two-tap
 * confirm because the other pair may still have an agent on it. The take-over is pushed before it
 * answers, so a success means the card is this pair's on the remote too.
 */
export function ClaimedElsewhere({ card, onChanged, onMessage }: { card: CardView; onChanged: () => void; onMessage: (m: string, tone: "success" | "error") => void }) {
  const t = useT();
  const ids = useIdentities();
  const holder = claimHolder(card, ids);
  const { pending, confirm } = usePendingConfirm(4000);
  const [taking, setTaking] = useState(false);
  if (!holder) return null;
  const who = personName(holder.by, ids[card.repoPath!]?.me ?? null, t("people.me"));
  const time = new Date(holder.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  async function takeOver() {
    if (!confirm("take-over")) return;
    setTaking(true);
    try {
      await takeOverCard(card.id);
      onMessage(t("card.claim.taken.ok"), "success");
    } catch (e) {
      onMessage(boardErrorMessage(e), "error");
    } finally {
      setTaking(false);
      onChanged();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button disabled className="h-12 w-full gap-2" title={holder.by}>
        <Play className="size-4" />
        {t("card.start.start")}
      </Button>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Lock className="size-3.5 shrink-0" />
        <span>{t("card.claim.taken", { who, time })}</span>
      </p>
      <Button variant="outline" size="sm" className="h-9 w-fit" disabled={taking} onClick={takeOver}>
        {taking ? t("card.claim.taking") : pending === "take-over" ? t("card.claim.confirm", { who }) : t("card.claim.takeOver")}
      </Button>
    </div>
  );
}
