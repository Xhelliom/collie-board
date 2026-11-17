import { createBrowserRouter } from "react-router";

import { BootSplash, PaneError, RootError, RootLayout } from "@/routes/root";
import { HomeRoute } from "@/routes/home";
import { docsLoader } from "@/lib/docs";
import { recetteLoader } from "@/lib/recette";
import { galleryLoader, historyLoader, rootLoader, paneLoader, paneArtifactsLoader, ROOT_ROUTE_ID } from "@/lib/loaders";
import { boardRouteLoader, cardLoader, homeLoader, projectLoader, prDetailLoader, prsLoader, roadmapLoader } from "@/lib/board-loaders";
import { boardPath } from "@/lib/board";
import { attachNavCache } from "@/lib/nav-cache";

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
      // The board's cards ride along for the dashboard's figures; the root's poll revalidates them.
      { index: true, loader: homeLoader, element: <HomeRoute /> },
      // The board and a card's page. Both are children of the root, so the root's poll tick
      // revalidates them for free — no board-specific polling.
      {
        id: "board",
        path: "board",
        loader: boardRouteLoader,
        lazy: () => import("@/routes/board").then((m) => ({ Component: m.BoardRoute })),
        errorElement: <RootError />,
      },
      { path: "board/project", loader: projectLoader, lazy: () => import("@/routes/project").then((m) => ({ Component: m.ProjectRoute })), errorElement: <RootError to={boardPath()} /> },
      // Polled with the root: the live roadmap, no file to regenerate.
      { path: "board/roadmap", loader: roadmapLoader, lazy: () => import("@/routes/roadmap").then((m) => ({ Component: m.RoadmapRoute })), errorElement: <RootError to={boardPath()} /> },
      {
        path: "board/prs",
        loader: prsLoader,
        lazy: () => import("@/routes/prs").then((m) => ({ Component: m.PrsRoute })),
        errorElement: <RootError to={boardPath()} />,
        // Not polled: GitHub is asked on the Check tap, and the journal only moves on a tap too.
        shouldRevalidate: () => false,
      },
      {
        path: "board/prs/:number",
        loader: prDetailLoader,
        lazy: () => import("@/routes/pr").then((m) => ({ Component: m.PrRoute })),
        errorElement: <RootError to={boardPath()} />,
        // Not polled: read on open, like the list.
        shouldRevalidate: () => false,
      },
      {
        path: "board/recette",
        loader: recetteLoader,
        lazy: () => import("@/routes/recette").then((m) => ({ Component: m.RecetteRoute })),
        errorElement: <RootError to={boardPath()} />,
        // Not polled: the list reads the deliverables off disk, and only moves on a verdict — refetched then.
        shouldRevalidate: ({ currentUrl, nextUrl }) => currentUrl.searchParams.get("repo") !== nextUrl.searchParams.get("repo"),
      },
      {
        path: "board/documents",
        loader: docsLoader,
        lazy: () => import("@/routes/documents").then((m) => ({ Component: m.DocumentsRoute })),
        errorElement: <RootError to={boardPath()} />,
        // Not polled (read on open): only a change of repo reads the index again — opening a document doesn't.
        shouldRevalidate: ({ currentUrl, nextUrl }) => currentUrl.searchParams.get("repo") !== nextUrl.searchParams.get("repo"),
      },
      { path: "board/page", lazy: () => import("@/routes/custom-page").then((m) => ({ Component: m.CustomPageRoute })), errorElement: <RootError to={boardPath()} /> },
      { path: "board/settings", lazy: () => import("@/routes/repo-settings").then((m) => ({ Component: m.RepoSettingsRoute })), errorElement: <RootError to={boardPath()} /> },
      {
        path: "card/:cardId",
        loader: cardLoader,
        lazy: () => import("@/routes/card").then((m) => ({ Component: m.CardRoute })),
        errorElement: <RootError to={boardPath()} />,
      },
      { path: "space/:spaceId", lazy: () => import("@/routes/space").then((m) => ({ Component: m.SpaceRoute })) },
      { path: "spaces", lazy: () => import("@/routes/spaces").then((m) => ({ Component: m.SpacesRoute })) },
      { path: "settings", lazy: () => import("@/routes/settings").then((m) => ({ Component: m.SettingsRoute })) },
      {
        path: "gallery",
        loader: galleryLoader,
        lazy: () => import("@/routes/gallery").then((m) => ({ Component: m.GalleryRoute })),
        errorElement: <RootError />,
        // Same reasoning as history: the poll tick would otherwise re-walk the bridge's scratchpad
        // tree every 1.5 s for a listing that changes when an agent happens to save a picture.
        shouldRevalidate: () => false,
      },
      {
        path: "pane/:paneId",
        loader: paneLoader,
        lazy: () => import("@/routes/detail").then((m) => ({ Component: m.DetailRoute })),
        errorElement: <RootError />,
      },
      {
        path: "pane/:paneId/history",
        loader: historyLoader,
        lazy: () => import("@/routes/history").then((m) => ({ Component: m.HistoryRoute })),
        errorElement: <PaneError />,
        // Opt OUT of the poll loop. revalidate() re-runs every active loader, and a transcript can be
        // hundreds of turns — re-pulling it every 1.5s would be pure waste, and it would fight the
        // view's own "load older" paging by resetting the page under it. History is fetched on
        // navigation; the view pages back through it with direct api calls.
        shouldRevalidate: () => false,
      },
      // Polled like the pane itself (same loader), so the zoomed output stays live.
      { path: "pane/:paneId/zoom", loader: paneLoader, lazy: () => import("@/routes/zoom").then((m) => ({ Component: m.ZoomRoute })), errorElement: <PaneError /> },
      {
        path: "pane/:paneId/artifacts",
        loader: paneArtifactsLoader,
        lazy: () => import("@/routes/artifacts").then((m) => ({ Component: m.ArtifactsRoute })),
        errorElement: <PaneError />,
        // Same reasoning as history/gallery: the list walks the card's worktree diff on the bridge,
        // so re-running it every 1.5 s would burn a git call per tick for a view you open once.
        shouldRevalidate: () => false,
      },
    ],
  },
]);

// A screen already seen renders from its last data, then refreshes; a touched project or card link
// starts loading before the tap lands (lib/nav-cache.ts).
attachNavCache(router);
