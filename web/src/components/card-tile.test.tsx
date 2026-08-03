import { render, screen } from "@testing-library/react";

import type { CardRuntime, CardView } from "@/lib/board";
import { CardTile } from "./card-tile";

// Focused on what G2 added: cwd on the meta row, and the pane name paired with the card title —
// both only ever appear once a live pane backs the card.
function card(over: Partial<CardView> = {}): CardView {
  return {
    id: "c1",
    title: "ship the diff view",
    spec: null,
    rawInput: null,
    acceptance: [],
    status: "backlog",
    repoPath: null,
    baseRef: null,
    branch: null,
    workspaceId: null,
    agentKind: null,
    parentId: null,
    duplicateOf: null,
    dependsOn: null,
    tag: null,
    position: 0,
    createdAt: 0,
    updatedAt: 0,
    session: null,
    runtime: null,
    sessionCount: 0,
    copilotBusy: false,
    wrapupPending: false,
    keepWorktree: false,
    ...over,
  };
}

function runtime(over: Partial<CardRuntime> = {}): CardRuntime {
  return {
    paneId: "w1:p1",
    agent: "claude",
    agentStatus: "working",
    cwd: "/home/steph/repo",
    workspaceId: "w1",
    workspaceLabel: "proj",
    ...over,
  };
}

describe("CardTile", () => {
  it("shows neither cwd nor a pane name for a card with no live pane", () => {
    render(<CardTile card={card()} onClick={() => {}} />);
    expect(screen.queryByText(/repo/)).toBeNull();
  });

  it("shows the short cwd once a pane backs the card", () => {
    render(<CardTile card={card({ runtime: runtime() })} onClick={() => {}} />);
    expect(screen.getByText("~/repo")).toBeInTheDocument();
  });

  it("pairs the card title with the pane's own name when it has a real label", () => {
    render(
      <CardTile
        card={card({ runtime: runtime({ paneLabel: "deploy" }) })}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText("· deploy")).toBeInTheDocument();
  });

  it("shows no pane name when the pane has only its bare agent slug", () => {
    render(<CardTile card={card({ runtime: runtime() })} onClick={() => {}} />);
    expect(screen.queryByText("· claude")).toBeNull();
  });

  it("shows an unmet dependency's title and swaps the status chip for a lock", () => {
    render(
      <CardTile
        card={card()}
        onClick={() => {}}
        dependency={{ title: "ship the diff view", met: false }}
      />,
    );
    expect(screen.getByText("after “ship the diff view”")).toBeInTheDocument();
    // The status chip would otherwise render the column name in full caps.
    expect(screen.queryByText("backlog")).toBeNull();
  });

  it("still shows a met dependency — an answered gate, not left for the editor to reveal", () => {
    render(
      <CardTile
        card={card()}
        onClick={() => {}}
        dependency={{ title: "ship the diff view", met: true }}
      />,
    );
    expect(screen.getByText("after “ship the diff view”")).toBeInTheDocument();
    // Not blocking, so the normal column chip still shows.
    expect(screen.getByText("backlog")).toBeInTheDocument();
  });
});
