import { useMemo } from "react";
import { useNavigate } from "react-router";

import { useT } from "@/i18n";
import { dashboardOf } from "@/lib/dashboard";
import { CARD_STATUS_LABEL, cardPath, projectPath, repoName, type CardView } from "@/lib/board";
import { placeOf, projectOf } from "@/lib/agent-groups";
import { agentIdentity } from "@/lib/agent-identity";
import { useIsDesktop } from "@/hooks/use-media-query";
import { panePath } from "@/lib/nav";
import { pinId, pinKey, usePins, type Pin } from "@/lib/pins";
import { useQuickAccess } from "@/lib/quick-access";
import type { HomeData } from "@/lib/loaders";
import { paneDisplayName } from "@/lib/types";
import { cn } from "@/lib/utils";
import { sectionTitle } from "./agent-list";
import { MachineChip } from "./agent-line";
import { PhaseBar, useRepoPhases } from "./home-dashboard";
import { GonePin } from "./pin-button";
import { StatusSignal, cardSignal } from "./status-signal";
import { runningAgents } from "./sidebar-quick";

// The phone's « Épinglés »: the sidebar's pins, dressed as the Home's own panels (one row = one card
// like « Au travail »). Same data as the sidebar (usePins/useQuickAccess); the sidebar itself is untouched.

const PANEL = "flex min-h-12 w-full min-w-0 items-center gap-3 rounded-sm bg-card px-3.5 py-2 text-left transition-colors hover:bg-muted/40";

export function HomePinned({ data, cards }: { data: HomeData; cards: CardView[] }) {
  const desktop = useIsDesktop();
  const t = useT();
  const navigate = useNavigate();
  const q = useQuickAccess(data, !desktop);
  const pins = usePins(data);
  const projectPaths = useMemo(() => pins.flatMap((p) => ("repoPath" in p ? [p.repoPath] : [])), [pins]);
  const phases = useRepoPhases(projectPaths);
  const tiles = useMemo(() => dashboardOf(cards, Date.now(), phases).repos, [cards, phases]);
  if (desktop) return null;

  const running = new Set(runningAgents(data.agents).map((a) => a.paneId));
  const waiting = q?.waiting ?? [];
  const agentOf = (p: Pin) => ("session" in p ? data.agents.find((x) => pinKey(x) === p.session) : undefined);
  // Projects, then cards, then agents; a running agent is already under « Au travail ».
  const rows = [
    ...pins.filter((p) => "repoPath" in p),
    ...pins.filter((p) => "cardId" in p),
    ...pins.filter((p) => "session" in p && !(agentOf(p) && running.has(agentOf(p)!.paneId))),
  ];
  if (rows.length === 0) return null;

  const items = rows.map((p) => {
    const key = pinId(p);
    if ("repoPath" in p) {
      const name = repoName(p.repoPath);
      const forYou = waiting.filter((w) => w.repoPath === p.repoPath).length + data.agents.filter((a) => a.status === "blocked" && projectOf(a.cwd) === name).length;
      const phase = tiles.find((r) => r.path === p.repoPath)?.current[0];
      return (
        <button key={key} type="button" onClick={() => navigate(projectPath(p.repoPath))} className={cn(PANEL, "flex-col items-stretch gap-1.5 p-3.5")}>
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
            {forYou > 0 && <span className="shrink-0 text-sm font-medium text-status-blocked">{t("quick.forYou", { count: forYou })}</span>}
          </span>
          {phase ? (
            <>
              <span className="flex items-baseline gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{phase.title || t("home.project.loose")}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{t("home.project.steps", { done: phase.done, total: phase.steps.length })}</span>
              </span>
              <PhaseBar steps={phase.steps} thin />
            </>
          ) : (
            <span className="text-sm text-muted-foreground">{t("home.project.nothing")}</span>
          )}
        </button>
      );
    }
    if ("cardId" in p) {
      if (p.status === null) return <GonePin key={key} pin={p} className="min-h-12 px-3.5 text-sm" />;
      const waits = waiting.some((w) => w.cardId === p.cardId);
      return (
        <button key={key} type="button" onClick={() => navigate(cardPath(p.cardId))} className={PANEL}>
          <StatusSignal status={waits ? "blocked" : cardSignal(p.status)} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium">{p.name}</span>
            <span className="truncate text-sm text-muted-foreground">{p.status ? CARD_STATUS_LABEL[p.status as keyof typeof CARD_STATUS_LABEL] ?? p.status : ""}</span>
          </span>
        </button>
      );
    }
    const a = agentOf(p);
    if (!a) return <GonePin key={key} pin={p} className="min-h-12 px-3.5 text-sm" />;
    const id = agentIdentity(a, t("agents.orchestrator"));
    return (
      <button key={key} type="button" onClick={() => navigate(panePath(a.paneId, data.session))} className={PANEL}>
        <StatusSignal status={a.status} />
        <span className="flex min-w-0 flex-1 items-baseline gap-3">
          <span className="min-w-0 flex-1 truncate font-medium">{paneDisplayName(a)}</span>
          <span className="max-w-[40%] shrink-0 truncate text-sm text-muted-foreground">{projectOf(a.cwd) || placeOf(a)}</span>
        </span>
        <MachineChip machine={id.machine} />
      </button>
    );
  });

  return (
    <section className="flex flex-col gap-1.5" aria-label={t("quick.pinned")}>
      <h2 className={cn(sectionTitle, "mb-1")}>{t("quick.pinned")}</h2>
      {items}
    </section>
  );
}
