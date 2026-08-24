import { describe, expect, test } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";

import { AgentToasts } from "@/components/agent-toasts";
import { useAgentTransitions } from "@/hooks/use-transitions";
import type { AgentStatus, AgentView } from "@/lib/types";

// The foreground notification, end to end: the snapshot diff decides WHEN, the toast decides WHAT it
// says and that the screen underneath stays usable.

const base: AgentView = {
  paneId: "w1:p1",
  workspaceId: "w1",
  workspaceLabel: "webapp",
  workspaceNumber: 1,
  tabId: "w1:t1",
  agent: "claude",
  status: "working",
  cwd: "/home/you/webapp",
  focused: false,
  sessionName: "the refactor",
  cardTitle: "Ship the toasts",
};

function agentsAt(status: AgentStatus): AgentView[] {
  return [{ ...base, status }];
}

// Snapshots arrive from the poll, not from a re-render of the tree — so the harness owns the state
// and the test pushes the next snapshot into it. Re-rendering the RouterProvider instead would
// remount the hook and lose the `prev` map the whole diff rests on.
let pushSnapshot: (agents: AgentView[]) => void = () => {};

function Harness({
  from,
  openPaneId,
  copilotPaneId = null,
}: {
  from: AgentStatus;
  openPaneId: string | null;
  copilotPaneId?: string | null;
}) {
  const [agents, setAgents] = useState<AgentView[]>(() => agentsAt(from));
  pushSnapshot = setAgents;
  const { toasts, dismiss } = useAgentTransitions(agents, openPaneId, copilotPaneId, "side");
  return <AgentToasts toasts={toasts} onDismiss={dismiss} />;
}

function Landed() {
  const { pathname, search } = useLocation();
  return <div data-testid="landed">{pathname + search}</div>;
}

function mount({
  from = "working",
  openPaneId = null,
  copilotPaneId = null,
}: { from?: AgentStatus; openPaneId?: string | null; copilotPaneId?: string | null } = {}) {
  const router = createMemoryRouter([
    { path: "/", element: <Harness from={from} openPaneId={openPaneId} copilotPaneId={copilotPaneId} /> },
    { path: "/pane/:paneId", element: <Landed /> },
  ]);
  render(<RouterProvider router={router} />);
}

const advance = (status: AgentStatus) => act(() => pushSnapshot(agentsAt(status)));

describe("AgentToasts", () => {
  test("the first snapshot never toasts — only a real transition does", () => {
    // Opening the app on an agent that is ALREADY stuck must stay silent…
    mount({ from: "blocked" });
    expect(screen.queryByText(/needs you/)).not.toBeInTheDocument();

    // …and the transition into it must not.
    advance("working");
    advance("blocked");
    expect(screen.getByText(/needs you/)).toBeInTheDocument();
  });

  test("carries the pane's own name, the herd session, the workspace and the card", () => {
    mount();
    advance("done");

    // Not "claude is done": the pane's own name (Claude's `/rename`) is what tells three claudes apart.
    // Name + verb + WHERE (session · workspace) share the title line; WHAT (the card) is its own.
    expect(screen.getByText("the refactor is done · side · webapp")).toBeInTheDocument();
    expect(screen.getByText("Ship the toasts")).toBeInTheDocument();
  });

  test("stays out of the way: the stack takes no taps, and the toast can be dismissed", async () => {
    const user = userEvent.setup();
    mount();
    advance("blocked");

    // The floating stack must not be a dead strip across the screen you're using.
    expect(screen.getByText(/needs you/).closest("[aria-live]")).toHaveClass("pointer-events-none");

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/needs you/)).not.toBeInTheDocument();
  });

  test("a tap deep-links into the pane, in its own session", async () => {
    const user = userEvent.setup();
    mount();
    advance("blocked");

    await user.click(screen.getByText(/needs you/));
    expect(await screen.findByTestId("landed")).toHaveTextContent("/pane/w1%3Ap1?s=side");
  });

  test("a swipe on an incoming toast dismisses it — with a finger, either direction", async () => {
    const user = userEvent.setup();
    mount();
    advance("blocked");
    const toast = screen.getByText(/needs you/);

    await user.pointer([
      { keys: "[TouchA>]", target: toast, coords: { clientX: 20, clientY: 40 } },
      { pointerName: "TouchA", coords: { clientX: 140, clientY: 44 } },
      { keys: "[/TouchA]" },
    ]);

    expect(screen.queryByText(/needs you/)).not.toBeInTheDocument();
    // Swiped away, not destroyed: the toast is a client-side view of the bridge's notify-log, which
    // the bell reads on open — nothing here writes to it.
    expect(screen.queryByTestId("landed")).not.toBeInTheDocument();
  });

  test("a drag too short to dismiss springs back, and never deep-links on release", async () => {
    const user = userEvent.setup();
    mount();
    advance("blocked");
    const toast = screen.getByText(/needs you/);

    await user.pointer([
      { keys: "[TouchA>]", target: toast, coords: { clientX: 20, clientY: 40 } },
      { pointerName: "TouchA", coords: { clientX: 60, clientY: 40 } },
      { keys: "[/TouchA]" },
    ]);

    expect(screen.getByText(/needs you/)).toBeInTheDocument();
    expect(screen.queryByTestId("landed")).not.toBeInTheDocument();
  });

  test("says nothing about the pane you're already looking at", () => {
    mount({ openPaneId: "w1:p1" });
    advance("blocked");

    expect(screen.queryByText(/needs you/)).not.toBeInTheDocument();
  });

  test("says nothing about the board's own agent — a real pane, not a worker", () => {
    mount({ copilotPaneId: "w1:p1" });
    advance("blocked");

    expect(screen.queryByText(/needs you/)).not.toBeInTheDocument();
  });
});
