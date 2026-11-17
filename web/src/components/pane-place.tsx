import type { ReactNode } from "react";
import { AppWindow, TriangleAlert, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { isHcAgent } from "@/lib/agent-groups";
import type { AgentView, OpenedPlace } from "@/lib/types";
import { cn } from "@/lib/utils";

// Where a pane can be found outside Collie: herdr-app (hc) or herdr 0.9 — and when it is 0.9 on a
// machine that has hc, it is invisible in herdr-app, which is the operator's to notice. Orange then
// (the « waits for you » tone, status-blocked), blue otherwise (status-working).

function PlaceBox({ attention, className, children }: { attention: boolean; className?: string; children: ReactNode }) {
  const Icon = attention ? TriangleAlert : AppWindow;
  return (
    <div
      role="status"
      data-tone={attention ? "attention" : "info"}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border border-l-[3px] px-3 py-2 text-sm",
        attention ? "border-status-blocked/40 border-l-status-blocked bg-status-blocked/8" : "border-status-working/30 border-l-status-working bg-status-working/6",
        className,
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", attention ? "text-status-blocked" : "text-status-working")} aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** After « New terminal »: where it opened, why when it fell back, and the way into it here. Stays until dismissed. */
export function OpenedNote({ opened, onEnter, onDismiss }: { opened: OpenedPlace; onEnter: () => void; onDismiss: () => void }) {
  const t = useT();
  const { engine, fallback, place } = opened;
  const [title, where] =
    engine === "hc"
      ? [t("project.open.inApp"), t("project.open.inApp.where", { space: place.space, tab: place.tab ?? "" })]
      : fallback
        ? [t("project.open.fellBack"), t("project.open.fellBack.where", { space: place.space })]
        : [t("project.open.in09"), t("project.open.in09.where", { space: place.space })];
  return (
    <PlaceBox attention={fallback} className="w-full">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title}</p>
          <p className="text-muted-foreground">{where}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("project.open.dismiss")}
          className="-m-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60"
        >
          <X className="size-4" />
        </button>
      </div>
      <Button size="sm" variant="outline" className="mt-2" onClick={onEnter}>
        {t("project.open.enter")}
      </Button>
    </PlaceBox>
  );
}

/** The pane view's header line: which engine, and the space/tab to find the pane in. */
export function PanePlace({ agent, tabLabel }: { agent: AgentView; tabLabel?: string }) {
  const t = useT();
  if (agent.peer) return null; // a peer's pane: its machine, not this one, says where it is
  // shortcut: « fell back » is read as « on 0.9 while the herd also has hc » (the engine badge is only set
  // when the herd mixes) — a 0.9 pane on a machine whose hc has no pane yet shows blue.
  const hidden = !isHcAgent(agent) && agent.engine === "herdr09";
  const text = isHcAgent(agent)
    ? agent.appPlace
      ? t("pane.place.app", agent.appPlace)
      : t("pane.place.appBare")
    : tabLabel
      ? t("pane.place.09", { space: agent.workspaceLabel, tab: tabLabel })
      : t("pane.place.09Bare", { space: agent.workspaceLabel });
  return (
    <PlaceBox attention={hidden} className="py-1 text-xs">
      <p className="break-words">
        {text}
        {hidden && <span className="font-medium text-status-blocked"> — {t("pane.place.hidden")}</span>}
      </p>
    </PlaceBox>
  );
}
