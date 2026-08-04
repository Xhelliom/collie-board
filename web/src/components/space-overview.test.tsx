import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SpaceOverview } from "./space-overview";
import type { TabView, WorkspaceView } from "@/lib/types";

function ws(workspaceId: string, label: string, tabCount: number, paneCount: number): WorkspaceView {
  return {
    workspaceId,
    number: 1,
    label,
    focused: false,
    activeTabId: `${workspaceId}:t1`,
    tabCount,
    paneCount,
  };
}

function tab(workspaceId: string, tabId: string, label: string): TabView {
  return { tabId, workspaceId, number: 1, label, focused: false, paneCount: 1 };
}

describe("SpaceOverview", () => {
  it("shows an empty state when there are no spaces", () => {
    render(
      <SpaceOverview
        workspaces={[]}
        tabs={[]}
        agents={[]}
        onOpen={vi.fn()}
        onSelectTab={vi.fn()}
        onNewTab={vi.fn()}
        onNewSpace={vi.fn()}
      />,
    );
    expect(screen.getByText(/no spaces yet/i)).toBeInTheDocument();
  });

  it("renders each space's tab and pane counts (pluralized)", () => {
    render(
      <SpaceOverview
        workspaces={[ws("w1", "anchorgenius", 2, 3), ws("w2", "tgl", 1, 1)]}
        tabs={[]}
        agents={[]}
        onOpen={vi.fn()}
        onSelectTab={vi.fn()}
        onNewTab={vi.fn()}
        onNewSpace={vi.fn()}
      />,
    );
    expect(screen.getByText("anchorgenius")).toBeInTheDocument();
    expect(screen.getByText("2 tabs · 3 panes")).toBeInTheDocument();
    expect(screen.getByText("1 tab · 1 pane")).toBeInTheDocument(); // singular
  });

  it("opens a space when its card header is tapped", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <SpaceOverview
        workspaces={[ws("w1", "anchorgenius", 2, 3)]}
        tabs={[]}
        agents={[]}
        onOpen={onOpen}
        onSelectTab={vi.fn()}
        onNewTab={vi.fn()}
        onNewSpace={vi.fn()}
      />,
    );
    // Not a loose /anchorgenius/ match: the card's own "New tab in anchorgenius" button also
    // contains that substring in its accessible name.
    await user.click(screen.getByRole("button", { name: /^anchorgenius/ }));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("w1");
  });

  it("goes straight to a tab when its chip is tapped, not the drill-in", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onSelectTab = vi.fn();
    render(
      <SpaceOverview
        workspaces={[ws("w1", "anchorgenius", 1, 1)]}
        tabs={[tab("w1", "w1:t1", "fix-diff")]}
        agents={[]}
        onOpen={onOpen}
        onSelectTab={onSelectTab}
        onNewTab={vi.fn()}
        onNewSpace={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "fix-diff" }));
    expect(onSelectTab).toHaveBeenCalledExactlyOnceWith("w1", "w1:t1");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("creates a new tab from the card's dashed +", async () => {
    const user = userEvent.setup();
    const onNewTab = vi.fn();
    render(
      <SpaceOverview
        workspaces={[ws("w1", "anchorgenius", 1, 1)]}
        tabs={[tab("w1", "w1:t1", "fix-diff")]}
        agents={[]}
        onOpen={vi.fn()}
        onSelectTab={vi.fn()}
        onNewTab={onNewTab}
        onNewSpace={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /new tab in anchorgenius/i }));
    expect(onNewTab).toHaveBeenCalledExactlyOnceWith("w1");
  });

  it("creates a new space from the header button", async () => {
    const user = userEvent.setup();
    const onNewSpace = vi.fn();
    render(
      <SpaceOverview
        workspaces={[]}
        tabs={[]}
        agents={[]}
        onOpen={vi.fn()}
        onSelectTab={vi.fn()}
        onNewTab={vi.fn()}
        onNewSpace={onNewSpace}
      />,
    );
    await user.click(screen.getByRole("button", { name: /new space/i }));
    expect(onNewSpace).toHaveBeenCalledOnce();
  });
});
