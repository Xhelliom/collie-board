import { Await, useLoaderData, useNavigate, useRouteLoaderData } from "react-router";
import { Suspense, useMemo, useState, type ReactNode } from "react";

import { AppHeader } from "@/components/app-header";
import { NavMark } from "@/components/app-nav";
import { SessionSwitcher } from "@/components/session-switcher";
import { ReadOnlyBanner } from "@/components/read-only-banner";
import { useT } from "@/i18n";
import { AgentList, IdleAgents } from "@/components/agent-list";
import { PhonePinned } from "@/components/sidebar-quick";
import { UpdateBanner } from "@/components/update-banner";
import {
  CardsError,
  CardsLine,
  CardsLineSkeleton,
  HomeHero,
  Machines,
  machinesOf,
  OpenPrs,
  ProjectRows,
  ProjectRowsSkeleton,
  UsageRings,
  useRepoLots,
  useRepoPhases,
  useRepoGoals,
  useRepoToTest,
} from "@/components/home-dashboard";
import type { BoardData, HomeBoardData } from "@/lib/board-loaders";
import { repoName, reposOf } from "@/lib/board";
import { useListedRepos } from "@/lib/listed-repos";
import { dashboardOf } from "@/lib/dashboard";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { panePath } from "@/lib/nav";
import { remoteAgents } from "@/lib/peers";
import { isFreeShell, isOrchestrator } from "@/lib/agent-groups";

// « Avec les orchestrateurs », remembered on this device. Off: they are out of the title, the ring and
// the list — an orchestrator that waits for you stays in « T'attendent » whatever this says.
const ORCH_KEY = "collie-home-with-orch";
function useWithOrch(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(ORCH_KEY) === "1";
    } catch {
      return false;
    }
  });
  const set = (v: boolean) => {
    setOn(v);
    try {
      localStorage.setItem(ORCH_KEY, v ? "1" : "0");
    } catch {
      /* private window: the choice just isn't remembered */
    }
  };
  return [on, set];
}

// The home screen: answer « who needs me, who works, where are my projects » in one read. The title is
// the herd's state as a sentence; the agents line up one per row by state; the projects one per row;
// the machines and the quota sit in a side column on a wide screen, at the foot on a phone.
export function HomeRoute() {
  const data = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData;
  const { board } = useLoaderData() as HomeBoardData;
  const navigate = useNavigate();
  const t = useT();
  const [withOrch, setWithOrch] = useWithOrch();

  const open = (id: string) => navigate(panePath(id, data.session));
  // One herd: the paired peers' agents beside this machine's, each with its machine chip.
  const herd = useMemo(() => [...data.agents, ...data.shellPanes.filter(isFreeShell), ...remoteAgents(data.peers ?? [])], [data.agents, data.shellPanes, data.peers]);
  const shown = useMemo(() => herd.filter((a) => withOrch || a.status === "blocked" || !isOrchestrator(a)), [herd, withOrch]);
  const machines = machinesOf(
    { bridge: data.bridge, engine: data.localEngine, agents: data.agents.length + data.shellPanes.filter(isFreeShell).length },
    data.peers ?? [],
    t("home.machine.this"),
  );

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col lg:max-w-none">
      {/* The toolbar keeps the mark and the session switcher; the title is the sentence below. */}
      <AppHeader
        icon={
          <span className="lg:hidden">
            <NavMark gallop={false} lost={false} size={32} />
          </span>
        }
        rightLead={<SessionSwitcher sessions={data.sessions ?? []} current={data.session} />}
      />

      {/* Content region below the header: a viewport-clipped internal scroller. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-24 lg:pb-12">
        <ReadOnlyBanner device={data.device} />
        {/* An available update / needed restart, up where it is seen (not after the last section). */}
        <UpdateBanner className="px-4 pt-3 lg:px-5" />

        <main className="flex-1 px-4 py-5 lg:px-12 lg:py-10">
          {/* `grid-cols-1` + `min-w-0`: an implicit track is `auto`, so one `truncate` line would
              otherwise widen the whole page. */}
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-x-12 gap-y-8 [&>*]:min-w-0 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="flex flex-col gap-8">
              <HomeHero
                agents={shown}
                cards={
                  <CardBlock board={board} fallback={<CardsLineSkeleton />}>
                    {(b) => <Cards board={b} />}
                  </CardBlock>
                }
              />
              <AgentList agents={shown} onOpen={open} hasOrch={herd.some(isOrchestrator)} withOrch={withOrch} onWithOrch={setWithOrch} />
              {/* On a phone the resting agents fold right under the working ones; on a wide screen, below the projects. */}
              <IdleAgents agents={shown} onOpen={open} className="-mt-6 lg:order-last lg:mt-0" />
              {/* The phone's pins (the sidebar holds them on a wide screen: renders nothing there). */}
              <PhonePinned data={data} />
              <CardBlock board={board} fallback={<ProjectRowsSkeleton />} label={t("home.projects.current")}>
                {(b) => <Projects board={b} />}
              </CardBlock>
              <Machines machines={machines} strip className="lg:hidden" />
            </div>
            <aside className="hidden flex-col gap-6 pt-1.5 lg:flex">
              <Machines machines={machines} />
              <OpenPrs />
              <UsageRings />
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}

// The blocks that read the cards. On a cold start `board` is a promise: each block waits under its own
// skeleton and fails in its own slot, while the agents above render from the snapshot (audit perf #3).
function CardBlock({ board, fallback, label, children }: { board: HomeBoardData["board"]; fallback: ReactNode; label?: string; children: (b: BoardData) => ReactNode }) {
  return (
    <Suspense fallback={fallback}>
      <Await resolve={board} errorElement={<CardsError label={label} />}>
        {children}
      </Await>
    </Suspense>
  );
}

function Cards({ board }: { board: BoardData }) {
  const dash = useMemo(() => dashboardOf(board.cards), [board]);
  return <CardsLine dash={dash} />;
}

function Projects({ board }: { board: BoardData }) {
  const phases = useRepoPhases(useMemo(() => reposOf(board.cards).map((r) => r.path), [board.cards]));
  const listed = useListedRepos();
  const dash = useMemo(() => {
    const d = dashboardOf(board.cards, Date.now(), phases);
    // A repo the operator added by hand gets its (empty) row until its first card.
    const extra = listed.filter((path) => !d.repos.some((r) => r.path === path));
    return { ...d, repos: [...d.repos, ...extra.map((path) => ({ path, name: repoName(path), current: [], active: 0, waiting: 0, blocked: 0, closedCount: 0, updatedAt: 0 }))] };
  }, [board.cards, phases, listed]);
  const stamp = useMemo(() => board.cards.map((c) => `${c.id}:${c.status}:${c.updatedAt}`).join(), [board.cards]);
  const paths = useMemo(() => dash.repos.map((r) => r.path), [dash.repos]);
  const lots = useRepoLots(paths, stamp);
  const toTest = useRepoToTest(paths, stamp);
  const goals = useRepoGoals(paths, stamp);
  return <ProjectRows repos={dash.repos} lots={lots} toTest={toTest} goals={goals} />;
}
