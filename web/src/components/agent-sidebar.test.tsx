import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

import type { AgentView } from "@/lib/types";
import { ThreadSidebar } from "./agent-sidebar";

const pane = (paneId: string, extra: Partial<AgentView> = {}): AgentView => ({
  paneId, workspaceId: "w1", workspaceLabel: "orchestrator-x", workspaceNumber: 1, tabId: "w1:t1", agent: "claude", status: "working", cwd: "/home/you/collie", focused: false, kind: "agent", ...extra,
});

const herd = [
  pane("p1", { cardId: "c1", cardTitle: "Fix login" }),
  pane("p2", { cwd: "/home/you/webapp", status: "blocked", said: "Je lis le code." }),
  pane("lead", { cardTitle: "Board lead" }),
  pane("sh", { kind: "shell", agent: "shell", status: "unknown" }),
];

function list(onSelect: (id: string) => void = () => {}) {
  render(
    <MemoryRouter>
      <ThreadSidebar herd={herd} internal={new Set(["lead"])} currentPaneId="p1" onSelect={onSelect} />
    </MemoryRouter>,
  );
}

describe("ThreadSidebar — the Agents page's list, compact", () => {
  it("groups by project, never by herdr space", () => {
    list();
    expect(screen.getByRole("region", { name: "collie" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "webapp" })).toBeInTheDocument();
    expect(screen.queryByText("orchestrator-x")).toBeNull();
  });

  it("highlights the open agent, hides the board's own panes and the terminals", () => {
    list();
    expect(screen.getByRole("button", { name: /Fix login/ })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByText("Board lead")).toBeNull();
    expect(screen.queryByRole("button", { name: /terminal/i })).toBeNull();
  });

  it("folds its filters behind one icon, and switches pane on a tap", async () => {
    const opened: string[] = [];
    list((id) => opened.push(id));
    expect(screen.queryByRole("group", { name: "Filters" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(screen.getByRole("group", { name: "Filters" })).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("region", { name: "webapp" })).getByRole("button"));
    expect(opened).toEqual(["p2"]);
  });
});
