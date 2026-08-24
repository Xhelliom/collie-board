import { render, screen } from "@testing-library/react";

import type { AgentView } from "@/lib/types";
import { AgentCard, IdleDoneRow } from "./agent-card";

// Focused on the two board-card fields G1/G2 added (branch, ctx%) — everything else about this row
// is exercised indirectly through the routes that render it.
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

describe("AgentCard", () => {
  it("shows neither branch nor ctx% for a pane with no open card session", () => {
    render(<AgentCard agent={agent()} onClick={() => {}} />);
    expect(screen.queryByText(/ctx \d+%/)).toBeNull();
    expect(screen.queryByText("board/x")).toBeNull();
  });

  it("shows branch and ctx% for a pane backing an open card session", () => {
    render(<AgentCard agent={agent({ branch: "board/x", ctxPct: 55 })} onClick={() => {}} />);
    expect(screen.getByText("board/x")).toBeInTheDocument();
    expect(screen.getByText("· ctx 55%")).toBeInTheDocument();
  });
});

// How long a settled pane has been settled. Omitted when the bridge never witnessed the switch —
// a fabricated "just now" on a pane that finished hours ago is worse than no mention at all.
describe("idle/done age", () => {
  const fiveMinAgo = Date.now() - 5 * 60_000;

  it("shows it next to the state on an idle row and a done card", () => {
    const { unmount } = render(
      <IdleDoneRow agent={agent({ status: "idle", statusSince: fiveMinAgo })} onClick={() => {}} />,
    );
    expect(screen.getByText(/idle · 5m ago/)).toBeInTheDocument();
    unmount();

    render(<AgentCard agent={agent({ status: "done", statusSince: fiveMinAgo })} onClick={() => {}} />);
    expect(screen.getByText("5m ago")).toBeInTheDocument();
  });

  it("omits it when the switch-over instant is unknown", () => {
    render(<IdleDoneRow agent={agent({ status: "done" })} onClick={() => {}} />);
    expect(screen.queryByText(/ago/)).toBeNull();
  });

  it("omits it for a status the note says nothing about", () => {
    render(<AgentCard agent={agent({ status: "working", statusSince: fiveMinAgo })} onClick={() => {}} />);
    expect(screen.queryByText(/ago/)).toBeNull();
  });
});
