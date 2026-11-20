import { fireEvent, render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { createMemoryRouter, RouterProvider } from "react-router";

import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { SpaceRoute } from "./space";
import { SpacesRoute } from "./spaces";

const ws = (id: string, label: string) => ({
  workspaceId: id, label, number: 1, focused: false, tabCount: 2, paneCount: 3,
});
const data = {
  bridge: "connected", device: undefined, shellPanes: [], tabs: [], sessions: [], leadPaneId: "p-lead",
  agents: [
    { paneId: "p1", workspaceId: "w1", workspaceLabel: "orchestrator-xyz", workspaceNumber: 1, tabId: "t", agent: "claude", status: "blocked", cwd: "/r/proj-alpha", focused: false, cardTitle: "Fix the login" },
    { paneId: "p-lead", workspaceId: "w2", workspaceLabel: "board", workspaceNumber: 2, tabId: "t", agent: "claude", status: "working", cwd: "/r/collie", focused: false },
  ],
  session: undefined, error: false, workspaces: [ws("w1", "proj-alpha"), ws("w2", "proj-beta")],
} as unknown as HomeData;

function renderAt(path: string) {
  const router = createMemoryRouter(
    [{ id: ROOT_ROUTE_ID, path: "/", loader: () => data, children: [
      { path: "spaces", element: <SpacesRoute /> },
      { path: "space/:spaceId", element: <SpaceRoute /> },
    ] }],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

describe("Spaces screens (390 px, one title, one count)", () => {
  it("Agents: one title, groups by project not by space, the board's own panes left out", async () => {
    renderAt("/spaces");
    await screen.findByText("proj-alpha");
    expect(screen.getByRole("heading", { level: 1, name: "Agents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New agent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Fix the login, card, waiting for you/ })).toBeInTheDocument();
    expect(screen.queryByText("orchestrator-xyz")).toBeNull();
    expect(screen.queryByText("collie")).toBeNull();
  });

  it("Agents → More → Board agents: lead and copilot with their state, restart after a second tap", async () => {
    let restarted: unknown = null;
    server.use(http.post("/api/board/agents/restart", async ({ request }) => {
      restarted = await request.json();
      return HttpResponse.json({ ok: true });
    }));
    renderAt("/spaces");
    fireEvent.click(await screen.findByRole("button", { name: "More" }));
    const lead = await screen.findByRole("region", { name: "Lead" });
    expect(within(lead).getByText(/^working/)).toBeInTheDocument();
    expect(within(lead).getByRole("button", { name: "Open" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Copilot" })).getByText(/not running/)).toBeInTheDocument();
    fireEvent.click(within(lead).getByRole("button", { name: "Restart" }));
    expect(restarted).toBeNull();
    fireEvent.click(within(lead).getByRole("button", { name: /cuts its review/ }));
    await vi.waitFor(() => expect(restarted).toEqual({ role: "lead" }));
  });

  it("a space shows its name once visibly: the header's, the h1 is screen-reader only", async () => {
    renderAt("/space/w1");
    const h1 = await screen.findByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("proj-alpha");
    expect(h1.className).toMatch(/\bsr-only\b/);
  });

});
