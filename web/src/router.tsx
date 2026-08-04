import { createBrowserRouter } from "react-router";

import { BootSplash, PaneError, RootError, RootLayout } from "@/routes/root";
import { HomeRoute } from "@/routes/home";
import { SpaceRoute } from "@/routes/space";
import { SpacesRoute } from "@/routes/spaces";
import { DetailRoute } from "@/routes/detail";
import { HistoryRoute } from "@/routes/history";
import { SettingsRoute } from "@/routes/settings";
import { BoardRoute } from "@/routes/board";
import { CardRoute } from "@/routes/card";
import { historyLoader, rootLoader, paneLoader, ROOT_ROUTE_ID } from "@/lib/loaders";
import { boardLoader, cardLoader } from "@/lib/board-loaders";
import { boardPath } from "@/lib/board";

// We don't use view transitions. React Router persists an "applied view transitions" map to
// sessionStorage ("remix-router-transitions") and replays a phantom same-location transition on every
// revalidation for any path it once saw a `viewTransition: true` navigation from. A device that ran an
// older Collie build (which did use them) can carry a stale entry that fires
// document.startViewTransition on every poll. Clear it on boot — our code never repopulates it. The
// `:root { view-transition-name: none }` in index.css is the belt to this: even a stray transition
// then captures nothing, so there's no visible flicker regardless of this key's name.
try {
  sessionStorage.removeItem("remix-router-transitions");
} catch {
  // sessionStorage access can throw in locked-down / private contexts — ignore.
}

// Created once at module scope so the idle-lock in App can unmount/remount RouterProvider without
// losing the current location (the router instance retains it; loaders re-run fresh on remount).
export const router = createBrowserRouter([
  {
    id: ROOT_ROUTE_ID,
    path: "/",
    loader: rootLoader,
    element: <RootLayout />,
    // Catches render-phase errors and loader throws (e.g. a missing :paneId) so a component bug
    // shows a recoverable screen instead of React Router's blank default.
    //
    // The leaves below carry their OWN barrier. React Router walks up to the nearest errorElement, so
    // with only this one a single bad pane blanked the board and the dashboard along with it. Each
    // leaf's barrier keeps RootLayout (and therefore every other screen) mounted and reachable, and
    // its button navigates to that leaf's parent rather than reloading the app.
    errorElement: <RootError />,
    HydrateFallback: BootSplash,
    children: [
      { index: true, element: <HomeRoute /> },
      // The board and a card's page. Both are children of the root, so the root's poll tick
      // revalidates them for free — no board-specific polling.
      {
        id: "board",
        path: "board",
        loader: boardLoader,
        element: <BoardRoute />,
        errorElement: <RootError />,
      },
      {
        path: "card/:cardId",
        loader: cardLoader,
        element: <CardRoute />,
        errorElement: <RootError to={boardPath()} />,
      },
      { path: "space/:spaceId", element: <SpaceRoute /> },
      { path: "spaces", element: <SpacesRoute /> },
      { path: "settings", element: <SettingsRoute /> },
      {
        path: "pane/:paneId",
        loader: paneLoader,
        element: <DetailRoute />,
        errorElement: <RootError />,
      },
      {
        path: "pane/:paneId/history",
        loader: historyLoader,
        element: <HistoryRoute />,
        errorElement: <PaneError />,
        // Opt OUT of the poll loop. revalidate() re-runs every active loader, and a transcript can be
        // hundreds of turns — re-pulling it every 1.5s would be pure waste, and it would fight the
        // view's own "load older" paging by resetting the page under it. History is fetched on
        // navigation; the view pages back through it with direct api calls.
        shouldRevalidate: () => false,
      },
    ],
  },
]);
