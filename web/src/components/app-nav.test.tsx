import { act, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";

import { AppNav } from "./app-nav";
import { CONNECTION_LOST_MS, TROUBLE_MS } from "@/hooks/use-connection-lost";
import { __resetConnectionHealth } from "@/lib/connection-health";
import { fixtureAgents, fixtureSessions } from "@/test/handlers";
import type { HomeData } from "@/lib/loaders";

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
    copilotPaneId: null,
    session: undefined,
    snoozedUntil: null,
    notifyCount: 0,
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
  // Sidebar renders first in AppNav's JSX, then the mobile tab bar — a stable way to
  // scope a query to one or the other without relying on CSS, which jsdom doesn't apply.
  const navs = result.container.querySelectorAll("nav");
  return { router, sidebar: navs[0] as HTMLElement, tabBar: navs[1] as HTMLElement | undefined };
}

describe("AppNav — sidebar (desktop, always mounted)", () => {
  beforeEach(() => __resetConnectionHealth());

  it("marks the current root screen active and shows the Home blocked badge", () => {
    const { sidebar } = renderAt("/board");
    const boardRow = within(sidebar).getByRole("button", { name: "Projects" });
    expect(boardRow).toHaveAttribute("aria-current", "page");
    const herdRow = within(sidebar).getByRole("button", { name: /Home/ });
    expect(within(herdRow).getByText("1")).toBeInTheDocument(); // one blocked agent
  });

  it("navigates on tap", async () => {
    const { sidebar, router } = renderAt("/");
    await userEvent.click(within(sidebar).getByRole("button", { name: "Projects" }));
    expect(router.state.location.pathname).toBe("/board/project");
  });

  it("stays full on an entered screen: labels and Home lit on a pane, Agents on a space", () => {
    const pane = renderAt("/pane/w1%3Ap1");
    expect(within(pane.sidebar).getByText("Collie Board")).toBeInTheDocument();
    expect(within(pane.sidebar).getByRole("button", { name: /Home/ })).toHaveAttribute("aria-current", "page");
    pane.router.dispose();
    const space = renderAt("/space/w1");
    expect(within(space.sidebar).getByRole("button", { name: /Agents/ })).toHaveAttribute("aria-current", "page");
  });
});

describe("AppNav — mobile tab bar", () => {
  beforeEach(() => __resetConnectionHealth());

  it("keeps the tab bar on a card, Projects lit", () => {
    const { tabBar } = renderAt("/card/abc");
    expect(within(tabBar!).getByRole("button", { name: "Projects" })).toHaveAttribute("aria-current", "page");
  });

  it("renders on every screen, entered ones included", () => {
    for (const path of ["/board", "/", "/spaces", "/settings", "/pane/w1%3Ap1", "/space/w1", "/gallery"]) {
      expect(renderAt(path).tabBar).toBeDefined();
    }
  });

  it("lights Home on a pane, Agents on a space, nothing on a screen of its own", () => {
    expect(within(renderAt("/pane/w1%3Ap1").tabBar!).getByRole("button", { name: /Home/ })).toHaveAttribute("aria-current", "page");
    expect(within(renderAt("/space/w1").tabBar!).getByRole("button", { name: "Agents" })).toHaveAttribute("aria-current", "page");
    expect(within(renderAt("/gallery").tabBar!).queryByRole("button", { current: "page" })).toBeNull();
  });

  it("stays visible, with Projects lit, on the board's own Open PRs view", () => {
    const { tabBar, sidebar } = renderAt("/board/prs");
    expect(tabBar).toBeDefined();
    expect(within(tabBar!).getByRole("button", { name: "Projects" })).toHaveAttribute("aria-current", "page");
    expect(within(sidebar).getByRole("button", { name: "Projects" })).toHaveAttribute("aria-current", "page");
  });

  it("lights Projects on the project page, and the entry reopens the last project", async () => {
    localStorage.setItem("collie:last-project", "/code/x");
    const { tabBar, sidebar, router } = renderAt("/board/project");
    expect(within(tabBar!).getByRole("button", { name: "Projects" })).toHaveAttribute("aria-current", "page");
    expect(within(sidebar).getByRole("button", { name: "Projects" })).toHaveAttribute("aria-current", "page");
    await userEvent.click(within(sidebar).getByRole("button", { name: /Home/ }));
    await userEvent.click(within(sidebar).getByRole("button", { name: "Projects" }));
    expect(router.state.location.search).toBe("?repo=%2Fcode%2Fx");
    localStorage.removeItem("collie:last-project");
  });

  it("marks the current root screen active", () => {
    const { tabBar } = renderAt("/board");
    expect(within(tabBar!).getByRole("button", { name: "Projects" })).toHaveAttribute(
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

  it("the Home tab icon gallops on trouble too (mobile)", () => {
    const { tabBar } = renderAt("/", baseData({ error: true }));
    act(() => vi.advanceTimersByTime(TROUBLE_MS));
    expect(tabBar!.querySelector(".dog-gallop")).toHaveClass("dog-gallop--running");
  });
});

describe("AppNav — one entry per destination (operator 13/11)", () => {
  beforeEach(() => __resetConnectionHealth());

  it("has Home, Projects, Agents, Settings — no Board, Agents under hc too", () => {
    const hcOnly = baseData({ workspaces: [{ workspaceId: "hc", number: 1, label: "hc", focused: false, activeTabId: "hc", tabCount: 1, paneCount: 1 }] });
    const { tabBar, sidebar } = renderAt("/", hcOnly);
    const labels = within(tabBar!).getAllByRole("button").map((b) => b.textContent?.replace(/\d+/g, ""));
    expect(labels).toEqual(["Home", "Projects", "Agents", "Settings"]);
    expect(within(sidebar).queryByRole("button", { name: "Board" })).toBeNull();
    expect(within(sidebar).queryByText(/^v\d/)).toBeNull(); // the version lives in Settings
  });

  it("lists the running agents in the sidebar, the one that needs you first", () => {
    const { sidebar } = renderAt("/");
    expect(within(sidebar).getByText("Running")).toBeInTheDocument();
  });
});
