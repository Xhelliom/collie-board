import { http, HttpResponse } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";

import { server } from "@/test/setup";

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
    [{ id: ROOT_ROUTE_ID, path: "/", loader: () => ({ ...data, agents }), children: [{ index: true, loader: () => ({ board: { cards: [] } }), element: <HomeRoute /> }] }],
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

// Cold start (audit perf #3): the triage must not wait for /api/cards. The real loader, held by MSW.
describe("HomeRoute cold start", () => {
  async function coldHome(cards: () => Promise<Response>) {
    server.use(
      http.get("/api/cards", cards),
      http.get("/api/phases", () => HttpResponse.json({ phases: [] })),
    );
    vi.resetModules(); // the loader's last-good list is module state: a fresh one is a cold start
    const { homeLoader } = await import("@/lib/board-loaders");
    const router = createMemoryRouter([
      { id: ROOT_ROUTE_ID, path: "/", loader: () => data, children: [{ index: true, loader: homeLoader, element: <HomeRoute /> }] },
    ]);
    return render(<RouterProvider router={router} />);
  }
  const card = { id: "c1", title: "T", status: "review", repoPath: "/home/me/repo", updatedAt: Date.now() };

  it("renders the triage before the cards answer, then swaps the skeletons for the data", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await coldHome(async () => {
      await gate;
      return HttpResponse.json({ cards: [card] });
    });
    expect(await screen.findByText("Needs you")).toBeInTheDocument();
    expect(screen.getByTestId("kpis-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("projects-skeleton")).toBeInTheDocument();
    release();
    expect(await screen.findByText("repo")).toBeInTheDocument();
    expect(screen.queryByTestId("kpis-skeleton")).not.toBeInTheDocument();
    expect(screen.queryByTestId("projects-skeleton")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /to review/i })).toBeInTheDocument();
  });

  it("reads every repo's phases in one request (audit perf #11)", async () => {
    const urls: string[] = [];
    await coldHome(async () => HttpResponse.json({ cards: [card, { ...card, id: "c2", repoPath: "/home/me/other" }] }));
    server.use(http.get("/api/phases", ({ request }) => (urls.push(request.url), HttpResponse.json({ phases: [] }))));
    expect(await screen.findByText("other")).toBeInTheDocument();
    await waitFor(() => expect(urls).toHaveLength(1));
    expect(new URL(urls[0]).searchParams.has("repo")).toBe(false);
  });

  it("keeps a cards failure in the card blocks, the triage untouched", async () => {
    await coldHome(async () => HttpResponse.json({ error: "boom" }, { status: 500 }));
    await waitFor(() => expect(screen.getAllByText("Cards unavailable.")).toHaveLength(2));
    expect(screen.getByText("Needs you")).toBeInTheDocument();
    expect(screen.getByText("Working")).toBeInTheDocument();
  });
});
