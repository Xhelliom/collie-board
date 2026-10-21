import { useState } from "react";
import { useNavigate, useRouteLoaderData } from "react-router";

import { AppHeader } from "@/components/app-header";
import { SpaceOverview } from "@/components/space-overview";
import { NewSpaceSheet } from "@/components/new-space-sheet";
import { SessionSwitcher } from "@/components/session-switcher";
import { useSpaceActions } from "@/hooks/use-spaces";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { panePath, spacePath } from "@/lib/nav";
import { useT } from "@/i18n";

// Spaces — a root tab (redesign §9). Extracted from the dashboard (see home.tsx, Phase 3), and
// since the space regrouping it renders the SAME `SpacePaneTree` as the pane column and the pane
// switcher: space → branch → panes, worktrees nested under the repo they were cut from. Tapping a
// space header drills in (that screen owns tab selection and tab creation); tapping a row opens
// that pane.
export function SpacesRoute() {
  const t = useT();
  const data = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData;
  const navigate = useNavigate();
  const { newSpace } = useSpaceActions();
  const [newSpaceOpen, setNewSpaceOpen] = useState(false);

  const drillInto = (id: string) => navigate(spacePath(id, data.session));
  const openPane = (paneId: string) => navigate(panePath(paneId, data.session));

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col lg:max-w-none">
      {/* The session switcher rides here too: this screen is session-scoped (spacePath carries
          `?s=`), and below `lg` the sidebar footer that normally holds it isn't mounted — without
          this you'd see another session's spaces only by going back to Herd. It self-hides on a
          single-session install. */}
      <AppHeader
        title={t("spaces.title")}
        rightLead={<SessionSwitcher sessions={data.sessions ?? []} current={data.session} />}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-24 lg:pb-0">
        <h1 className="sr-only">{t("spaces.title")}</h1>
        <main className="flex-1">
          <SpaceOverview
            workspaces={data.workspaces}
            tabs={data.tabs}
            agents={data.agents}
            shellPanes={data.shellPanes}
            onOpen={drillInto}
            onOpenPane={openPane}
            onNewSpace={() => setNewSpaceOpen(true)}
          />
        </main>
      </div>

      <NewSpaceSheet open={newSpaceOpen} onClose={() => setNewSpaceOpen(false)} onCreate={newSpace} />
    </div>
  );
}
