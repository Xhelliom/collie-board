import { render, screen, within } from "@testing-library/react";

import type { AgentView } from "@/lib/types";
import { AgentList } from "./agent-list";

// The redesigned triage: three different amounts of ink for three urgencies, not one card reused at
// three tints — see agent-card.tsx. This locks in which component each status group renders as.
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

describe("AgentList — triage grouping", () => {
  it("shows the empty placeholder when there are no agents", () => {
    render(<AgentList agents={[]} bridge="connected" onOpen={() => {}} />);
    expect(screen.getByText("No agents running.")).toBeInTheDocument();
  });

  it("groups a blocked agent under Needs you, as the loud (solid-chip) card", () => {
    render(
      <AgentList agents={[agent({ paneId: "p1", status: "blocked" })]} onOpen={() => {}} />,
    );
    expect(screen.getByText("Needs you")).toBeInTheDocument();
    // The loud chip's own label — STATUS_LABEL.blocked, capitalised by CSS not by the text node.
    expect(screen.getByText("needs you")).toBeInTheDocument();
  });

  it("groups a working agent under Working, as the medium card (name + ctx subline)", () => {
    render(
      <AgentList
        agents={[agent({ paneId: "p1", status: "working", ctxPct: 42 })]}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText(/ctx 42%/)).toBeInTheDocument();
  });

  it("groups an idle agent under Idle · done, as a bare row naming its status", () => {
    render(<AgentList agents={[agent({ paneId: "p1", status: "idle" })]} onOpen={() => {}} />);
    const section = screen.getByText("Idle · done").closest("section")!;
    expect(within(section).getByText("idle")).toBeInTheDocument();
  });

  // jsdom does no layout, so the overflow itself can't be asserted here — this locks in the class
  // that prevents it. Without `min-width:0` a grid item never shrinks below its min-content, and a
  // card of `truncate` text has a min-content as wide as the untruncated string: the card grew past
  // the viewport instead of ellipsising (measured in headless Chrome: 574px card in a 468px column).
  it("lets the card shrink below its text: the grid items are min-w-0", () => {
    render(
      <AgentList
        agents={[
          agent({ paneId: "p1", status: "blocked" }),
          agent({ paneId: "p2", status: "working" }),
        ]}
        onOpen={() => {}}
      />,
    );
    for (const label of ["Needs you", "Working"]) {
      const grid = screen.getByText(label).closest("section")!.querySelector("div.grid")!;
      expect(grid.className).toContain("[&>*]:min-w-0");
    }
  });

  it("counts each section correctly", () => {
    render(
      <AgentList
        agents={[
          agent({ paneId: "p1", status: "blocked" }),
          agent({ paneId: "p2", status: "working" }),
        ]}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText("Needs you").closest("h2")?.textContent).toMatch(/\(1\)/);
    expect(screen.getByText("Working").closest("h2")?.textContent).toMatch(/\(1\)/);
  });
});
