import { useMemo, useState } from "react";
import { useNavigate, useRouteLoaderData } from "react-router";

import { AppHeader } from "@/components/app-header";
import { AgentsPageView } from "@/components/agents-page";
import { NewSpaceSheet } from "@/components/new-space-sheet";
import { SessionSwitcher } from "@/components/session-switcher";
import { useSpaceActions } from "@/hooks/use-spaces";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { panePath } from "@/lib/nav";
import { remoteAgents } from "@/lib/peers";
import { useT } from "@/i18n";

// Agents — a root tab: every agent of the herd (this machine's and the paired peers'), one group per
// project, one line per agent. Herdr spaces are not named here: a project is what the operator thinks
// in. Tapping a row opens that pane.
export function SpacesRoute() {
  const t = useT();
  const data = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData;
  const navigate = useNavigate();
  const { newSpace } = useSpaceActions();
  const [newOpen, setNewOpen] = useState(false);

  const herd = useMemo(() => [...data.agents, ...data.shellPanes, ...remoteAgents(data.peers ?? [])], [data.agents, data.shellPanes, data.peers]);
  const internal = useMemo(
    () => new Set([data.leadPaneId, data.copilotPaneId].filter((id): id is string => !!id)),
    [data.leadPaneId, data.copilotPaneId],
  );

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col lg:max-w-none">
      {/* The session switcher rides here: below `lg` the sidebar footer that holds it isn't mounted.
          The title is the page's own h1. It self-hides on a single-session install. */}
      <AppHeader rightLead={<SessionSwitcher sessions={data.sessions ?? []} current={data.session} />} />

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-24 lg:pb-0">
        <AgentsPageView
          herd={herd}
          internal={internal}
          machineCount={1 + (data.peers?.length ?? 0)}
          onOpen={(id) => navigate(panePath(id, data.session))}
          onNew={() => setNewOpen(true)}
        />
      </main>

      <NewSpaceSheet open={newOpen} onClose={() => setNewOpen(false)} onCreate={newSpace} title={t("agents.new")} />
    </div>
  );
}
