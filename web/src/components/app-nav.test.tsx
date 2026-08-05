import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";

import { AppNav } from "./app-nav";
import { CONNECTION_LOST_MS, TROUBLE_MS } from "@/hooks/use-connection-lost";
import { __resetConnectionHealth } from "@/lib/connection-health";
import { fixtureAgents, fixtureSessions } from "@/test/handlers";
import type { HomeData } from "@/lib/loaders";
import type { BoardData } from "@/lib/board-loaders";
import type { CardView } from "@/lib/board";

// AppNav uses useLoadingStalled (useNavigation/useRevalidator) and useNavigate/useLocation, so it
// needs a real data router — same pattern as agent-chat.test.tsx.
function baseData(overrides: Partial<HomeData> = {}): HomeData {
  return {
    bridge: "connected",
    device: undefined,
    agents: fixtureAgents,
    shellPanes: [],
    workspaces: [],
    tabs: [],
    sessions: fixtureSessions,
    session: undefined,
    snoozedUntil: null,
    update: undefined,
    error: false,
    authError: false,
    ...overrides,
  };
}

function renderAt(path: string, data: HomeData = baseData()) {
  const router = createMemoryRouter([{ path: "*", element: <AppNav data={data} /> }], {
    initialEntries: [path],
  });
  const result = render(<RouterProvider router={router} />);
  // Sidebar renders first in AppNav's JSX, then the (possibly null) mobile tab bar — a stable way to
  // scope a query to one or the other without relying on CSS, which jsdom doesn't apply.
  const navs = result.container.querySelectorAll("nav");
  return { router, sidebar: navs[0] as HTMLElement, tabBar: navs[1] as HTMLElement | undefined };
}

describe("AppNav — sidebar (desktop, always mounted)", () => {
  beforeEach(() => __resetConnectionHealth());

  it("marks the current root screen active and shows the Herd blocked badge", () => {
    const { sidebar } = renderAt("/board");
    const boardRow = within(sidebar).getByRole("button", { name: "Board" });
    expect(boardRow).toHaveAttribute("aria-current", "page");
    const herdRow = within(sidebar).getByRole("button", { name: /Herd/ });
    expect(within(herdRow).getByText("1")).toBeInTheDocument(); // one blocked agent
  });

  it("navigates on tap", async () => {
    const { sidebar, router } = renderAt("/");
    await userEvent.click(within(sidebar).getByRole("button", { name: "Board" }));
    expect(router.state.location.pathname).toBe("/board");
  });

  it("stays mounted on an entered screen (a card), where the tab bar does not", () => {
    const { sidebar, tabBar } = renderAt("/card/abc");
    expect(within(sidebar).getByRole("button", { name: "Board" })).toBeInTheDocument();
    expect(tabBar).toBeUndefined();
  });
});

describe("AppNav — mobile tab bar", () => {
  beforeEach(() => __resetConnectionHealth());

  it("renders only on the four root screens", () => {
    expect(renderAt("/board").tabBar).toBeDefined();
    expect(renderAt("/").tabBar).toBeDefined();
    expect(renderAt("/spaces").tabBar).toBeDefined();
    expect(renderAt("/settings").tabBar).toBeDefined();
    expect(renderAt("/card/abc").tabBar).toBeUndefined();
    expect(renderAt("/pane/w1%3Ap1").tabBar).toBeUndefined();
  });

  it("marks the current root screen active", () => {
    const { tabBar } = renderAt("/board");
    expect(within(tabBar!).getByRole("button", { name: "Board" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

// Mirrors the dog behaviour app-header.test.tsx used to cover before the mark moved into the nav.
describe("AppNav — the dog keys on trouble/lost, not the first not-live frame", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetConnectionHealth();
  });
  afterEach(() => vi.useRealTimers());

  it("stays static during a brief not-live spell, gallops at 4s, rests muted at 15s (sidebar mark)", () => {
    const { sidebar } = renderAt("/", baseData({ error: true }));
    expect(sidebar.querySelector(".dog-gallop")).toBeNull();

    act(() => vi.advanceTimersByTime(TROUBLE_MS));
    expect(sidebar.querySelector(".dog-gallop")).toHaveClass("dog-gallop--running");

    act(() => vi.advanceTimersByTime(CONNECTION_LOST_MS - TROUBLE_MS));
    expect(sidebar.querySelector(".dog-gallop")).toBeNull();
    const img = sidebar.querySelector('img[src="/favicon.svg"]');
    expect(img?.className ?? "").toMatch(/grayscale/);
  });

  it("the Herd tab icon gallops on trouble too (mobile)", () => {
    const { tabBar } = renderAt("/", baseData({ error: true }));
    act(() => vi.advanceTimersByTime(TROUBLE_MS));
    expect(tabBar!.querySelector(".dog-gallop")).toHaveClass("dog-gallop--running");
  });
});

function card(over: Partial<CardView> & { id: string; repoPath: string }): CardView {
  return {
    title: "x",
    spec: null,
    rawInput: null,
    acceptance: [],
    status: "backlog",
    baseRef: null,
    branch: null,
    workspaceId: null,
    agentKind: null,
    parentId: null,
    duplicateOf: null,
    dependsOn: null,
    origin: null,
    tag: null,
    position: 0,
    createdAt: 0,
    updatedAt: 0,
    session: null,
    runtime: null,
    sessionCount: 0,
    copilotBusy: false,
    wrapupPending: false,
    keepWorktree: false,
    ...over,
  };
}

// The board's repo scope, spatial in the sidebar (replaces RepoFilter's old strip on desktop — see
// app-nav.tsx's BoardRepoList). Reads the board loader's data via useMatches, so the router needs an
// actual nested "board" route (id required) whose loader resolves that data — no Outlet needed, a
// matched route's loader runs and shows up in useMatches regardless of whether anything renders it.
function renderBoard(boardData: BoardData, initialPath = "/board") {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <AppNav data={baseData()} />,
        children: [{ id: "board", path: "board", loader: () => boardData }],
      },
    ],
    { initialEntries: [initialPath] },
  );
  render(<RouterProvider router={router} />);
  return { router };
}

describe("AppNav — BoardRepoList (the sidebar's screen-scoped repo list)", () => {
  // BoardRepoList only ever renders inside the sidebar, so these text queries are unambiguous
  // against the whole document — no need to scope to one of the two <nav>s.
  const twoRepos: BoardData = {
    cards: [
      card({ id: "c1", repoPath: "/home/x/alpha" }),
      card({ id: "c2", repoPath: "/home/x/beta" }),
    ],
    error: false,
    authError: false,
  };

  it("lists the repos in use once the board route's data resolves", async () => {
    renderBoard(twoRepos);
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("renders nothing when not on /board", async () => {
    renderBoard(twoRepos, "/");
    // Give the loader every chance to resolve regardless — the section must stay absent either way.
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText("Repos")).toBeNull();
    expect(screen.queryByText("alpha")).toBeNull();
  });

  it("writes ?repo= when a repo is picked", async () => {
    const { router } = renderBoard(twoRepos);
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());
    await userEvent.click(screen.getByText("alpha"));
    expect(router.state.location.search).toContain("repo=");
  });
});
