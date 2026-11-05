import { useLoaderData, useParams, useRouteLoaderData } from "react-router";

import { OutputZoom } from "@/components/output-zoom";
import { useBack } from "@/hooks/use-back";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import { ROOT_ROUTE_ID, type HomeData, type PaneData } from "@/lib/loaders";
import { panePath } from "@/lib/nav";
import { paneDisplayName } from "@/lib/types";

// The pane's output full screen (`/pane/:id/zoom`): the pane loader's live text, nothing else.
export function ZoomRoute() {
  const pane = useLoaderData() as PaneData;
  const root = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData;
  const { paneId = "" } = useParams();
  const { prefs } = useDisplayPrefs();
  const back = useBack(panePath(paneId, pane.session));
  const view = root.agents.find((a) => a.paneId === paneId) ?? root.shellPanes.find((p) => p.paneId === paneId);
  return <OutputZoom text={pane.text} fontSize={prefs.fontSize} title={view ? paneDisplayName(view) : paneId} onClose={back} />;
}
