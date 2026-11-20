import { Unplug } from "lucide-react";

import { ActionRow } from "@/components/action-sheet-rows";
import { usePendingConfirm } from "@/hooks/use-pending-confirm";
import { useT } from "@/i18n";
import { detachCardAgent } from "@/lib/board";
import { setStatus } from "@/lib/status";

/**
 * « Détacher l'agent »: the operator's way out when the board believes a session that is not there —
 * here or on a peer. Ends the card's session on both sides, leaves the terminal open, so Start launches.
 * Two taps, armed under the card's own id (the page is not remounted from one card to the next).
 */
export function DetachAgentRow({ cardId, onDone }: { cardId: string; onDone: () => void }) {
  const t = useT();
  const { confirm, pending } = usePendingConfirm();
  return (
    <ActionRow
      icon={<Unplug className="size-4 shrink-0 text-muted-foreground" />}
      label={pending === cardId ? t("card.detach.confirm") : t("card.detach.label")}
      onClick={() => {
        if (!confirm(cardId)) return;
        void detachCardAgent(cardId)
          .then((r) => setStatus(r.warning ? t("card.detach.peerWarning", { error: r.warning }) : t("card.detach.done"), r.warning ? "error" : "success"))
          .catch((e: Error) => setStatus(e.message, "error", null))
          .finally(onDone);
      }}
    />
  );
}
