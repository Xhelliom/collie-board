import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import type { AgentView } from "@/lib/types";
import { AgentList, IdleAgents } from "./agent-list";

function agent(extra: Partial<AgentView> = {}): AgentView {
  return {
    paneId: "w1:p1",
    workspaceId: "w1",
    workspaceLabel: "proj",
    workspaceNumber: 1,
    tabId: "w1:t1",
    agent: "claude",
    status: "working",
    cwd: "/home/repo",
    focused: false,
    kind: "agent",
    ...extra,
  };
}
const list = (agents: AgentView[], extra: Partial<Parameters<typeof AgentList>[0]> = {}) => (
  <AgentList agents={agents} onOpen={() => {}} hasOrch={false} withOrch={false} onWithOrch={() => {}} {...extra} />
);

describe("AgentList", () => {
  it("lists who waits for you, then who works — one row each, with its project and machine", () => {
    render(list([agent({ paneId: "a", cardTitle: "Ship tabs", cwd: "/x/.herdr/worktrees/collie/b" }), agent({ paneId: "b", status: "blocked", paneLabel: "asks" })]));
    const needs = screen.getByRole("region", { name: "Waiting for you" });
    expect(within(needs).getByText("asks")).toBeInTheDocument();
    const work = screen.getByRole("region", { name: "Working" });
    const row = within(work).getByText("Ship tabs").closest("button")!;
    expect(row).toHaveTextContent("collie");
    expect(row).toHaveTextContent("This PC");
    // No meta line any more: no model, no ctx, no engine label.
    expect(row).not.toHaveTextContent(/ctx|Opus/);
  });

  it("draws no « waiting » section when nobody waits, and says so when nobody works", () => {
    render(list([]));
    expect(screen.queryByRole("region", { name: "Waiting for you" })).toBeNull();
    expect(screen.getByText("No agent is working.")).toBeInTheDocument();
  });

  it("offers the orchestrators filter only when the herd has one", async () => {
    const toggled: boolean[] = [];
    const { rerender } = render(list([agent()], { hasOrch: true, onWithOrch: (v) => toggled.push(v) }));
    await userEvent.click(screen.getByRole("button", { name: "With the orchestrators" }));
    expect(toggled).toEqual([true]);
    rerender(list([agent()]));
    expect(screen.queryByRole("button", { name: "With the orchestrators" })).toBeNull();
  });

  it("filters by machine once a peer has agents, and opens a remote agent by its routed id", async () => {
    const opened: string[] = [];
    render(list([agent({ paneId: "a", paneLabel: "here" }), agent({ paneId: "b@dev", peer: "dev", paneLabel: "there" })], { onOpen: (id) => opened.push(id) }));
    await userEvent.click(screen.getByText("there"));
    expect(opened).toEqual(["b@dev"]);
    await userEvent.click(screen.getByRole("button", { name: "dev" }));
    expect(screen.queryByText("here")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "This PC" }));
    expect(screen.getByText("here")).toBeInTheDocument();
    expect(screen.queryByText("there")).toBeNull();
  });

  it("pins a session from its row", async () => {
    let sent: unknown;
    server.use(http.post("/api/board/pins", async ({ request }) => ((sent = await request.json()), HttpResponse.json({ pins: [] }))));
    render(list([agent({ agentSessionId: "s1" })]));
    await userEvent.click(screen.getByRole("button", { name: "Pin to the sidebar" }));
    expect(sent).toMatchObject({ session: "s1", pinned: true });
  });
});

describe("IdleAgents", () => {
  it("folds the resting agents behind their count", async () => {
    render(<IdleAgents agents={[agent({ status: "idle", paneLabel: "rest1" }), agent({ paneId: "p2", status: "done", paneLabel: "rest2" }), agent({ paneId: "p3" })]} onOpen={() => {}} />);
    expect(screen.queryByText("rest1")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Agents at rest (2)" }));
    expect(screen.getByText("rest1")).toBeInTheDocument();
    expect(screen.getByText("rest2")).toBeInTheDocument();
  });

  it("renders nothing when every agent is busy", () => {
    const { container } = render(<IdleAgents agents={[agent()]} onOpen={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
