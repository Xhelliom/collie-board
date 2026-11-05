import { useEffect, useState } from "react";
import { Loader2, Undo2 } from "lucide-react";

import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { usePendingConfirm } from "@/hooks/use-pending-confirm";
import { fetchPreviousRelease, rollBack } from "@/lib/api";

// t("settings.updates.rollback") — go back to the release before the running one. The bridge hands
// the tag to the existing update action, which reinstalls it and restarts the bridge on it.
export function RollbackControl() {
  const t = useT();
  const [previous, setPrevious] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "done" | "failed">("idle");
  const { pending, confirm } = usePendingConfirm(4000); // it restarts the bridge: two taps

  useEffect(() => {
    fetchPreviousRelease()
      .then((r) => setPrevious(r.previous))
      .catch(() => {}); // no tags reachable: simply no button
  }, []);

  if (!previous) return null;

  async function go() {
    if (!confirm("rollback")) return;
    setState("busy");
    try {
      await rollBack();
      setState("done");
    } catch {
      setState("failed");
    }
  }

  if (state === "done")
    return <span className="text-xs text-muted-foreground">{t("settings.updates.rollingBack", { version: previous })}</span>;
  return (
    <>
      <Button variant="outline" size="sm" disabled={state === "busy"} onClick={go}>
        {state === "busy" ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
        {pending === "rollback" ? t("settings.updates.rollbackConfirm") : t("settings.updates.rollback", { version: previous })}
      </Button>
      {state === "failed" && <span className="text-xs text-status-blocked">{t("settings.updates.rollbackFailed")}</span>}
    </>
  );
}
