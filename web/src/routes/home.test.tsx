import { http, HttpResponse } from "msw";
import { render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { server } from "@/test/setup";

import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import type { AgentView } from "@/lib/types";
import { __setPins } from "@/lib/pins";
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

function renderHome(agents = data.agents, cards: unknown[] = []) {
  const router = createMemoryRouter(
    [{ id: ROOT_ROUTE_ID, path: "/", loader: () => ({ ...data, agents }), children: [{ index: true, loader: () => ({ board: { cards } }), element: <HomeRoute /> }] }],
  );
  return render(<RouterProvider router={router} />);
}

describe("HomeRoute", () => {
  it("titles the screen with the herd's state, no « Herd » nor space count", async () => {
    renderHome();
    expect(await screen.findByRole("heading", { level: 1, name: "1 agent needs you, 1 agent is working" })).toBeInTheDocument();
    expect(screen.queryByText("2 spaces")).toBeNull();
    expect(screen.queryByText("Herd")).toBeNull();
  });

  it("pins the content grid to one shrinkable column below lg, so a truncated line cannot widen the page", async () => {
    renderHome();
    const grid = (await screen.findByRole("region", { name: "Working" })).parentElement!.parentElement!.parentElement!;
    expect(grid.className).toMatch(/\bgrid-cols-1\b/);
    expect(grid.className).toMatch(/\[&>\*\]:min-w-0/);
  });

  it("leaves the orchestrators out by default — but never one that waits for you — and remembers the choice", async () => {
    localStorage.removeItem("collie-home-with-orch");
    const orch = (id: string, status: AgentView["status"]) => agent({ paneId: id, status, workspaceLabel: "orchestrator-repo", paneLabel: `orch-${id}` });
    renderHome([agent({ paneLabel: "worker" }), orch("o1", "working"), orch("o2", "blocked")]);
    // An orchestrator is named by its role; which one shows is told by the section it sits in.
    expect(within(await screen.findByRole("region", { name: "Waiting for you" })).getByText("Orchestrator")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Working" })).queryByText("Orchestrator")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("1 agent needs you, 1 agent is working");
    await userEvent.click(screen.getByRole("button", { name: "With the orchestrators" }));
    expect(within(screen.getByRole("region", { name: "Working" })).getByText("Orchestrator")).toBeInTheDocument();
    expect(localStorage.getItem("collie-home-with-orch")).toBe("1");
    localStorage.removeItem("collie-home-with-orch");
  });
});

describe("HomeRoute pins", () => {
  afterEach(() => {
    __setPins([]);
    vi.unstubAllGlobals();
  });
  const pin = [{ repoPath: "/home/me/pinned-repo", name: "pinned-repo" }];

  it("shows the pins on the phone, after the herd, before the current projects", async () => {
    __setPins(pin);
    renderHome(data.agents, [{ id: "c1", title: "T", status: "review", repoPath: "/home/me/repo", updatedAt: Date.now() }]);
    const pinned = await screen.findByRole("button", { name: /pinned-repo/ });
    const working = screen.getByRole("region", { name: "Working" });
    const project = await screen.findByRole("link", { name: /^repo/ });
    expect(working.compareDocumentPosition(pinned) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pinned.compareDocumentPosition(project) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("dresses the three kinds of pin as panels on the phone, a working agent not doubled", async () => {
    __setPins([
      { repoPath: "/home/me/pinned-repo", name: "pinned-repo" },
      { cardId: "c9", name: "Pinned card", status: "review" },
      { session: "s-idle", name: "idle one" },
      { session: "s-work", name: "worker one" },
    ]);
    const idle = agent({ paneId: "w1:p3", status: "idle", agentSessionId: "s-idle", paneLabel: "restful" });
    const work = agent({ paneId: "w1:p4", status: "working", agentSessionId: "s-work", paneLabel: "busy-bee" });
    renderHome([...data.agents, idle, work], [{ id: "c1", title: "Step", status: "working", repoPath: "/home/me/pinned-repo", updatedAt: Date.now() }]);
    const section = await screen.findByRole("region", { name: "Pinned" });
    expect(within(section).getByRole("heading", { level: 2, name: "Pinned" })).toBeInTheDocument();
    const rows = within(section).getAllByRole("button");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("pinned-repo");
    expect(rows[1]).toHaveTextContent("Pinned card");
    expect(rows[1]).toHaveTextContent(/review/i);
    expect(rows[2]).toHaveTextContent("restful");
    expect(rows[2]).toHaveTextContent(/this PC/i);
    expect(within(section).queryByText("busy-bee")).toBeNull();
  });

  it("shows nothing when nothing is pinned", async () => {
    renderHome();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText("Pinned")).toBeNull();
  });

  it("does not double the sidebar on a wide screen", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
    __setPins(pin);
    renderHome();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: /pinned-repo/ })).toBeNull();
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
    expect(await screen.findByText("Waiting for you")).toBeInTheDocument();
    expect(screen.getByTestId("kpis-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("projects-skeleton")).toBeInTheDocument();
    release();
    expect(await screen.findByRole("link", { name: /repo/ })).toBeInTheDocument();
    expect(screen.queryByTestId("kpis-skeleton")).not.toBeInTheDocument();
    expect(screen.queryByTestId("projects-skeleton")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "1 card to review" })).toBeInTheDocument();
  });

  it("reads every repo's phases in one request (audit perf #11)", async () => {
    const urls: string[] = [];
    await coldHome(async () => HttpResponse.json({ cards: [card, { ...card, id: "c2", repoPath: "/home/me/other" }] }));
    server.use(http.get("/api/phases", ({ request }) => (urls.push(request.url), HttpResponse.json({ phases: [] }))));
    expect(await screen.findByText("other")).toBeInTheDocument();
    await waitFor(() => expect(urls).toHaveLength(1));
    expect(new URL(urls[0]).searchParams.has("repo")).toBe(false);
  });

  it("shows each project's « to test » count, from one recette request for every repo", async () => {
    const urls: string[] = [];
    server.use(http.get("/api/recette", ({ request }) => (urls.push(request.url), HttpResponse.json({ groups: [{ usage: null, entries: [
      { repoPath: "/home/me/repo", state: "todo" }, { repoPath: "/home/me/repo", state: "todo" }, { repoPath: "/home/me/repo", state: "ok" },
    ] }] }))));
    await coldHome(async () => HttpResponse.json({ cards: [card, { ...card, id: "c2", repoPath: "/home/me/other" }] }));
    expect(await screen.findByText("2 to test")).toBeInTheDocument();
    expect(urls).toHaveLength(1);
    expect(new URL(urls[0]).searchParams.has("repo")).toBe(false);
  });

  it("keeps a cards failure in the card blocks, the triage untouched", async () => {
    await coldHome(async () => HttpResponse.json({ error: "boom" }, { status: 500 }));
    await waitFor(() => expect(screen.getAllByText("Cards unavailable.")).toHaveLength(2));
    expect(screen.getByText("Waiting for you")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Working" })).toBeInTheDocument();
  });
});
