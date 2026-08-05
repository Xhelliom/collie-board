import { Outlet, useLoaderData, useNavigate, useParams, useRouteError } from "react-router";

import { usePolling } from "@/hooks/use-polling";
import { usePollBusy } from "@/hooks/use-poll-busy";
import { useAgentTransitions } from "@/hooks/use-transitions";
import { usePushSetup } from "@/hooks/use-push";
import { useConnectionLost } from "@/hooks/use-connection-lost";
import { UpdateAvailableBanner } from "@/components/update-available-banner";
import { AgentToasts } from "@/components/agent-toasts";
import { ConnectionBanner } from "@/components/connection-banner";
import { DogGallop } from "@/components/dog-gallop";
import { AppNav } from "@/components/app-nav";
import { homePath, panePath } from "@/lib/nav";
import { SESSION_PARAM, normalizeSession } from "@/lib/session";
import type { HomeData } from "@/lib/loaders";

// The data root: owns the snapshot loader, drives polling, and fans the herd out to the child
// routes (home + pane detail) via the router's loader data. Mounted only while unlocked (the
// idle-lock in App swaps the whole RouterProvider out), so polling pauses when the app is locked.
export function RootLayout() {
  const data = useLoaderData() as HomeData;
  // useParams accumulates params from matched child routes, so `paneId` is set when the
  // `/pane/:paneId` child is active. useAgentTransitions uses it to suppress a notification for the
  // pane you're already looking at.
  const { paneId } = useParams();

  usePolling(data, paneId);
  // Surface the busy bar when a navigation or a poll runs slow, each against its own threshold —
  // routine fast polls/navigations stay invisible. Mounted here so the whole app shares one
  // detector inside the router context.
  usePollBusy();
  const { toasts, dismiss } = useAgentTransitions(data.agents, paneId ?? null, data.session);
  usePushSetup();

  // A viewport-height row on desktop (nav sidebar + content), a column on mobile (content, with the
  // nav as a fixed tab bar that doesn't participate in flow — see app-nav.tsx). Inside the content
  // column: the top banners (when shown) are in-flow rows at the top and the active route fills the
  // rest (each route root is `min-h-0 flex-1`). This is what keeps a banner from covering the route's
  // sticky header — it reserves real space instead of overlaying.
  return (
    <div className="flex h-[100dvh] flex-col lg:flex-row">
      <AppNav data={data} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* API-observed self-update: mounted unconditionally so its controller runs (and can
            auto-update) for the app's lifetime; renders the slim "tap to update" row only when a fresh
            build is confirmed but auto-update is held off (unsent work) or already spent. */}
        <UpdateAvailableBanner />
        {/* The app's ONE connection surface: a thin, animated bar that stays hidden while healthy, fades
            in amber "reconnecting…" only after ≥4s of sustained trouble (the flicker fix), escalates to a
            red "not connected" cause + Retry/Reload at ≥15s, and flashes green on recovery. Reads the
            same shared-clock signals as the nav dog, so the two always agree. */}
        <ConnectionBanner bridge={data.bridge} error={data.error} authError={data.authError} />
        {/* Foreground notifications, floating under the header on every screen — a ping that arrives
            while you're in the app is a toast you can tap, not a line in a bar you may not be looking
            at. Mounted here so it outlives any single route. */}
        <AgentToasts toasts={toasts} onDismiss={dismiss} />
        <Outlet />
      </div>
    </div>
  );
}

// Shown once, on the very first load, while the snapshot loader resolves (SPA hydration). This is the
// router's HydrateFallback, so it stays mounted until the FIRST loader run settles — and over a dead
// tailnet that initial fetch can hang well past its timeout (or forever on a WebView without
// AbortSignal.timeout). Left as-is, a PWA reopened while the host is unreachable would gallop the dog
// on "Connecting to the herd…" indefinitely, with no way to retry. So once we've been stuck here for
// CONNECTION_LOST_MS (the same wall-clock threshold as the in-app prompt — `connecting` is trivially
// true the whole time we're mounted), the splash escalates to an honest, actionable "Not connected"
// state: the dog rests, the copy says we can't reach Collie, and a Retry re-runs the loaders from
// scratch (a full reload clears most transient failures). Below the threshold it's unchanged.
export function BootSplash() {
  const stuck = useConnectionLost(true);
  if (!stuck) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-3 text-muted-foreground">
        <DogGallop running size="4rem" label="Loading" />
        <span className="text-sm">Connecting to the herd…</span>
      </div>
    );
  }
  return (
    <div className="flex h-[100dvh] flex-col items-center justify-center gap-3 p-6 text-center">
      {/* Rest = the static app icon, muted (grayscale + dimmed) to read asleep — NOT a gallop
          rest-frame, whose full-stretch mid-stride pose looks frozen mid-run. The "Not connected"
          copy below carries the accessible meaning, so the icon is decorative. */}
      <img src="/favicon.svg" alt="" className="size-16 opacity-40 grayscale" />
      <p className="font-medium text-foreground">Not connected</p>
      <p className="max-w-xs text-sm text-muted-foreground">
        Can&rsquo;t reach Collie — check your connection to the host, then try again.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="text-sm underline underline-offset-4"
      >
        Retry
      </button>
    </div>
  );
}

// Recovery screen for a render-phase error or a loader throw. Mounted as the errorElement of the root
// AND of each leaf that can fail on its own (pane, card, board, history) — a broken pane must not take
// the board and the dashboard down with it, which is the whole point of putting it on the children.
//
// The way out is a client-side navigation to the parent screen, NOT a reload: the router remounts the
// parent's element and re-runs its loader, which clears the error boundary and keeps everything
// already in memory. `to` names that parent (default: the dashboard).
export function RootError({ to }: { to?: string }) {
  const error = useRouteError();
  const navigate = useNavigate();
  const message = error instanceof Error ? error.message : "Unknown error";
  // h-[100dvh] is for the root barrier (it replaces the whole app); flex-1 min-h-0 is for the leaf
  // ones, which render inside RootLayout's viewport column and must not push it past the screen.
  return (
    <div className="flex h-[100dvh] min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="font-medium text-destructive">Something went wrong</h1>
      <p className="max-w-xs text-sm text-muted-foreground">{message}</p>
      <button
        type="button"
        onClick={() => navigate(to ?? homePath(sessionFromUrl()))}
        className="text-sm underline underline-offset-4"
      >
        Go back
      </button>
    </div>
  );
}

// The history route's barrier: its parent is the pane it belongs to, which needs the live :paneId.
export function PaneError() {
  const { paneId = "" } = useParams();
  return <RootError to={panePath(paneId, sessionFromUrl())} />;
}

// The session we're in, read from the live URL rather than the router context — the context we're
// rendering in is the throwing one. Primary → undefined → a plain, unsuffixed path.
function sessionFromUrl(): string | undefined {
  return normalizeSession(new URLSearchParams(window.location.search).get(SESSION_PARAM));
}
