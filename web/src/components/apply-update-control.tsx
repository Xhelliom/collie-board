import { useState } from "react";
import { Link } from "react-router";
import { Bot, Download, Loader2, Wrench } from "lucide-react";

import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { applyUpdate, isUpdateRefusal, repairUpdate } from "@/lib/api";
import { panePath } from "@/lib/nav";

// t("settings.updates.apply") — one tap updates plugin, UI and bridge to `latest`. The bridge hands it
// to the update action, which runs outside its unit; once the new build is served, lib/self-update.ts
// reloads the page onto it. Until then the button says it's under way; a refusal shows its reason,
// and offers an agent to fix it in this machine's checkout.
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
        <div className="w-full text-xs text-destructive">
          {t("settings.updates.applyFailed")}
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">{reason}</pre>
          <RepairControl />
        </div>
      )}
    </>
  );
}

// t("settings.updates.repair") — the operator hands the failure to an agent instead of staying stuck.
function RepairControl() {
  const t = useT();
  const [state, setState] = useState<{ s: "idle" | "busy" } | { s: "started"; paneId: string } | { s: "failed"; reason: string }>({ s: "idle" });

  async function go() {
    setState({ s: "busy" });
    try {
      const r = await repairUpdate();
      setState(r.ok ? { s: "started", paneId: r.pane.paneId } : { s: "failed", reason: r.error });
    } catch (e) {
      setState({ s: "failed", reason: (e as Error).message });
    }
  }

  if (state.s === "started")
    return (
      <Link to={panePath(state.paneId)} className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline underline-offset-4">
        <Bot className="size-4" />
        {t("settings.updates.repairOpen")}
      </Link>
    );
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" disabled={state.s === "busy"} onClick={go}>
        {state.s === "busy" ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />}
        {state.s === "busy" ? t("settings.updates.repairing") : t("settings.updates.repair")}
      </Button>
      {state.s === "failed" && <span>{t("settings.updates.repairFailed", { reason: state.reason })}</span>}
    </div>
  );
}
