import { render, screen } from "@testing-library/react";

import type { CardRuntime, CardView } from "@/lib/board";
import { CardTile } from "./card-tile";

// The redesigned tile (interface homogénéité et couleurs): status row (loud/named/silent), title,
// then a meta row. cwd is gone on purpose — the branch already says where.
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
    origin: null,
    originCardId: null,
    category: null,
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

describe("CardTile — status row (loud / named / silent)", () => {
  it("blocked is loud: a solid chip naming the column, with the repo beside it", () => {
    render(<CardTile card={card({ status: "blocked" })} onClick={() => {}} repo="collie-board" />);
    expect(screen.getByText("Needs you")).toBeInTheDocument();
    expect(screen.getByText("collie-board")).toBeInTheDocument();
  });

  // The two live columns the repo used to be invisible in: a named chip owned the whole row.
  it.each(["working", "review"] as const)("%s names the repo next to its status", (status) => {
    render(<CardTile card={card({ status })} onClick={() => {}} repo="collie-board" />);
    expect(screen.getByText("collie-board")).toBeInTheDocument();
  });

  it("working is named: the column label shows, with no pill background of its own", () => {
    render(<CardTile card={card({ status: "working" })} onClick={() => {}} />);
    expect(screen.getByText("In progress")).toBeInTheDocument();
  });

  it("a silent status (backlog) shows no status label — the repo takes its place instead", () => {
    render(<CardTile card={card({ status: "backlog" })} onClick={() => {}} repo="collie-board" />);
    expect(screen.queryByText("Backlog")).toBeNull();
    expect(screen.getByText("collie-board")).toBeInTheDocument();
  });

  it("a silent status with no repo to show renders no status row at all", () => {
    const { container } = render(<CardTile card={card({ status: "done" })} onClick={() => {}} />);
    expect(screen.queryByText("Done")).toBeNull();
    // Title is still the only text content of substance — no empty row above it.
    expect(container.textContent).toBe("ship the diff view");
  });

  it("a done card's title recedes to the muted tone", () => {
    render(<CardTile card={card({ status: "done" })} onClick={() => {}} />);
    expect(screen.getByText("ship the diff view").className).toMatch(/text-muted-foreground/);
  });

  it("a card the copilot is rewriting says so — even with nothing else on the tile", () => {
    render(<CardTile card={card({ copilotBusy: true })} onClick={() => {}} />);
    expect(screen.getByText("copilot")).toBeInTheDocument();
  });

  it("says nothing once the copilot is done with it", () => {
    const { container } = render(<CardTile card={card({ copilotBusy: false })} onClick={() => {}} />);
    expect(container.textContent).toBe("ship the diff view");
  });

  it("a card the copilot filed on its own says so — with nothing else on the tile, and next to its tag", () => {
    // The tile it lands on is exactly the one whose status row wouldn't otherwise render: a fresh
    // backlog card, no pane, no branch. And the tag is still its own — provenance didn't cost it.
    render(<CardTile card={card({ origin: "copilot", tag: "infra" })} onClick={() => {}} />);
    expect(screen.getByText("auto")).toBeInTheDocument();
    expect(screen.getByText("infra")).toBeInTheDocument();
  });

  it("drops the automatic badge while the copilot is working on that card — one sparkle, not two", () => {
    render(<CardTile card={card({ origin: "copilot", copilotBusy: true })} onClick={() => {}} />);
    expect(screen.getByText("copilot")).toBeInTheDocument();
    expect(screen.queryByText("auto")).toBeNull();
  });

  it("the tag chip renders alongside whichever status treatment is showing", () => {
    render(<CardTile card={card({ status: "blocked", tag: "urgent" })} onClick={() => {}} />);
    expect(screen.getByText("urgent")).toBeInTheDocument();
  });
});

describe("CardTile — meta row", () => {
  it("shows neither cwd nor a pane name for a card with no live pane", () => {
    render(<CardTile card={card()} onClick={() => {}} />);
    expect(screen.queryByText(/repo/)).toBeNull();
  });

  it("never shows cwd, even once a pane backs the card — the branch says where now", () => {
    render(<CardTile card={card({ runtime: runtime(), branch: "fix/diff" })} onClick={() => {}} />);
    expect(screen.queryByText(/\/repo/)).toBeNull();
    expect(screen.getByText("fix/diff")).toBeInTheDocument();
  });

  it("pairs the card title with the pane's own name when it has a real label", () => {
    render(<CardTile card={card({ runtime: runtime({ paneLabel: "deploy" }) })} onClick={() => {}} />);
    expect(screen.getByText("· deploy")).toBeInTheDocument();
  });

  it("shows no pane name when the pane has only its bare agent slug", () => {
    render(<CardTile card={card({ runtime: runtime() })} onClick={() => {}} />);
    expect(screen.queryByText("· claude")).toBeNull();
  });

  it("shows ctx% and the session count when present", () => {
    render(
      <CardTile
        card={card({
          runtime: runtime(),
          session: {
            id: "s1",
            cardId: "c1",
            paneId: "w1:p1",
            agentSessionId: null,
            agentKind: null,
            ctxTokens: null,
            ctxPct: 42,
            handoffMd: null,
            outcome: null,
            handoffRequestedAt: null,
            startedAt: 0,
            endedAt: null,
          },
          sessionCount: 2,
        })}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText("· 2 sessions")).toBeInTheDocument();
  });

  it("renders no meta row at all when there is nothing to say", () => {
    const { container } = render(<CardTile card={card()} onClick={() => {}} />);
    expect(container.textContent).toBe("ship the diff view");
  });
});

describe("CardTile — source line", () => {
  it("names the card a follow-up came out of, under its own title", () => {
    render(<CardTile card={card({ title: "test the feature" })} onClick={() => {}} source="add the diff view" />);
    expect(screen.getByText("from “add the diff view”")).toBeInTheDocument();
  });

  it("renders nothing at all for a card that came from nowhere — no empty line, no orphan icon", () => {
    const { container } = render(<CardTile card={card()} onClick={() => {}} />);
    expect(container.textContent).toBe("ship the diff view");
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("CardTile — dependency line", () => {
  it("shows an unmet dependency's title, independent of the status row", () => {
    render(
      <CardTile card={card()} onClick={() => {}} dependency={{ title: "ship the diff view", met: false }} />,
    );
    expect(screen.getByText("after “ship the diff view”")).toBeInTheDocument();
  });

  it("still shows a met dependency — an answered gate, not left for the editor to reveal", () => {
    render(
      <CardTile card={card()} onClick={() => {}} dependency={{ title: "ship the diff view", met: true }} />,
    );
    expect(screen.getByText("after “ship the diff view”")).toBeInTheDocument();
  });
});
