import { Columns3, Dog, LayoutGrid, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLocation, useMatches, useNavigate, useSearchParams } from "react-router";

import { cn } from "@/lib/utils";
import { isConnecting } from "@/lib/connection";
import { useConnectionLost, useConnectionTrouble } from "@/hooks/use-connection-lost";
import { useLoadingStalled } from "@/hooks/use-loading-stalled";
import { DogGallop } from "@/components/dog-gallop";
import { SessionSwitcher } from "@/components/session-switcher";
import { BuildStamp } from "@/components/build-stamp";
import { homePath, spacesPath, settingsPath } from "@/lib/nav";
import { boardPath, repoName, reposOf, saveRepoScope } from "@/lib/board";
import type { BoardData } from "@/lib/board-loaders";
import type { HomeData } from "@/lib/loaders";

// The nav shell (redesign §Navigation). Mounted once in RootLayout, above the route tree, so it
// owns the two things that used to live in every AppHeader: the Collie mark's connection animation,
// and "where am I in the app". Below `lg` it renders as a bottom tab bar (mobile), shown ONLY on the
// four root screens (a card/pane/space-detail has a back chevron in its toolbar instead — a third
// bar under an open composer + keyboard is unusable). At `lg` and up it renders as a persistent
// 248px sidebar instead, on every screen (the pane screen shrinks it to a 64px icon rail — see
// agent-chat.tsx, Phase 7).
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
  label: string;
  icon: LucideIcon;
  path: (session: string | undefined) => string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { key: "herd", label: "Herd", icon: Dog, path: homePath },
  { key: "board", label: "Board", icon: Columns3, path: () => boardPath() },
  { key: "spaces", label: "Spaces", icon: LayoutGrid, path: spacesPath },
  { key: "settings", label: "Settings", icon: Settings, path: settingsPath },
];

/** The four root paths the tab bar / sidebar active-state matches against (session query ignored). */
function rootKeyFor(pathname: string): string | undefined {
  if (pathname === "/") return "herd";
  if (pathname === "/board") return "board";
  if (pathname === "/spaces") return "spaces";
  if (pathname === "/settings") return "settings";
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

function NavMark({ gallop, lost, size }: { gallop: boolean; lost: boolean; size: number }) {
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
  const { gallop, lost } = useNavDogState(data);
  const blocked = data.agents.filter((a) => a.status === "blocked").length;
  // The pane screen needs the width for the mirror — the sidebar compresses to a 64px icon rail
  // there, same rows and active state, just no labels and no screen-scoped list under them.
  const compact = location.pathname.startsWith("/pane/");

  return (
    <nav
      className={cn(
        "hidden flex-none flex-col border-r border-border bg-chrome lg:flex",
        compact ? "w-16 items-center p-2" : "w-[248px] p-4 px-3",
      )}
    >
      <button
        type="button"
        onClick={() => navigate(homePath(data.session))}
        className={cn(
          "mb-4 flex items-center gap-2.5 rounded-lg text-left",
          compact ? "justify-center p-1" : "px-1 py-1",
        )}
        aria-label={!gallop && !lost ? "Collie Board" : lost ? "Collie Board — not connected" : "Collie Board — reconnecting"}
      >
        <NavMark gallop={gallop} lost={lost} size={32} />
        {!compact && <span className="text-[15px] font-semibold tracking-[-0.02em]">Collie Board</span>}
      </button>

      <div className={cn("flex flex-col gap-0.5", compact && "items-center")}>
        {NAV_ITEMS.map((item) => {
          const isActive = item.key === active;
          const count = item.key === "herd" && blocked > 0 ? blocked : undefined;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate(item.path(data.session))}
              aria-current={isActive ? "page" : undefined}
              aria-label={compact ? item.label : undefined}
              title={compact ? item.label : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-[10px] text-sm transition-colors",
                compact ? "size-11 justify-center" : "px-2.5 py-2.5",
                isActive
                  ? "bg-brand/16 font-semibold text-brand"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <span className="relative">
                <item.icon className="size-[18px] shrink-0" />
                {compact && count !== undefined && (
                  <span className="absolute -right-1.5 -top-1.5 flex size-3.5 items-center justify-center rounded-full bg-status-blocked text-[9px] font-bold text-white">
                    {count}
                  </span>
                )}
              </span>
              {!compact && <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>}
              {!compact && count !== undefined && (
                <span className="text-xs tabular-nums">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {!compact && (
        <>
          {/* Screen-scoped list, below the nav rows — the sidebar's one nod to "where am I" beyond
              the four root destinations. Repos on /board today (replaces RepoFilter's old
              always-visible strip); nothing on every other screen. */}
          <BoardRepoList />

          <div className="mt-auto flex flex-col gap-2 pt-4">
            <SessionSwitcher sessions={data.sessions ?? []} current={data.session} />
            <BuildStamp className="text-[11px] font-mono text-muted-foreground/60" />
          </div>
        </>
      )}
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
  const location = useLocation();
  const matches = useMatches();
  const [params, setParams] = useSearchParams();
  if (location.pathname !== "/board") return null;

  const board = matches.find((m) => m.id === "board")?.data as BoardData | undefined;
  if (!board) return null;

  const activeRepo = params.get("repo");
  const reposInUse = reposOf(board.cards);
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
        Repos
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
        All
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

function MobileTabBar({ data }: { data: HomeData }) {
  const navigate = useNavigate();
  const location = useLocation();
  const active = rootKeyFor(location.pathname);
  // The Herd tab's own Dog glyph doubles as the connection mark (collie-home.tsx's job, moved here):
  // it gallops on sustained trouble and rests muted once lost, instead of adding a fifth element to a
  // four-item bar. Called unconditionally, ABOVE the early return below — this component stays
  // mounted across a root ↔ entered-screen navigation (AppNav renders it at a fixed position), so a
  // hook after a conditional return would violate the rules of hooks the moment `active` flips.
  const { gallop, lost } = useNavDogState(data);
  // Only on the four root screens — an entered screen (card, pane, space detail) gives its full
  // height to content and offers a back chevron in its toolbar instead.
  if (!active) return null;
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
                ? `${item.label} — ${lost ? "not connected" : "reconnecting"}`
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
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
