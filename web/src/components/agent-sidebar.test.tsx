import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ThreadSidebar } from "./agent-sidebar";
import { fixtureAgents, fixtureShellPanes, fixtureTabs } from "@/test/handlers";
import type { AgentView } from "@/lib/types";

const idleAgent: AgentView = {
  paneId: "w3:p1",
  workspaceId: "w3",
  workspaceLabel: "sandbox",
  workspaceNumber: 3,
  tabId: "w3:t1",
  agent: "claude",
  status: "idle",
  cwd: "/home/you/sandbox",
  focused: false,
};

describe("ThreadSidebar", () => {
  it("renders an empty state when there are no agents", () => {
    render(<ThreadSidebar agents={[]} currentPaneId="" onSelect={vi.fn()} />);
    expect(screen.getByText("No agents running.")).toBeInTheDocument();
  });

  it("heads one group per space, not one per triage bucket", () => {
    render(
      <ThreadSidebar agents={[...fixtureAgents, idleAgent]} currentPaneId="" onSelect={vi.fn()} />,
    );
    for (const space of ["webapp", "collie", "sandbox"]) {
      expect(screen.getByRole("heading", { name: space })).toBeInTheDocument();
    }
    expect(screen.queryByText("Needs you")).toBeNull();
  });

  it("puts the space with a blocked agent first", () => {
    // idle "sandbox" is listed before blocked "webapp" — the grouping has to reorder them.
    const { container } = render(
      <ThreadSidebar agents={[idleAgent, ...fixtureAgents]} currentPaneId="" onSelect={vi.fn()} />,
    );
    const headings = [...container.querySelectorAll("h3")].map((h) => h.textContent);
    expect(headings).toEqual(["webapp", "collie", "sandbox"]);
  });

  it("shows the space's branch under its name when a pane in it backs a card", () => {
    render(
      <ThreadSidebar
        agents={[{ ...idleAgent, branch: "board/regrouper-les-spaces" }]}
        currentPaneId=""
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("board/regrouper-les-spaces")).toBeInTheDocument();
  });

  it("falls back to the space's path when no branch is known — never a made-up ref", () => {
    render(<ThreadSidebar agents={[idleAgent]} currentPaneId="" onSelect={vi.fn()} />);
    expect(screen.getByText("~/sandbox")).toBeInTheDocument();
  });

  it("counts the space's blocked agents in its header", () => {
    render(<ThreadSidebar agents={fixtureAgents} currentPaneId="" onSelect={vi.fn()} />);
    // "webapp" holds the one blocked agent; "collie" holds a working one and shows a plain count.
    expect(screen.getByText("needing you")).toBeInTheDocument();
  });

  it("marks the current pane with aria-current='page'", () => {
    render(<ThreadSidebar agents={fixtureAgents} currentPaneId="w2:p1" onSelect={vi.fn()} />);
    const current = screen.getByRole("button", { current: "page" });
    // w2:p1 is the codex agent in the "collie" workspace.
    expect(current).toHaveTextContent("codex");
  });

  it("does not mark any pane current when the id matches nothing", () => {
    render(<ThreadSidebar agents={fixtureAgents} currentPaneId="nope" onSelect={vi.fn()} />);
    expect(screen.queryByRole("button", { current: "page" })).toBeNull();
  });

  it("tints the rail of the space holding the open pane, and only that one", () => {
    const { container } = render(
      <ThreadSidebar agents={fixtureAgents} currentPaneId="w2:p1" onSelect={vi.fn()} />,
    );
    expect(container.getElementsByClassName("from-brand/70")).toHaveLength(1);
  });

  it("fires onSelect with the pane id when a thread is tapped", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ThreadSidebar agents={fixtureAgents} currentPaneId="w2:p1" onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: /claude/ }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("w1:p1");
  });

  const shellPane: AgentView = {
    paneId: "w3:p2",
    workspaceId: "w3",
    workspaceLabel: "sandbox",
    workspaceNumber: 3,
    tabId: "w3:t2",
    agent: "shell",
    status: "unknown",
    cwd: "/home/you/sandbox",
    focused: false,
    kind: "shell",
  };

  it("files a bare shell under its own space and makes it selectable", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ThreadSidebar
        agents={fixtureAgents}
        shellPanes={[shellPane]}
        currentPaneId=""
        onSelect={onSelect}
      />,
    );
    expect(screen.getByRole("heading", { name: "sandbox" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /shell/ }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("w3:p2");
  });

  it("still renders shells when there are no agents (fresh space reachable)", () => {
    render(<ThreadSidebar agents={[]} shellPanes={[shellPane]} currentPaneId="" onSelect={vi.fn()} />);
    expect(screen.queryByText("No agents running.")).toBeNull();
    expect(screen.getByRole("heading", { name: "sandbox" })).toBeInTheDocument();
  });

  it("is switch-only — no close control on any row", () => {
    render(<ThreadSidebar agents={[fixtureAgents[0]!]} currentPaneId="" onSelect={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
  });

  it("shows the context percentage only for panes that have one", () => {
    render(
      <ThreadSidebar
        agents={[{ ...idleAgent, ctxPct: 42.4 }]}
        shellPanes={[shellPane]}
        currentPaneId=""
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("ctx 42%")).toBeInTheDocument();
    // The shell pane has no ctxPct — it gets no gauge rather than a made-up 0%.
    expect(screen.getByRole("button", { name: /shell/ })).not.toHaveTextContent(/ctx/);
  });

  it("names a row's tab only when its space actually spreads over several", () => {
    const props = { tabs: fixtureTabs, currentPaneId: "", onSelect: vi.fn() };
    // "collie" holds w2:p1 (tab "code") and the shell w2:p2 (tab "shell") — the tab tells them apart.
    const two = render(<ThreadSidebar agents={fixtureAgents} shellPanes={fixtureShellPanes} {...props} />);
    expect(screen.getByText("code")).toBeInTheDocument();
    two.unmount();
    // Alone in its space, the pane's tab is the only tab there — herdr's "1" would be pure noise.
    render(<ThreadSidebar agents={[fixtureAgents[1]!]} {...props} />);
    expect(screen.queryByText("code")).toBeNull();
  });

  it("keeps every row's own status readable after the regrouping", () => {
    const { container } = render(
      <ThreadSidebar
        agents={[...fixtureAgents, idleAgent]}
        shellPanes={[shellPane]}
        currentPaneId=""
        onSelect={vi.fn()}
      />,
    );
    // One dot per row (plus the per-space summary), from the same palette the badges use.
    for (const cls of ["bg-status-blocked", "bg-status-working", "bg-status-idle", "bg-status-unknown"]) {
      expect(container.getElementsByClassName(cls).length).toBeGreaterThan(0);
    }
    // …and it reaches a screen reader through the row's name, not through colour alone.
    expect(screen.getByRole("button", { name: "claude, needs you" })).toBeInTheDocument();
  });
});
