import { Columns3, Dog, FolderKanban, LayoutGrid, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLocation, useMatches, useNavigate, useSearchParams } from "react-router";

import { cn } from "@/lib/utils";
import { useT, type MessageKey } from "@/i18n";
import { isConnecting } from "@/lib/connection";
import { useConnectionLost, useConnectionTrouble } from "@/hooks/use-connection-lost";
import { useLoadingStalled } from "@/hooks/use-loading-stalled";
import { useKnownRepos } from "@/hooks/use-known-repos";
import { DogGallop } from "@/components/dog-gallop";
import { SessionSwitcher } from "@/components/session-switcher";
import { BuildStamp } from "@/components/build-stamp";
import { homePath, spacePath, spacesPath, settingsPath } from "@/lib/nav";
import { boardPath, loadRepoScope, projectPath, repoName, reposOf, saveRepoScope, withKnownRepos } from "@/lib/board";
import { loadLastProject } from "@/lib/quick-access";
import { SidebarQuick } from "@/components/sidebar-quick";
import type { BoardData } from "@/lib/board-loaders";
import type { HomeData } from "@/lib/loaders";

// The nav shell (redesign §Navigation). Mounted once in RootLayout, above the route tree, so it
// owns the two things that used to live in every AppHeader: the Collie mark's connection animation,
// and "where am I in the app". Below `lg` it renders as a bottom tab bar (mobile), at `lg` and up as a
// persistent 248px sidebar — both on EVERY screen, entered ones (pane, space) included: the operator
// never loses the way out. An entered screen lifts its bottom-pinned chrome (the pane's composer) clear
// of the bar with ABOVE_TAB_BAR; the status line (status-area.tsx) is raised above it too.
export function AppNav({ data }: { data: HomeData }) {
  return (
    <>
      <Sidebar data={data} />
      <MobileTabBar data={data} />
    </>
  );
}

interface NavItem {
  key: string;
  label: MessageKey;
  icon: LucideIcon;
  path: (session: string | undefined) => string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { key: "herd", label: "home.title", icon: Dog, path: homePath },
  { key: "board", label: "board.title", icon: Columns3, path: () => boardPath() },
  // The project last opened; the board's repo scope before any was.
  { key: "projects", label: "nav.projects", icon: FolderKanban, path: () => projectPath(loadLastProject() ?? loadRepoScope()) },
  { key: "spaces", label: "spaces.title", icon: LayoutGrid, path: spacesPath },
  { key: "settings", label: "settings.title", icon: Settings, path: settingsPath },
];
// Desktop splits the four destinations: Herd/Board/Spaces are the sidebar's main nav rows, Settings
// moves to the footer beside SessionSwitcher/BuildStamp (redesign's nav spec — "Bottom: SessionSwitcher
// … then Settings, then BuildStamp"). Mobile's tab bar has room for all four as equals instead.
/** Bottom padding that lifts an in-flow bottom edge (the pane's composer) clear of the mobile tab bar:
 *  its min-h-14 + 0.875rem + safe area, plus the 1px border. Nothing at `lg`, where the bar is hidden. */
export const ABOVE_TAB_BAR = "max-lg:pb-[calc(3.5rem+0.875rem+1px+env(safe-area-inset-bottom))]";
const MAIN_NAV_ITEMS = NAV_ITEMS.filter((item) => item.key !== "settings");
const SETTINGS_ITEM = NAV_ITEMS.find((item) => item.key === "settings")!;

/** The root paths (and their detail views) the tab bar / sidebar active-state matches against (session query ignored). */
function rootKeyFor(pathname: string): string | undefined {
  if (pathname === "/") return "herd";
  if (pathname === "/board/project") return "projects";
  // Board and Open PRs are views of one thing: the Board tab stays lit (and the bar visible).
  // A card is the board's own detail view: same tab lit.
  if (pathname === "/board" || pathname.startsWith("/board/") || pathname.startsWith("/card/")) return "board";
  if (pathname === "/spaces") return "spaces";
  if (pathname === "/settings") return "settings";
  // A pane is an agent of the herd: Herd stays lit, like a card lights Board. A space detail has its
  // own Spaces tab. Anything else (gallery…) lights nothing — the bar still shows.
  if (pathname.startsWith("/pane/")) return "herd";
  if (pathname.startsWith("/space/")) return "spaces";
  return undefined;
}

/** Shared connection-dog state — the mark gallops on sustained trouble, rests muted once lost,
 *  reading the same shared clock as ConnectionBanner so the two can never disagree (see
 *  collie-home.tsx, whose gallop/rest logic this mirrors now that the mark lives in the nav). */
function useNavDogState(data: HomeData) {
  const stalled = useLoadingStalled();
  const connecting = isConnecting({ bridge: data.bridge, error: data.error, stalled });
  const trouble = useConnectionTrouble(connecting);
  const lost = useConnectionLost(connecting);
  return { gallop: trouble && !lost, lost };
}

/** The ringed favicon mark, gallop/lost-aware. Also used statically (both false) by the dashboard's
 *  own header on mobile — see AppHeader's `icon` prop. */
export function NavMark({ gallop, lost, size }: { gallop: boolean; lost: boolean; size: number }) {
  const px = `${size}px`;
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-muted-foreground/40 ring-1 ring-[whitesmoke]/60"
      style={{ width: px, height: px }}
    >
      {gallop ? (
        <DogGallop running size={`${Math.round(size * 0.8)}px`} />
      ) : (
        <img
          src="/favicon.svg"
          alt=""
          className={cn("size-[80%]", lost && "opacity-40 grayscale")}
        />
      )}
    </span>
  );
}

function Sidebar({ data }: { data: HomeData }) {
  const navigate = useNavigate();
  const location = useLocation();
  const active = rootKeyFor(location.pathname);
  const t = useT();
  const { gallop, lost } = useNavDogState(data);
  const blocked = data.agents.filter((a) => a.status === "blocked").length;

  return (
    <nav
      className="hidden w-[248px] flex-none flex-col border-r border-border bg-chrome p-4 px-3 lg:flex"
    >
      <button
        type="button"
        onClick={() => navigate(homePath(data.session))}
        className="mb-4 flex items-center gap-2.5 rounded-lg px-1 py-1 text-left"
        aria-label={!gallop && !lost ? "Collie Board" : lost ? t("nav.mark.lost") : t("nav.mark.reconnecting")}
      >
        <NavMark gallop={gallop} lost={lost} size={32} />
        <span className="text-[15px] font-semibold tracking-[-0.02em]">Collie Board</span>
      </button>

      <div className="flex flex-col gap-0.5">
        {MAIN_NAV_ITEMS.map((item) => {
          const isActive = item.key === active;
          // Herd's is an ALERT (needs-you) — Spaces' is plain information (how many are open).
          const alertCount = item.key === "herd" && blocked > 0 ? blocked : undefined;
          const infoCount = item.key === "spaces" ? data.workspaces.length : undefined;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate(item.path(data.session))}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-sm transition-colors",
                isActive
                  ? "bg-brand/16 font-semibold text-brand"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <item.icon className="size-[18px] shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">{t(item.label)}</span>
              {(alertCount ?? infoCount) !== undefined && (
                <span className="text-xs tabular-nums">{alertCount ?? infoCount}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Screen-scoped list, below the nav rows — the sidebar's one nod to "where am I" beyond
          the four root destinations. Repos on /board (replaces RepoFilter's old always-visible
          strip), spaces on / (replaces the dashboard's own space cards) — nothing elsewhere. */}
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        <SidebarQuick data={data} />
        <BoardRepoList />
        <HomeSpacesList data={data} />
      </div>

      <div className="mt-auto flex flex-col gap-2 pt-4">
        <SessionSwitcher sessions={data.sessions ?? []} current={data.session} />
        <button
          type="button"
          onClick={() => navigate(SETTINGS_ITEM.path(data.session))}
          aria-current={active === "settings" ? "page" : undefined}
          className={cn(
            "flex items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-sm transition-colors",
            active === "settings"
              ? "bg-brand/16 font-semibold text-brand"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
        >
          <SETTINGS_ITEM.icon className="size-[18px] shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">{t(SETTINGS_ITEM.label)}</span>
        </button>
        <BuildStamp className="text-[11px] font-mono text-muted-foreground/60" />
      </div>
    </nav>
  );
}

/**
 * The board's repo scope, spatial in the sidebar instead of a horizontal chip strip (redesign
 * §Navigation: "Below the nav, a screen-scoped list… the repos on /board, this replaces
 * RepoFilter"). Reads the board loader's OWN data via `useMatches()` — this component is mounted at
 * the nav's fixed position, above wherever `/board` sits in the tree, so it has no other way to see
 * that route's data. Writes the SAME `?repo=` search param and `collie:board-repo` storage key
 * `routes/board.tsx`'s own `pickRepo` does (ADR 0006), so the two can never disagree about scope —
 * whichever one last wrote wins, and the other re-reads it from the same URL on its next render.
 */
function BoardRepoList() {
  const t = useT();
  const location = useLocation();
  const matches = useMatches();
  const [params, setParams] = useSearchParams();
  const onBoard = location.pathname === "/board" || location.pathname === "/board/project";
  const known = useKnownRepos(onBoard);
  if (!onBoard) return null;

  // The board's and the project view's loaders both return the cards; the repo list reads whichever is up.
  const board = matches.map((m) => m.data as BoardData | undefined).find((d) => Array.isArray(d?.cards));
  if (!board) return null;

  const activeRepo = params.get("repo");
  const reposInUse = withKnownRepos(reposOf(board.cards), known);
  const repos =
    activeRepo && !reposInUse.some((r) => r.path === activeRepo)
      ? [{ path: activeRepo, name: repoName(activeRepo) }, ...reposInUse]
      : reposInUse;
  if (activeRepo === null && repos.length < 2) return null;

  function pick(repoPath: string | null) {
    saveRepoScope(repoPath);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (repoPath === null) next.delete("repo");
        else next.set("repo", repoPath);
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-0.5 border-t border-border/60 pt-4">
      <span className="px-2.5 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
        {t("filter.repos")}
      </span>
      <button
        type="button"
        onClick={() => pick(null)}
        className={cn(
          "truncate rounded-[10px] px-2.5 py-2 text-left text-sm",
          activeRepo === null
            ? "bg-brand/16 font-semibold text-brand"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        )}
      >
        {t("filter.all")}
      </button>
      {repos.map((repo) => (
        <button
          key={repo.path}
          type="button"
          onClick={() => pick(activeRepo === repo.path ? null : repo.path)}
          className={cn(
            "truncate rounded-[10px] px-2.5 py-2 text-left text-sm",
            activeRepo === repo.path
              ? "bg-brand/16 font-semibold text-brand"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
        >
          {repo.name}
        </button>
      ))}
    </div>
  );
}

/**
 * The dashboard's spaces, spatial in the sidebar instead of the cards `SpaceOverview` used to render
 * inline on "/" (redesign §Navigation: "Below the nav, a screen-scoped list… the spaces on /").
 * `data` is HomeData, passed straight down — unlike {@link BoardRepoList} this needs no `useMatches`
 * detour, the root loader already carries every workspace.
 */
function HomeSpacesList({ data }: { data: HomeData }) {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  if (location.pathname !== "/" || data.workspaces.length === 0) return null;

  return (
    <div className="mt-4 flex flex-col gap-0.5 border-t border-border/60 pt-4">
      <span className="px-2.5 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
        {t("spaces.title")}
      </span>
      {data.workspaces.map((ws) => (
        <button
          key={ws.workspaceId}
          type="button"
          onClick={() => navigate(spacePath(ws.workspaceId, data.session))}
          className="truncate rounded-[10px] px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          {ws.label}
        </button>
      ))}
    </div>
  );
}

function MobileTabBar({ data }: { data: HomeData }) {
  const navigate = useNavigate();
  const location = useLocation();
  const active = rootKeyFor(location.pathname);
  const t = useT();
  // The Herd tab's own Dog glyph doubles as the connection mark (collie-home.tsx's job, moved here):
  // it gallops on sustained trouble and rests muted once lost, instead of adding a fifth element to a
  // four-item bar.
  const { gallop, lost } = useNavDogState(data);
  const blocked = data.agents.filter((a) => a.status === "blocked").length;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-border bg-chrome px-1 pb-[calc(env(safe-area-inset-bottom)+0.875rem)] lg:hidden">
      {NAV_ITEMS.map((item) => {
        const isActive = item.key === active;
        const isHerd = item.key === "herd";
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => navigate(item.path(data.session))}
            aria-current={isActive ? "page" : undefined}
            aria-label={
              isHerd && (gallop || lost)
                ? `${t(item.label)} — ${lost ? "not connected" : "reconnecting"}`
                : undefined
            }
            className="relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 pt-2"
          >
            {isActive && (
              <span className="absolute top-0 h-[2px] w-8 rounded-full bg-brand" aria-hidden />
            )}
            <span className="relative">
              {isHerd && gallop ? (
                <DogGallop running size="22px" />
              ) : (
                <item.icon
                  className={cn(
                    "size-[22px]",
                    isHerd && lost
                      ? "opacity-40 grayscale"
                      : isActive
                        ? "text-brand"
                        : "text-muted-foreground",
                  )}
                />
              )}
              {item.key === "herd" && blocked > 0 && (
                <span className="absolute -top-2 left-1/2 ml-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-blocked px-1 text-[10px] font-bold text-white">
                  {blocked}
                </span>
              )}
            </span>
            <span
              className={cn(
                "text-[11px]",
                isActive ? "font-semibold text-brand" : "font-medium text-muted-foreground",
              )}
            >
              {t(item.label)}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
