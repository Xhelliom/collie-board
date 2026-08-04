import { useNavigate, useRouteLoaderData } from "react-router";

import { AppHeader } from "@/components/app-header";
import { SessionSwitcher } from "@/components/session-switcher";
import { ReadOnlyBanner } from "@/components/read-only-banner";
import { AgentList } from "@/components/agent-list";
import { StatusArea } from "@/components/status-area";
import { UpdateBanner } from "@/components/update-banner";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { panePath } from "@/lib/nav";

// Dashboard home screen (redesign §1 "Herd"). Purpose: answer "which agent needs me right now", and
// nothing else — Spaces and the Board are nav destinations now (app-nav.tsx), not rows on this
// screen. What's left is purely the triage: Needs you (loud) → Working (medium) → Idle · done
// (quiet); tapping an agent opens its pane. See agent-list.tsx for the three card treatments and why
// the ranking itself is the design.
export function HomeRoute() {
  const data = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData;
  const navigate = useNavigate();

  const open = (id: string) => navigate(panePath(id, data.session));

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col lg:max-w-none">
      {/* The dashboard toolbar: title + a live pane/space count, the session switcher trailing
          (dashboard-only — it self-hides on a single-session install). Settings is a nav destination
          now, not a header gear. */}
      <AppHeader
        title="Herd"
        subtitle={`${data.agents.length} pane${data.agents.length === 1 ? "" : "s"} · ${data.workspaces.length} space${data.workspaces.length === 1 ? "" : "s"}`}
        rightLead={<SessionSwitcher sessions={data.sessions ?? []} current={data.session} />}
      />

      {/* Content region below the header: a viewport-clipped internal scroller. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-24">
        {/* The screen's one h1. Visually redundant with the toolbar title, so it's sr-only — but
            without it the triage h2s below are an orphan tree to anyone navigating by heading. */}
        <h1 className="sr-only">Herd</h1>
        <ReadOnlyBanner device={data.device} />

        <main className="flex-1 px-4 py-5 lg:px-5 lg:py-6">
          <AgentList agents={data.agents} bridge={data.bridge} onOpen={open} />
        </main>

        {/* An available update / needed restart. The build stamp moved to Settings + the sidebar
            footer (app-nav.tsx) — it no longer needs a home of its own here too. */}
        <UpdateBanner className="px-4 pt-3 lg:px-5" />
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
