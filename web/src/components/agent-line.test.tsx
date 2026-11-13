import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";

import type { AgentView } from "@/lib/types";
import { AgentLine } from "./agent-line";

const agent = (extra: Partial<AgentView> = {}): AgentView => ({
  paneId: "w1:p1", workspaceId: "w1", workspaceLabel: "proj", workspaceNumber: 1, tabId: "w1:t1", agent: "claude", status: "working", cwd: "/home/repo", focused: false, kind: "agent", ...extra,
});

function line(a: AgentView, onOpen: (id: string) => void = () => {}) {
  const router = createMemoryRouter([
    { path: "/", element: <AgentLine agent={a} onOpen={onOpen} /> },
    { path: "/card/:id", element: <p>card page</p> },
  ]);
  render(<RouterProvider router={router} />);
}

describe("AgentLine", () => {
  it("a free agent says what it does, its model and effort in words", () => {
    line(agent({ said: "Je lis le code.", model: "Opus 5.5", effort: "medium" }));
    expect(screen.getByText("free agent")).toBeInTheDocument();
    expect(screen.getByText("· Je lis le code.")).toBeInTheDocument();
    expect(screen.getAllByText("Opus 5.5, medium").length).toBeGreaterThan(0);
  });

  it("shows no model nor effort it does not know", () => {
    line(agent({ effort: "high" }));
    expect(screen.queryByText(/high/)).toBeNull();
  });

  it("a card's agent links to its card, the rest of the line opens the pane", async () => {
    const opened: string[] = [];
    line(agent({ cardId: "c1", cardTitle: "Fix login" }), (id) => opened.push(id));
    await userEvent.click(screen.getByRole("button", { name: /Fix login/ }));
    expect(opened).toEqual(["w1:p1"]);
    await userEvent.click(screen.getByRole("link", { name: "Open the card" }));
    expect(await screen.findByText("card page")).toBeInTheDocument();
  });
});
