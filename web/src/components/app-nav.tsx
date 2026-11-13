import { Bot, Dog, FolderKanban, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLocation, useNavigate } from "react-router";

import { cn } from "@/lib/utils";
import { useT, type MessageKey } from "@/i18n";
import { isConnecting } from "@/lib/connection";
import { useConnectionLost, useConnectionTrouble } from "@/hooks/use-connection-lost";
import { useLoadingStalled } from "@/hooks/use-loading-stalled";
import { DogGallop } from "@/components/dog-gallop";
import { SessionSwitcher } from "@/components/session-switcher";
import { homePath, spacesPath, settingsPath } from "@/lib/nav";
import { loadRepoScope, projectPath } from "@/lib/board";
import { loadLastProject } from "@/lib/quick-access";
import { SidebarSections } from "@/components/sidebar-quick";
import type { HomeData } from "@/lib/loaders";

// The nav shell (redesign §Navigation). Mounted once in RootLayout, above the route tree, so it
// owns the two things that used to live in every AppHeader: the Collie mark's connection animation,
// and "where am I in the app". Below `lg` it renders as a bottom tab bar (mobile), at `lg` and up as a
// persistent 248px sidebar — both on EVERY screen, entered ones (pane, space) included: the operator
// never loses the way out. An entered screen lifts its bottom-pinned chrome (the pane's composer) clear
// of the bar with ABOVE_TAB_BAR; the toasts (ui/sonner.tsx) float at the top, out of its way.
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

// One entry per destination, icons unchanged (operator 13/11): Home, Projects — the board is one of a
// project's views, not an entry of its own — Agents (every agent and terminal, by project, under hc
// as under herdr 0.9), Settings.
const NAV_ITEMS: readonly NavItem[] = [
  { key: "herd", label: "nav.home", icon: Dog, path: homePath },
  // The project last opened; the board's repo scope before any was.
  { key: "projects", label: "nav.projects", icon: FolderKanban, path: () => projectPath(loadLastProject() ?? loadRepoScope()) },
  { key: "agents", label: "nav.agents", icon: Bot, path: spacesPath },
  { key: "settings", label: "settings.title", icon: Settings, path: settingsPath },
];
/** Bottom padding that lifts an in-flow bottom edge (the pane's composer) clear of the mobile tab bar:
 *  its min-h-14 + 0.875rem + safe area, plus the 1px border. Nothing at `lg`, where the bar is hidden. */
export const ABOVE_TAB_BAR = "max-lg:pb-[calc(3.5rem+0.875rem+1px+env(safe-area-inset-bottom))]";
// Desktop puts Settings in the footer; the phone's bar has room for all four as equals.
const MAIN_NAV_ITEMS = NAV_ITEMS.filter((item) => item.key !== "settings");
const SETTINGS_ITEM = NAV_ITEMS.find((item) => item.key === "settings")!;

/** The root paths (and their detail views) the tab bar / sidebar active-state matches against (session query ignored). */
function rootKeyFor(pathname: string): string | undefined {
  if (pathname === "/") return "herd";
  // The board, its views and a card are a project's: Projects stays lit.
  if (pathname === "/board" || pathname.startsWith("/board/") || pathname.startsWith("/card/")) return "projects";
  if (pathname === "/spaces" || pathname.startsWith("/space/")) return "agents";
  if (pathname === "/settings") return "settings";
  // A pane is an agent of the herd: Home stays lit. Anything else (gallery…) lights nothing.
  if (pathname.startsWith("/pane/")) return "herd";
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
          // Home's count is an alert: the agents that need you.
          const alertCount = item.key === "herd" && blocked > 0 ? blocked : undefined;
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
              {alertCount !== undefined && <span className="text-xs tabular-nums text-status-blocked">{alertCount}</span>}
            </button>
          );
        })}
      </div>

      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        <SidebarSections data={data} />
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
      </div>
    </nav>
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
