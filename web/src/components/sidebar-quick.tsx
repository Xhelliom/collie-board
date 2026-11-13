import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useNavigate } from "react-router";

import { useT, type MessageKey } from "@/i18n";
import { isOrchestrator, placeOf, projectOf } from "@/lib/agent-groups";
import { useIsDesktop } from "@/hooks/use-media-query";
import { cardPath, projectPath, repoName } from "@/lib/board";
import { panePath } from "@/lib/nav";
import { pinId, pinKey, usePins, type Pin } from "@/lib/pins";
import { useQuickAccess, type QuickAccess } from "@/lib/quick-access";
import { StatusDot } from "./status-badge";
import { StatusSignal, cardSignal } from "./status-signal";
import { GonePin } from "./pin-button";
import type { HomeData } from "@/lib/loaders";
import { paneDisplayName, type AgentView } from "@/lib/types";
import { cn } from "@/lib/utils";

// Below the sidebar's entries: what the operator pinned (projects, cards, agents), then the agents
// running right now — nothing else (redesign 13/11). Both read on the root's tick: the pins and the
// cards that wait on you are fetched throttled, the running agents are the snapshot's.

/** Desktop sidebar: Pinned, then Running. */
export function SidebarSections({ data }: { data: HomeData }) {
  const desktop = useIsDesktop();
  const q = useQuickAccess(data, desktop);
  const pins = usePins(data);
  return (
    <>
      <PinnedList pins={pins} data={data} q={q} />
      <RunningList data={data} />
    </>
  );
}

/** The phone's Pinned, at the head of the Projects page. */
export function PhonePinned({ data }: { data: HomeData }) {
  const desktop = useIsDesktop();
  const q = useQuickAccess(data, !desktop);
  const pins = usePins(data);
  return desktop ? null : <PinnedList pins={pins} data={data} q={q} />;
}

/** Working first would bury what needs you: blocked, then working. Idle agents and shells are not "running". */
export function runningAgents(agents: AgentView[]): AgentView[] {
  return [...agents.filter((a) => a.status === "blocked"), ...agents.filter((a) => a.status === "working")];
}

const ROW =
  "flex min-h-9 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm text-foreground transition-colors hover:bg-muted/60";

const CHIP: Record<"project" | "card" | "agent", string> = {
  project: "bg-muted text-muted-foreground",
  card: "bg-brand/15 text-brand",
  agent: "bg-status-working/15 text-status-working",
};


const STORE = "collie:nav-collapsed:";
function useCollapsed(key: string): [boolean, () => void] {
  const [collapsed, set] = useState(() => {
    try {
      return localStorage.getItem(STORE + key) === "1";
    } catch {
      return false;
    }
  });
  const toggle = () =>
    set((c) => {
      try {
        if (c) localStorage.removeItem(STORE + key);
        else localStorage.setItem(STORE + key, "1");
      } catch {
        // Private mode: the section still toggles, it just isn't remembered.
      }
      return !c;
    });
  return [collapsed, toggle];
}

/** A titled group that folds to its title, its count, and a dot when something in it waits on you. */
function Section({ id, label, count, alert, children }: { id: string; label: MessageKey; count: number; alert: boolean; children: React.ReactNode }) {
  const t = useT();
  const [collapsed, toggle] = useCollapsed(id);
  if (count === 0) return null;
  return (
    <section className="mt-5 flex flex-col gap-0.5">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="flex items-center gap-1.5 rounded-md px-2.5 pb-1 text-left text-[13px] text-muted-foreground hover:text-foreground"
      >
        <span>{t(label)}</span>
        {collapsed && <span className="tabular-nums">{count}</span>}
        {collapsed && alert && <StatusSignal status="blocked" label={t("quick.waitsHere")} />}
        <ChevronDown className={cn("ml-auto size-3.5 transition-transform", collapsed && "-rotate-90")} aria-hidden />
      </button>
      {!collapsed && children}
    </section>
  );
}

function Chip({ kind }: { kind: "project" | "card" | "agent" }) {
  const t = useT();
  return <span className={cn("shrink-0 rounded-sm px-1.5 text-[11px] leading-[18px]", CHIP[kind])}>{t(`pin.kind.${kind}`)}</span>;
}

export function PinnedList({ pins, data, q }: { pins: Pin[]; data: HomeData; q: QuickAccess | null }) {
  const t = useT();
  const navigate = useNavigate();
  const running = new Set(runningAgents(data.agents).map((a) => a.paneId));
  const waiting = q?.waiting ?? [];
  // Projects, then cards, then agents; an agent that is running is listed once, under Running.
  const rows = [
    ...pins.filter((p) => "repoPath" in p),
    ...pins.filter((p) => "cardId" in p),
    ...pins.flatMap((p) => {
      if (!("session" in p)) return [];
      const a = data.agents.find((x) => pinKey(x) === p.session);
      return a && running.has(a.paneId) ? [] : [p];
    }),
  ];
  let alert = false;

  const items = rows.map((p) => {
    const key = pinId(p);
    if ("repoPath" in p) {
      const name = repoName(p.repoPath);
      const orch = data.agents.find((a) => isOrchestrator(a) && repoName(a.cwd) === name);
      const forYou =
        waiting.filter((w) => w.repoPath === p.repoPath).length +
        data.agents.filter((a) => a.status === "blocked" && projectOf(a.cwd) === name).length;
      if (forYou) alert = true;
      return (
        <button key={key} type="button" onClick={() => navigate(projectPath(p.repoPath))} className={ROW}>
          <StatusDot status={orch?.status ?? "unknown"} className="size-2" />
          <span className="truncate">{name}</span>
          <Chip kind="project" />
          {forYou > 0 && <span className="ml-auto shrink-0 text-xs text-brand">{t("quick.forYou", { count: forYou })}</span>}
        </button>
      );
    }
    if ("cardId" in p) {
      if (p.status === null) return <GonePin key={key} pin={p} className="py-1 pl-2.5 text-sm" />;
      const waits = waiting.some((w) => w.cardId === p.cardId);
      if (waits) alert = true;
      return (
        <button key={key} type="button" onClick={() => navigate(cardPath(p.cardId))} className={ROW}>
          <StatusSignal status={waits ? "blocked" : cardSignal(p.status)} />
          <span className="truncate">{p.name}</span>
          <Chip kind="card" />
        </button>
      );
    }
    const a = data.agents.find((x) => pinKey(x) === p.session);
    if (!a) return <GonePin key={key} pin={p} className="py-1 pl-2.5 text-sm" />;
    return (
      <button key={key} type="button" onClick={() => navigate(panePath(a.paneId, data.session))} className={ROW}>
        <StatusDot status={a.status} className="size-2" />
        <span className="truncate">{paneDisplayName(a)}</span>
        <Chip kind="agent" />
        <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">{placeOf(a)}</span>
      </button>
    );
  });

  return (
    <Section id="pinned" label="quick.pinned" count={rows.length} alert={alert}>
      {items}
    </Section>
  );
}

export function RunningList({ data }: { data: HomeData }) {
  const t = useT();
  const navigate = useNavigate();
  const agents = runningAgents(data.agents);
  return (
    <Section id="running" label="quick.running" count={agents.length} alert={agents.some((a) => a.status === "blocked")}>
      {agents.map((a) => (
        <button key={a.paneId} type="button" onClick={() => navigate(panePath(a.paneId, data.session))} className={ROW}>
          <StatusDot status={a.status} className="size-2" />
          <span className="truncate">{paneDisplayName(a)}</span>
          <span className={cn("ml-auto shrink-0 truncate text-xs", a.status === "blocked" ? "text-status-blocked" : "text-muted-foreground")}>
            {a.status === "blocked" ? t("quick.waits") : placeOf(a)}
          </span>
        </button>
      ))}
    </Section>
  );
}
