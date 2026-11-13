import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";

import { PinnedList, RunningList, runningAgents } from "./sidebar-quick";
import { fixtureAgents } from "@/test/handlers";
import type { HomeData } from "@/lib/loaders";
import type { Pin } from "@/lib/pins";
import type { QuickAccess } from "@/lib/quick-access";
import type { AgentView } from "@/lib/types";

const base = fixtureAgents[0]!;
const ag = (o: Partial<AgentView>): AgentView => ({ ...base, ...o });
const q: QuickAccess = { projects: [], waiting: [{ cardId: "c-wait", title: "Pick a DB", repoPath: "/code/live", text: "?" }] };

function renderBoth(agents: AgentView[], pins: Pin[]) {
  const data = { agents, session: undefined } as unknown as HomeData;
  const router = createMemoryRouter(
    [{ path: "*", element: <><PinnedList pins={pins} data={data} q={q} /><RunningList data={data} /></> }],
    { initialEntries: ["/settings"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => localStorage.clear());

describe("the sidebar sections", () => {
  it("lists running agents, those that need you first, and leaves idle ones out", () => {
    const agents = [ag({ paneId: "a", status: "working" }), ag({ paneId: "b", status: "idle" }), ag({ paneId: "c", status: "blocked" })];
    expect(runningAgents(agents).map((a) => a.paneId)).toEqual(["c", "a"]);
  });

  it("shows nothing at all with no pin and nothing running", () => {
    renderBoth([ag({ status: "idle" })], []);
    expect(screen.queryByText("Pinned")).toBeNull();
    expect(screen.queryByText("Running")).toBeNull();
  });

  it("orders pins projects, cards, agents, each with its kind chip, Pinned above Running", async () => {
    const orch = ag({ paneId: "orch", workspaceLabel: "orchestrator-live", cwd: "/code/live", status: "idle" });
    const idle = ag({ paneId: "p-idle", paneLabel: "chat infra", agentSessionId: "s-idle", status: "idle" });
    const busy = ag({ paneId: "p-busy", paneLabel: "busy one", agentSessionId: "s-busy", status: "working" });
    const router = renderBoth(
      [orch, idle, busy],
      [
        { session: "s-idle", name: "x" },
        { session: "s-busy", name: "y" },
        { cardId: "c1", name: "Coût sous contrôle", status: "working" },
        { repoPath: "/code/live", name: "live" },
      ],
    );
    const order = ["live", "Coût sous contrôle", "chat infra"].map((n) => screen.getByText(n));
    order.slice(1).forEach((el, i) => expect(order[i]!.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy());
    expect(screen.getByText("project")).toBeInTheDocument();
    expect(screen.getByText("card")).toBeInTheDocument();
    expect(screen.getByText("1 for you")).toBeInTheDocument(); // the decision waiting on /code/live
    // Pinned and running: listed once, under Running.
    expect(screen.getAllByText("busy one")).toHaveLength(1);
    expect(screen.getByText("Pinned").compareDocumentPosition(screen.getByText("Running")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(screen.getByText("Coût sous contrôle"));
    expect(router.state.location.pathname).toBe("/card/c1");
  });

  it("greys a pin whose target is gone, with its remove", () => {
    renderBoth([], [{ session: "s-gone", name: "ancienne" }, { cardId: "c-gone", name: "old card", status: null }]);
    expect(screen.getAllByText("gone")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Unpin" })).toHaveLength(2);
  });

  it("folds a section to its title, count and needs-you dot, and remembers it", async () => {
    const agents = [ag({ paneId: "a", status: "working" }), ag({ paneId: "c", status: "blocked" })];
    renderBoth(agents, []);
    await userEvent.click(screen.getByRole("button", { name: /Running/ }));
    expect(screen.getByRole("button", { name: /Running/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Something waits for you here" })).toBeInTheDocument();
    expect(localStorage.getItem("collie:nav-collapsed:running")).toBe("1");
  });
});
