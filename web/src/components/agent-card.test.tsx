import { render, screen } from "@testing-library/react";

import type { AgentView } from "@/lib/types";
import { AgentCard, WorkingCard } from "./agent-card";

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

  it("shows the model beside ctx%, the effort only when known, and no model it was not given", () => {
    const { unmount } = render(<AgentCard agent={agent({ ctxPct: 55, model: "Opus 5.5", effort: "high" })} onClick={() => {}} />);
    expect(screen.getByText("· Opus 5.5 · high")).toBeInTheDocument();
    unmount();
    render(<AgentCard agent={agent({ ctxPct: 55, model: "Fable 5.2" })} onClick={() => {}} />);
    expect(screen.getByText("· Fable 5.2")).toBeInTheDocument();
    expect(screen.queryByText(/Opus|high/)).toBeNull();
  });
});

// How long a settled pane has been settled. Omitted when the bridge never witnessed the switch —
// a fabricated "just now" on a pane that finished hours ago is worse than no mention at all.
describe("idle/done age", () => {
  const fiveMinAgo = Date.now() - 5 * 60_000;

  it("shows it next to the state on a done card", () => {
    render(<AgentCard agent={agent({ status: "done", statusSince: fiveMinAgo })} onClick={() => {}} />);
    expect(screen.getByText("5m ago")).toBeInTheDocument();
  });

  it("omits it when the switch-over instant is unknown", () => {
    render(<AgentCard agent={agent({ status: "done" })} onClick={() => {}} />);
    expect(screen.queryByText(/ago/)).toBeNull();
  });

  it("omits it for a status the note says nothing about", () => {
    render(<AgentCard agent={agent({ status: "working", statusSince: fiveMinAgo })} onClick={() => {}} />);
    expect(screen.queryByText(/ago/)).toBeNull();
  });
});

// ADR 0052 §4.2: the bridge sets `engine` only while the herd mixes herdr 0.9 and hc.
describe("engine badge", () => {
  it("names the engine when the bridge says which", () => {
    render(<WorkingCard agent={agent({ paneId: "t3", engine: "hc" })} onClick={() => {}} />);
    expect(screen.getByText("hc")).toBeInTheDocument();
  });

  it("shows nothing for a single-engine herd", () => {
    render(<WorkingCard agent={agent()} onClick={() => {}} />);
    expect(screen.queryByText("0.9")).toBeNull();
    expect(screen.queryByText("hc")).toBeNull();
  });
});
