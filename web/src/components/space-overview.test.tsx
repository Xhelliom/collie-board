import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SpaceOverview } from "./space-overview";
import type { AgentView, TabView, WorkspaceView } from "@/lib/types";

function ws(
  workspaceId: string,
  label: string,
  extra: Partial<WorkspaceView> = {},
): WorkspaceView {
  return {
    workspaceId,
    number: 1,
    label,
    focused: false,
    activeTabId: `${workspaceId}:t1`,
    tabCount: 1,
    paneCount: 1,
    ...extra,
  };
}

function agent(partial: Partial<AgentView> & { paneId: string; workspaceId: string }): AgentView {
  return {
    workspaceLabel: "ws",
    workspaceNumber: 1,
    tabId: `${partial.workspaceId}:t1`,
    agent: "claude",
    status: "idle",
    cwd: "/home/you/demo",
    focused: false,
    ...partial,
  };
}

function tab(workspaceId: string, tabId: string, label: string): TabView {
  return { tabId, workspaceId, number: 1, label, focused: false, paneCount: 1 };
}

const props = {
  tabs: [] as TabView[],
  agents: [] as AgentView[],
  shellPanes: [] as AgentView[],
  onOpen: vi.fn(),
  onOpenPane: vi.fn(),
  onNewSpace: vi.fn(),
};

describe("SpaceOverview", () => {
  it("shows an empty state when there are no spaces", () => {
    render(<SpaceOverview {...props} workspaces={[]} />);
    expect(screen.getByText(/no spaces yet/i)).toBeInTheDocument();
  });

  it("lists a space even when no pane of it is in the snapshot", () => {
    render(<SpaceOverview {...props} workspaces={[ws("w1", "anchorgenius")]} />);
    expect(screen.getByRole("heading", { name: "anchorgenius" })).toBeInTheDocument();
  });

  it("shows a space's branch under its name, secondary — the path only when there is none", () => {
    render(
      <SpaceOverview
        {...props}
        workspaces={[ws("w1", "anchorgenius"), ws("w2", "tgl")]}
        agents={[
          agent({ paneId: "w1:p1", workspaceId: "w1", branch: "board/x", cwd: "/home/you/ag" }),
          agent({ paneId: "w2:p1", workspaceId: "w2", cwd: "/home/you/tgl" }),
        ]}
      />,
    );
    expect(screen.getByText("board/x")).toBeInTheDocument();
    expect(screen.getByText("~/tgl")).toBeInTheDocument();
  });

  it("hangs a worktree space under the repo space it was cut from", () => {
    const { container } = render(
      <SpaceOverview
        {...props}
        workspaces={[ws("w1", "collie-board"), ws("w2", "Refondre la page « spaces »")]}
        agents={[
          agent({ paneId: "w1:p1", workspaceId: "w1", cwd: "/home/you/git/collie-board" }),
          agent({
            paneId: "w2:p1",
            workspaceId: "w2",
            cwd: "/home/you/.herdr/worktrees/collie-board/board-refonte",
            branch: "board/refonte",
          }),
        ]}
      />,
    );
    // Two spaces, ONE top-level section: the worktree lives inside the repo's.
    const sections = container.querySelectorAll("section > div.relative > section");
    expect(sections).toHaveLength(1);
    expect(within(sections[0] as HTMLElement).getByRole("heading")).toHaveTextContent(
      "Refondre la page",
    );
  });

  it("leaves a worktree at the top level when its repo has no space open", () => {
    const { container } = render(
      <SpaceOverview
        {...props}
        workspaces={[ws("w2", "Refondre la page « spaces »")]}
        agents={[
          agent({
            paneId: "w2:p1",
            workspaceId: "w2",
            cwd: "/home/you/.herdr/worktrees/collie-board/board-refonte",
          }),
        ]}
      />,
    );
    expect(container.querySelectorAll("section > div.relative > section")).toHaveLength(0);
    expect(screen.getByRole("heading", { name: /Refondre la page/ })).toBeInTheDocument();
  });

  it("keeps each row's own status and the space's blocked count after the regrouping", () => {
    const { container } = render(
      <SpaceOverview
        {...props}
        workspaces={[ws("w1", "anchorgenius")]}
        agents={[
          agent({ paneId: "w1:p1", workspaceId: "w1", status: "blocked" }),
          agent({ paneId: "w1:p2", workspaceId: "w1", status: "working" }),
        ]}
      />,
    );
    expect(screen.getByText("needing you")).toBeInTheDocument();
    expect(container.getElementsByClassName("bg-status-blocked").length).toBeGreaterThan(0);
    expect(container.getElementsByClassName("bg-status-working").length).toBeGreaterThan(0);
  });

  it("marks the space herdr has focused, and only that one", () => {
    const { container } = render(
      <SpaceOverview
        {...props}
        workspaces={[ws("w1", "anchorgenius", { focused: true }), ws("w2", "tgl")]}
      />,
    );
    expect(container.getElementsByClassName("from-brand/70")).toHaveLength(1);
  });

  it("drills into a space when its header is tapped", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<SpaceOverview {...props} workspaces={[ws("w1", "anchorgenius")]} onOpen={onOpen} />);
    await user.click(screen.getByRole("button", { name: /^anchorgenius/ }));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("w1");
  });

  it("opens a pane when its row is tapped, not the drill-in", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onOpenPane = vi.fn();
    render(
      <SpaceOverview
        {...props}
        workspaces={[ws("w1", "anchorgenius")]}
        tabs={[tab("w1", "w1:t1", "code")]}
        agents={[agent({ paneId: "w1:p1", workspaceId: "w1" })]}
        onOpen={onOpen}
        onOpenPane={onOpenPane}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^claude,/ }));
    expect(onOpenPane).toHaveBeenCalledExactlyOnceWith("w1:p1");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("creates a new space from the header button", async () => {
    const user = userEvent.setup();
    const onNewSpace = vi.fn();
    render(<SpaceOverview {...props} workspaces={[]} onNewSpace={onNewSpace} />);
    await user.click(screen.getByRole("button", { name: /new space/i }));
    expect(onNewSpace).toHaveBeenCalledOnce();
  });
});
