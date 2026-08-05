import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PaneMenu } from "./pane-menu";
import type { AgentView } from "@/lib/types";

function pane(paneId: string, over: Partial<AgentView> = {}): AgentView {
  return {
    paneId,
    workspaceId: "wS",
    workspaceLabel: "collie-board",
    workspaceNumber: 2,
    tabId: "wS:t1",
    agent: "claude",
    status: "idle",
    cwd: "/repo",
    focused: false,
    kind: "agent",
    ...over,
  } as AgentView;
}

describe("PaneMenu", () => {
  it("switches to another pane of the space", async () => {
    const onSelect = vi.fn();
    render(
      <PaneMenu
        panes={[pane("wS:p1"), pane("wS:p2"), pane("wS:p3", { kind: "shell", agent: "shell" })]}
        currentPaneId="wS:p1"
        onSelect={onSelect}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /pane p1/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /p2/ }));

    expect(onSelect).toHaveBeenCalledWith("wS:p2");
    // The menu closes on pick.
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does not re-navigate to the pane already open", async () => {
    const onSelect = vi.fn();
    render(<PaneMenu panes={[pane("wS:p1"), pane("wS:p2")]} currentPaneId="wS:p1" onSelect={onSelect} />);

    await userEvent.click(screen.getByRole("button", { name: /pane p1/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /p1/ }));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders a plain chip when the space has a single pane", () => {
    render(<PaneMenu panes={[pane("wS:p1")]} currentPaneId="wS:p1" onSelect={vi.fn()} />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("p1")).toBeInTheDocument();
  });
});
