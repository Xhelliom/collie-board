import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { HistoryRoute } from "./history";
import { ROOT_ROUTE_ID, type HistoryData, type HomeData } from "@/lib/loaders";
import type { AgentView } from "@/lib/types";

const agent: AgentView = {
  paneId: "w1:p1",
  workspaceId: "w1",
  workspaceLabel: "collie-board",
  workspaceNumber: 1,
  tabId: "t1",
  agent: "claude",
  status: "idle",
  cwd: "/x",
  focused: false,
  cardId: "c1",
};

const root = {
  bridge: "connected",
  agents: [agent],
  shellPanes: [],
  workspaces: [],
  tabs: [],
  sessions: [],
  copilotPaneId: null,
  snoozedUntil: null,
  notifyCount: 0,
  error: false,
  authError: false,
} as unknown as HomeData;

const history: HistoryData = {
  paneId: "w1:p1",
  session: undefined,
  entries: [],
  hasMore: false,
  total: 0,
  fileTruncated: false,
};

Element.prototype.scrollTo = () => {}; // jsdom has none

function mount() {
  const router = createMemoryRouter(
    [
      {
        id: ROOT_ROUTE_ID,
        path: "/",
        loader: () => root,
        element: <Outlet />,
        children: [
          { path: "pane/:paneId", element: <div>PANE</div> },
          { path: "pane/:paneId/history", loader: () => history, element: <HistoryRoute /> },
          { path: "pane/:paneId/artifacts", element: <div>ARTIFACTS</div> },
        ],
      },
    ],
    { initialEntries: ["/pane/w1:p1/history"] },
  );
  render(<RouterProvider router={router} />);
}

describe("HistoryRoute header", () => {
  it("keeps three 44 px targets and folds the secondary icons into a menu", async () => {
    mount();
    for (const name of ["Find in history", "Close history", "More"]) {
      expect((await screen.findByRole("button", { name })).className).toMatch(/(^|\s)size-11(\s|$)/);
    }
    // Not in the header any more — only inside the menu.
    expect(screen.queryByRole("button", { name: "Session artifacts" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(await screen.findByRole("button", { name: "Session artifacts" }));
    expect(await screen.findByText("ARTIFACTS")).toBeTruthy();
  });
});
