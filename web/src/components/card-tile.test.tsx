import { render, screen } from "@testing-library/react";

import type { CardRuntime, CardView } from "@/lib/board";
import type { AgentView } from "@/lib/types";
import { CardTile } from "./card-tile";

// The tile in three lines: title, phase, ONE readable state (lib/tile-state.ts). Red is for blocked only.
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
    autoHandoff: null,
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

const stateLine = (text: string | RegExp) => screen.getByText(text);
const MIN = 60_000;

describe("CardTile — three lines", () => {
  it("title, phase, and « ready to start » for a plain card", () => {
    render(<CardTile card={card({ status: "ready" })} onClick={() => {}} phase={{ name: "Simpler UI" }} />);
    expect(screen.getByText("ship the diff view")).toBeInTheDocument();
    expect(screen.getByText("Simpler UI")).toBeInTheDocument();
    expect(stateLine("ready to start")).toBeInTheDocument();
  });

  it("says « No phase » when the board knows it has none, and nothing when it doesn't know", () => {
    const { rerender } = render(<CardTile card={card()} onClick={() => {}} phase={null} />);
    expect(screen.getByText("No phase")).toBeInTheDocument();
    rerender(<CardTile card={card()} onClick={() => {}} />);
    expect(screen.queryByText("No phase")).toBeNull();
  });

  it("keeps the fiche's details off the tile: no origin badge, no branch, no criteria count", () => {
    render(<CardTile card={card({ origin: "agent", branch: "fix/diff", acceptance: ["a", "b"] })} onClick={() => {}} />);
    expect(screen.queryByText("agent")).toBeNull();
    expect(screen.queryByText("fix/diff")).toBeNull();
    expect(screen.queryByText("2")).toBeNull();
  });

  it("an unmet predecessor reads « waits for: <title> », grey, not red", () => {
    render(<CardTile card={card()} onClick={() => {}} dependency={{ title: "the panes column", met: false }} />);
    const line = stateLine("waits for: the panes column");
    expect(line.className).not.toContain("status-blocked");
  });

  it("blocked is the one red state", () => {
    render(<CardTile card={card({ status: "orphaned" })} onClick={() => {}} />);
    expect(stateLine("blocked: its agent is gone").className).toContain("text-status-blocked");
  });

  it("a merged card says so in green", () => {
    render(
      <CardTile
        card={card({ status: "done", updatedAt: Date.now() - 60 * MIN })}
        onClick={() => {}}
        facts={{ cardId: "c1", gate: null, lead: null, triage: null, review: null, pr: { url: null, state: "merged" }, sentBack: 0, operatorSaid: 0, startedAt: null, endedAt: null }}
      />,
    );
    expect(stateLine(/^merged /).className).toContain("text-status-done");
  });

  it("a live pane reads as the agent's own state and age, from the herd", () => {
    const agent = { paneId: "w1:p1", status: "working", statusSince: Date.now() - 7 * MIN, agent: "claude" } as AgentView;
    render(<CardTile card={card({ status: "working", runtime: runtime() })} onClick={() => {}} agent={agent} />);
    expect(stateLine("working for 7 min")).toBeInTheDocument();
  });

  it("without the herd, a blocked pane still says it waits for you", () => {
    render(<CardTile card={card({ status: "blocked", runtime: runtime({ agentStatus: "blocked" }) })} onClick={() => {}} />);
    expect(stateLine("waiting for you").className).not.toContain("status-blocked");
  });

  it("an open question and an open PR each have their sentence", () => {
    const { rerender } = render(
      <CardTile card={card({ status: "review" })} onClick={() => {}} awaiting={{ id: "q1", text: "which one?" }} />,
    );
    expect(stateLine("question waiting")).toBeInTheDocument();
    rerender(
      <CardTile
        card={card({ status: "review" })}
        onClick={() => {}}
        facts={{ cardId: "c1", gate: null, lead: null, triage: null, review: null, pr: { url: "u", state: "open" }, sentBack: 0, operatorSaid: 0, startedAt: null, endedAt: null }}
      />,
    );
    expect(stateLine("PR open")).toBeInTheDocument();
  });
});
