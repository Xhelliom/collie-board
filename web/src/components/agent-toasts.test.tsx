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

function agentsAt(status: AgentStatus, extra: Partial<AgentView> = {}): AgentView[] {
  return [{ ...base, status, ...extra }];
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
    { path: "/card/:cardId", element: <Landed /> },
  ]);
  render(<RouterProvider router={router} />);
}

const advance = (status: AgentStatus, extra?: Partial<AgentView>) =>
  act(() => pushSnapshot(agentsAt(status, extra)));

describe("AgentToasts", () => {
  test("the first snapshot never toasts — only a real transition does", () => {
    // Opening the app on an agent that is ALREADY stuck must stay silent…
    mount({ from: "blocked" });
    expect(screen.queryByText(/Needs you/)).not.toBeInTheDocument();

    // …and the transition into it must not.
    advance("working");
    advance("blocked");
    expect(screen.getByText(/Needs you/)).toBeInTheDocument();
  });

  test("names the work, not the worker — the same sentence the push sends", () => {
    mount();
    advance("done");

    // Not "claude is done", and not "the refactor is done" either: the subject is the CARD, which is
    // what the push's title says too (lib/notify-content.ts). The second line is where to go look —
    // the herd session, then the repo, which the card title displaced out of the title.
    expect(screen.getByText("Done · Ship the toasts")).toBeInTheDocument();
    expect(screen.getByText("side · webapp")).toBeInTheDocument();
  });

  test("stays out of the way: the stack takes no taps, and the toast can be dismissed", async () => {
    const user = userEvent.setup();
    mount();
    advance("blocked");

    // The floating stack must not be a dead strip across the screen you're using.
    expect(screen.getByText(/Needs you/).closest("[aria-live]")).toHaveClass("pointer-events-none");

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/Needs you/)).not.toBeInTheDocument();
  });

  test("a tap deep-links into the pane, in its own session", async () => {
    const user = userEvent.setup();
    mount();
    advance("blocked");

    await user.click(screen.getByText(/Needs you/));
    expect(await screen.findByTestId("landed")).toHaveTextContent("/pane/w1%3Ap1?s=side");
  });

  test("a card that landed in review: the marker changes and the tap leaves the terminal behind", async () => {
    const user = userEvent.setup();
    mount();
    // `reconcile()` moved the card to `review` on the same snapshot that reported the pane done, so
    // the diff already sees it — no re-reading, unlike the push's 30s-later fire (NOTIFY_AUDIT.md §4.2).
    advance("done", { cardId: "c1", cardStatus: "review" });

    expect(screen.getByText("Review · Ship the toasts")).toBeInTheDocument();
    await user.click(screen.getByText("Review · Ship the toasts"));
    // The card, not `/pane/w1%3Ap1` — the pane is where there is nothing left to do (§4.1).
    expect(await screen.findByTestId("landed")).toHaveTextContent("/card/c1");
  });

  test("a card that is NOT in review is untouched — `Done`, and a tap into the pane", async () => {
    const user = userEvent.setup();
    mount();
    advance("done", { cardId: "c1", cardStatus: "working" });

    expect(screen.getByText("Done · Ship the toasts")).toBeInTheDocument();
    await user.click(screen.getByText("Done · Ship the toasts"));
    expect(await screen.findByTestId("landed")).toHaveTextContent("/pane/w1%3Ap1?s=side");
  });

  test("a swipe on an incoming toast dismisses it — with a finger, either direction", async () => {
    const user = userEvent.setup();
    mount();
    advance("blocked");
    const toast = screen.getByText(/Needs you/);

    await user.pointer([
      { keys: "[TouchA>]", target: toast, coords: { clientX: 20, clientY: 40 } },
      { pointerName: "TouchA", coords: { clientX: 140, clientY: 44 } },
      { keys: "[/TouchA]" },
    ]);

    expect(screen.queryByText(/Needs you/)).not.toBeInTheDocument();
    // Swiped away, not destroyed: the toast is a client-side view of the bridge's notify-log, which
    // the bell reads on open — nothing here writes to it.
    expect(screen.queryByTestId("landed")).not.toBeInTheDocument();
  });

  test("a drag too short to dismiss springs back, and never deep-links on release", async () => {
    const user = userEvent.setup();
    mount();
    advance("blocked");
    const toast = screen.getByText(/Needs you/);

    await user.pointer([
      { keys: "[TouchA>]", target: toast, coords: { clientX: 20, clientY: 40 } },
      { pointerName: "TouchA", coords: { clientX: 60, clientY: 40 } },
      { keys: "[/TouchA]" },
    ]);

    expect(screen.getByText(/Needs you/)).toBeInTheDocument();
    expect(screen.queryByTestId("landed")).not.toBeInTheDocument();
  });

  test("says nothing about the pane you're already looking at", () => {
    mount({ openPaneId: "w1:p1" });
    advance("blocked");

    expect(screen.queryByText(/Needs you/)).not.toBeInTheDocument();
  });

  test("says nothing about the board's own agent — a real pane, not a worker", () => {
    mount({ copilotPaneId: "w1:p1" });
    advance("blocked");

    expect(screen.queryByText(/Needs you/)).not.toBeInTheDocument();
  });
});
