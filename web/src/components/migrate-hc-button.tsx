import { useEffect, useState } from "react";
import { ArrowRightLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { usePendingConfirm } from "@/hooks/use-pending-confirm";
import { useT } from "@/i18n";
import { migrateCardToHc, migrateHcAvailability, type CardView } from "@/lib/board";

/**
 * « Migrer vers herdr-core » — offered only when the bridge says so (a Claude agent at rest under 0.9,
 * hc reachable: bridge/migrate-hc.ts). Two taps: it closes the agent's terminal.
 */
export function MigrateHcButton({ card, onDone }: { card: CardView; onDone: (message: string, ok: boolean) => void }) {
  const t = useT();
  const { confirm, pending } = usePendingConfirm();
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const paneId = card.session?.paneId ?? null;

  // Re-asked when the card's column or pane moves: « at rest » is the column's business.
  useEffect(() => {
    if (!paneId) return setAvailable(false);
    const ctl = new AbortController();
    migrateHcAvailability(card.id, ctl.signal).then(
      (r) => setAvailable(r.available),
      () => setAvailable(false),
    );
    return () => ctl.abort();
  }, [card.id, card.status, paneId]);

  if (!available) return null;
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        className="h-11 w-full gap-2"
        disabled={busy}
        onClick={async () => {
          if (!confirm(card.id)) return;
          setBusy(true);
          try {
            await migrateCardToHc(card.id);
            onDone(t("card.toast.migrateHc"), true);
          } catch (e) {
            onDone((e as Error).message, false);
          } finally {
            setBusy(false);
            setAvailable(false);
          }
        }}
      >
        <ArrowRightLeft className="size-4" />
        {busy ? t("card.migrateHc.running") : pending === card.id ? t("card.migrateHc.confirm") : t("card.migrateHc.do")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("card.migrateHc.hint")}</p>
    </div>
  );
}
