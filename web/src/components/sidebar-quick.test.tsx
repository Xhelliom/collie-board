import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";

import { QuickList } from "./sidebar-quick";
import { fixtureAgents } from "@/test/handlers";
import type { HomeData } from "@/lib/loaders";
import type { QuickAccess } from "@/lib/quick-access";

const data = { agents: fixtureAgents, session: undefined } as unknown as HomeData;
const q: QuickAccess = {
  projects: [
    { repoPath: "/code/live", lot: { id: "r1", name: "Auth", done: 1, total: 3, blocked: true, finished: false }, ts: 2 },
    { repoPath: "/code/over", lot: { id: "r2", name: null, done: 2, total: 2, blocked: false, finished: true }, ts: 1 },
  ],
  waiting: [{ cardId: "c1", title: "Pick a DB", repoPath: "/code/live", text: "Which DB?" }],
};

function renderList(quick: QuickAccess | null) {
  const router = createMemoryRouter([{ path: "*", element: <QuickList q={quick} data={data} /> }], { initialEntries: ["/settings"] });
  render(<RouterProvider router={router} />);
  return router;
}

describe("QuickList", () => {
  it("shows the projects with their lot, what waits for you, and opens a project on click", async () => {
    const router = renderList(q);
    expect(screen.getByText("1/3")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "A card is blocked" })).toBeInTheDocument();
    expect(screen.getByText("· finished")).toBeInTheDocument();
    expect(screen.getByText("Pick a DB")).toBeInTheDocument();
    expect(screen.getAllByText(/Agent blocked/).length).toBe(fixtureAgents.filter((a) => a.status === "blocked").length);
    await userEvent.click(screen.getByText("live"));
    expect(router.state.location.pathname + router.state.location.search).toBe("/board/project?repo=%2Fcode%2Flive");
  });

  it("leads with each live orchestrator, its dot when it waits on you, and opens its conversation", async () => {
    const orch = { ...fixtureAgents[0]!, paneId: "orch-1", workspaceLabel: "orchestrator-live", cwd: "/code/live", status: "idle" as const };
    const router = createMemoryRouter(
      [{ path: "*", element: <QuickList q={q} data={{ ...data, agents: [orch] } as HomeData} /> }],
      { initialEntries: ["/settings"] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByText("Orchestrators")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Waiting for you" })).toBeInTheDocument(); // the decision on /code/live
    await userEvent.click(screen.getAllByText("live")[0]!);
    expect(router.state.location.pathname).toBe("/pane/orch-1");
  });

  it("lists the pinned sessions under the orchestrators: live opens its pane, gone is greyed with its remove", async () => {
    const live = { ...fixtureAgents[0]!, paneId: "p-chat", paneLabel: "chat infra", agentSessionId: "s-live", status: "idle" as const };
    const pins = [{ session: "s-live", name: "old name" }, { session: "s-gone", name: "ancienne · perso" }];
    const router = createMemoryRouter(
      [{ path: "*", element: <QuickList q={null} data={{ ...data, agents: [live] } as HomeData} pins={pins} /> }],
      { initialEntries: ["/settings"] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByText("Pinned")).toBeInTheDocument();
    expect(screen.getByText("ancienne · perso")).toBeInTheDocument();
    expect(screen.getByText("session ended")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unpin" })).toBeInTheDocument();
    await userEvent.click(screen.getByText("chat infra"));
    expect(router.state.location.pathname).toBe("/pane/p-chat");
  });
});
