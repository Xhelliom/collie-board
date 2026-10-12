import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import type { AgentView } from "@/lib/types";
import { HomeRoute } from "./home";

const agent = (extra: Partial<AgentView>): AgentView => ({
  paneId: "w1:p1", workspaceId: "w1", workspaceLabel: "proj", workspaceNumber: 1, tabId: "w1:t1",
  agent: "claude", status: "working", cwd: "/home/repo", focused: false, kind: "agent", ...extra,
});
const data = {
  bridge: "connected", device: undefined, shellPanes: [], workspaces: [{}, {}], tabs: [], sessions: [],
  copilotPaneId: null, session: undefined, snoozedUntil: null, notifyCount: 0, error: false,
  agents: [agent({}), agent({ paneId: "w1:p2", status: "blocked" })],
} as unknown as HomeData;

function renderHome(agents = data.agents) {
  const router = createMemoryRouter(
    [{ id: ROOT_ROUTE_ID, path: "/", loader: () => ({ ...data, agents }), children: [{ index: true, loader: () => ({ cards: [] }), element: <HomeRoute /> }] }],
  );
  return render(<RouterProvider router={router} />);
}

describe("HomeRoute", () => {
  it("pins the content grid to one shrinkable column below lg, so a truncated line cannot widen the page", async () => {
    renderHome();
    const grid = (await screen.findByText("Working")).closest("section")!.parentElement!.parentElement!.parentElement!;
    expect(grid.className).toMatch(/\bgrid-cols-1\b/);
    expect(grid.className).toMatch(/\[&>\*\]:min-w-0/);
  });

  it("puts the agent triage before the card KPIs", async () => {
    renderHome();
    const triage = await screen.findByText("Needs you");
    const kpis = screen.getByText("Cards");
    expect(triage.compareDocumentPosition(kpis) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("counts spaces only in the subtitle, and says nothing twice for an empty herd", async () => {
    renderHome([]);
    expect(await screen.findByText("2 spaces")).toBeInTheDocument();
    expect(screen.queryByText("No agents running.")).not.toBeInTheDocument();
  });
});
