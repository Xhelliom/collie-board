import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { applyUpdate, isUpdateRefusal } from "@/lib/api";

// t("settings.updates.apply") — one tap updates plugin, UI and bridge to `latest`. The bridge hands it
// to the update action, which runs outside its unit; once the new build is served, lib/self-update.ts
// reloads the page onto it. Until then the button says it's under way; a refusal shows its reason.
export function ApplyUpdateControl({ latest }: { latest: string }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "updating" | "failed">("idle");
  const [reason, setReason] = useState("");

  async function go() {
    setState("updating");
    try {
      await applyUpdate();
    } catch (e) {
      if (!isUpdateRefusal(e)) return; // the restart dropped the request: still under way
      setReason(e.message);
      setState("failed");
    }
  }

  return (
    <>
      <Button size="sm" disabled={state === "updating"} onClick={go}>
        {state === "updating" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        {state === "updating" ? t("settings.updates.applying", { version: latest }) : t("settings.updates.apply", { version: latest })}
      </Button>
      {state === "updating" && <span className="text-xs text-muted-foreground">{t("settings.updates.applyingHint")}</span>}
      {state === "failed" && (
        <div className="w-full text-xs text-status-blocked">
          {t("settings.updates.applyFailed")}
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">{reason}</pre>
        </div>
      )}
    </>
  );
}
