import { Await, useLoaderData, useNavigate, useRouteLoaderData } from "react-router";
import { Suspense, useMemo, type ReactNode } from "react";

import { AppHeader } from "@/components/app-header";
import { NavMark } from "@/components/app-nav";
import { SessionSwitcher } from "@/components/session-switcher";
import { ReadOnlyBanner } from "@/components/read-only-banner";
import { useT } from "@/i18n";
import { AgentList } from "@/components/agent-list";
import { StatusArea } from "@/components/status-area";
import { UpdateBanner } from "@/components/update-banner";
import {
  CardsError,
  HomeActivity,
  HomeHero,
  HomeKpis,
  HomeKpisSkeleton,
  OpenPrs,
  ProjectTiles,
  ProjectTilesSkeleton,
  UsageRings,
  useRepoLots,
  useRepoPhases,
} from "@/components/home-dashboard";
import type { BoardData, HomeBoardData } from "@/lib/board-loaders";
import { reposOf } from "@/lib/board";
import { dashboardOf } from "@/lib/dashboard";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { panePath } from "@/lib/nav";

// Dashboard home screen (redesign §1 "Herd"). Purpose: answer "which agent needs me right now", and
// nothing else — Spaces and the Board are nav destinations now (app-nav.tsx), not rows on this
// screen. What's left is purely the triage: Needs you (loud) → Working (medium) → Idle · done
// (quiet); tapping an agent opens its pane. See agent-list.tsx for the three card treatments and why
// the ranking itself is the design.
export function HomeRoute() {
  const data = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData;
  const { board } = useLoaderData() as HomeBoardData;
  const navigate = useNavigate();
  const t = useT();

  const open = (id: string) => navigate(panePath(id, data.session));

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col lg:max-w-none">
      {/* The dashboard toolbar: title + a live pane/space count, the session switcher trailing
          (also on Spaces, the other session-scoped root screen — it self-hides on a single-session
          install). Settings is a nav destination now, not a header gear. */}
      <AppHeader
        title={t("home.title")}
        subtitle={t("home.spaces", { count: data.workspaces.length })}
        icon={
          <span className="lg:hidden">
            <NavMark gallop={false} lost={false} size={32} />
          </span>
        }
        rightLead={<SessionSwitcher sessions={data.sessions ?? []} current={data.session} />}
      />

      {/* Content region below the header: a viewport-clipped internal scroller. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-24 lg:pb-12">
        {/* The screen's one h1. Visually redundant with the toolbar title, so it's sr-only — but
            without it the triage h2s below are an orphan tree to anyone navigating by heading. */}
        <h1 className="sr-only">{t("home.title")}</h1>
        <ReadOnlyBanner device={data.device} />
        {/* An available update / needed restart, up where it is seen (not after the last section). */}
        <UpdateBanner className="px-4 pt-3 lg:px-5" />

        <main className="flex-1 px-4 py-5 lg:px-5 lg:py-6">
          <div className="mx-auto flex max-w-6xl flex-col gap-6">
            <HomeHero agents={data.agents} />
            {/* The triage stays the heart of the screen, the card KPIs under it; the board's context sits
                beside them on a wide screen and under them on a phone. `grid-cols-1` + `min-w-0`: an
                implicit track is `auto`, so one `truncate` line would otherwise widen the whole page. */}
            <div className="grid grid-cols-1 gap-6 [&>*]:min-w-0 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="flex flex-col gap-6">
                {/* The hero already says "no agent running": no second empty block. */}
                <AgentList agents={data.agents} bridge={data.bridge} onOpen={open} emptyState={false} />
                <CardBlock board={board} fallback={<HomeKpisSkeleton />} label={t("home.kpi.title")}>
                  {(b) => <Kpis board={b} />}
                </CardBlock>
              </div>
              <aside className="flex flex-col gap-6">
                <CardBlock board={board} fallback={<ProjectTilesSkeleton />} label={t("home.projects")}>
                  {(b) => <Projects board={b} />}
                </CardBlock>
                <OpenPrs />
                <UsageRings />
                <HomeActivity session={data.session} />
              </aside>
            </div>
          </div>
        </main>

      </div>

      {/* Status overlay, anchored to the bottom of the viewport (no input here) — same slim line,
          floating so it never shifts the list. Stays outside the scroller so it never scrolls away.
          Raised clear of the mobile tab bar (app-nav.tsx), which now owns that edge below `lg`. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-14 z-30 mx-auto w-full max-w-screen-sm px-3 pb-[calc(env(safe-area-inset-bottom)_+_0.75rem)] lg:bottom-0 lg:max-w-none">
        <StatusArea />
      </div>
    </div>
  );
}

// The two blocks that read the cards. On a cold start `board` is a promise: each block waits under its own
// skeleton and fails in its own slot, while the triage above renders from the snapshot (audit perf #3).
function CardBlock({ board, fallback, label, children }: { board: HomeBoardData["board"]; fallback: ReactNode; label: string; children: (b: BoardData) => ReactNode }) {
  return (
    <Suspense fallback={fallback}>
      <Await resolve={board} errorElement={<CardsError label={label} />}>
        {children}
      </Await>
    </Suspense>
  );
}

function Kpis({ board }: { board: BoardData }) {
  const dash = useMemo(() => dashboardOf(board.cards, Date.now(), {}, board.counts?.delivered), [board]);
  return <HomeKpis dash={dash} />;
}

function Projects({ board }: { board: BoardData }) {
  const phases = useRepoPhases(useMemo(() => reposOf(board.cards).map((r) => r.path), [board.cards]));
  const dash = useMemo(() => dashboardOf(board.cards, Date.now(), phases), [board.cards, phases]);
  const stamp = useMemo(() => board.cards.map((c) => `${c.id}:${c.status}:${c.updatedAt}`).join(), [board.cards]);
  const lots = useRepoLots(useMemo(() => dash.repos.map((r) => r.path), [dash.repos]), stamp);
  return <ProjectTiles repos={dash.repos} lots={lots} />;
}
