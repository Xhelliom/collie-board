import { describe, expect, test } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { toast } from "sonner";

import { Toaster } from "@/components/ui/sonner";
import { useAgentTransitions } from "@/hooks/use-transitions";
import type { AgentStatus, AgentView } from "@/lib/types";

// The foreground notification, end to end: the snapshot diff decides WHEN, the toast says WHAT and
// where its Open button leads. The toast lands in the app's one Sonner <Toaster/>.

beforeEach(() => toast.dismiss());

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
  useAgentTransitions(agents, openPaneId, copilotPaneId, "side");
  return <Toaster />;
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

// Sonner renders a toast() on its next tick: an absence asserted before that proves nothing.
const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));

const advance = (status: AgentStatus, extra?: Partial<AgentView>) =>
  act(() => pushSnapshot(agentsAt(status, extra)));

describe("useAgentTransitions toasts", () => {
  test("the first snapshot never toasts — only a real transition does", async () => {
    // Opening the app on an agent that is ALREADY stuck must stay silent…
    mount({ from: "blocked" });
    await settle();
    expect(screen.queryByText(/Needs you/)).not.toBeInTheDocument();

    // …and the transition into it must not.
    advance("working");
    advance("blocked");
    expect(await screen.findByText(/Needs you/)).toBeInTheDocument();
  });

  test("names the work, not the worker — the same sentence the push sends", async () => {
    mount();
    advance("done");
    await screen.findByText("Done · Ship the toasts");

    // Not "claude is done", and not "the refactor is done" either: the subject is the CARD, which is
    // what the push's title says too (lib/notify-content.ts). The second line is where to go look —
    // the herd session, then the repo, which the card title displaced out of the title.
    expect(screen.getByText("Done · Ship the toasts")).toBeInTheDocument();
    expect(screen.getByText("side · webapp")).toBeInTheDocument();
  });

  test("one toast per pane: a blocked→done flip replaces its own notice", async () => {
    mount();
    advance("blocked");
    expect(await screen.findByText(/Needs you/)).toBeInTheDocument();
    advance("done");
    expect(await screen.findByText("Done · Ship the toasts")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Needs you/)).not.toBeInTheDocument());
  });

  test("goes away on its own after its TTL", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mount();
      advance("blocked");
      expect(await screen.findByText(/Needs you/)).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(5000));
      expect(screen.getByText(/Needs you/)).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1500));
      await waitFor(() => expect(screen.queryByText(/Needs you/)).not.toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });

  test("Open deep-links into the pane, in its own session", async () => {
    const user = userEvent.setup();
    mount();
    advance("blocked");

    await user.click(await screen.findByRole("button", { name: "Open" }));
    expect(await screen.findByTestId("landed")).toHaveTextContent("/pane/w1%3Ap1?s=side");
  });

  test("a card that landed in review: the marker changes and Open leaves the terminal behind", async () => {
    const user = userEvent.setup();
    mount();
    // `reconcile()` moved the card to `review` on the same snapshot that reported the pane done, so
    // the diff already sees it — no re-reading, unlike the push's 30s-later fire (NOTIFY_AUDIT.md §4.2).
    advance("done", { cardId: "c1", cardStatus: "review" });

    expect(await screen.findByText("Review · Ship the toasts")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open" }));
    // The card, not `/pane/w1%3Ap1` — the pane is where there is nothing left to do (§4.1).
    expect(await screen.findByTestId("landed")).toHaveTextContent("/card/c1");
  });

  test("a card that is NOT in review is untouched — `Done`, and Open goes into the pane", async () => {
    const user = userEvent.setup();
    mount();
    advance("done", { cardId: "c1", cardStatus: "working" });

    expect(await screen.findByText("Done · Ship the toasts")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByTestId("landed")).toHaveTextContent("/pane/w1%3Ap1?s=side");
  });

  test("says nothing about the pane you're already looking at", async () => {
    mount({ openPaneId: "w1:p1" });
    advance("blocked");
    await settle();

    expect(screen.queryByText(/Needs you/)).not.toBeInTheDocument();
  });

  test("says nothing about the board's own agent — a real pane, not a worker", async () => {
    mount({ copilotPaneId: "w1:p1" });
    advance("blocked");
    await settle();

    expect(screen.queryByText(/Needs you/)).not.toBeInTheDocument();
  });
});
