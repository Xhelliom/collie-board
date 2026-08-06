import { beforeEach, describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { NotificationBell } from "@/components/notification-bell";
import type { NotifyLogEntry } from "@/lib/types";

// The bell's whole job: open → show what pinged → land in the pane that pinged, in ITS session. The
// history is fetched when the sheet opens (never on mount), which is the other thing worth pinning
// down — an eager fetch here would ride on every screen in the app.

const entries: NotifyLogEntry[] = [
  {
    id: 2,
    ts: Date.now() - 60_000,
    agent: "claude",
    workspaceLabel: "webapp",
    cwd: "/home/you/webapp",
    status: "blocked",
    paneId: "w1:p1",
  },
  {
    id: 1,
    ts: Date.now() - 3_600_000,
    agent: "codex",
    workspaceLabel: "collie",
    cwd: "/home/you/collie",
    status: "done",
    paneId: "w2:p1",
    session: "side",
  },
];

let calls = 0;

beforeEach(() => {
  calls = 0;
  server.use(
    http.get("/api/notifications/log", () => {
      calls++;
      return HttpResponse.json({ entries });
    }),
  );
});

/** The bell plus a sentinel route, so a deep-link is observable as a location change. */
function Landed() {
  const { pathname, search } = useLocation();
  return <div data-testid="landed">{pathname + search}</div>;
}

function mount() {
  const router = createMemoryRouter([
    { path: "/", element: <NotificationBell /> },
    { path: "/pane/:paneId", element: <Landed /> },
  ]);
  render(<RouterProvider router={router} />);
}

describe("NotificationBell", () => {
  test("fetches nothing until the bell is tapped, then lists what pinged", async () => {
    const user = userEvent.setup();
    mount();
    expect(calls).toBe(0);

    await user.click(screen.getByRole("button", { name: /notifications/i }));
    expect(await screen.findByText(/needs you/)).toBeInTheDocument();
    expect(screen.getByText(/is done/)).toBeInTheDocument();
    expect(calls).toBe(1);
  });

  test("an entry deep-links to its pane, carrying its own session", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole("button", { name: /notifications/i }));
    await user.click(await screen.findByRole("button", { name: /codex/ }));

    // The `done` entry belongs to the "side" session — the link must scope to it, not to whichever
    // session the app happens to be showing.
    expect(await screen.findByTestId("landed")).toHaveTextContent("/pane/w2%3Ap1?s=side");
  });

  test("a rename and a card title win over the raw agent name and cwd — same priority as the toast", async () => {
    const rich: NotifyLogEntry = {
      id: 3,
      ts: Date.now() - 1_000,
      agent: "claude",
      workspaceLabel: "collie",
      cwd: "/home/you/collie",
      status: "blocked",
      paneId: "w3:p1",
      session: "side",
      paneLabel: "release branch",
      cardTitle: "Ship 0.86",
    };
    server.use(http.get("/api/notifications/log", () => HttpResponse.json({ entries: [rich] })));
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole("button", { name: /notifications/i }));
    expect(await screen.findByText(/release branch/)).toBeInTheDocument();
    expect(screen.getByText("side · collie · Ship 0.86")).toBeInTheDocument();
  });

  test("a copilot subtitle wins over the card title, once it's answered", async () => {
    const rich: NotifyLogEntry = {
      id: 4,
      ts: Date.now() - 1_000,
      agent: "claude",
      workspaceLabel: "collie",
      cwd: "/home/you/collie",
      status: "done",
      paneId: "w4:p1",
      cardTitle: "Ship 0.86",
      subtitle: "bumped the version and wrote the changelog",
    };
    server.use(http.get("/api/notifications/log", () => HttpResponse.json({ entries: [rich] })));
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole("button", { name: /notifications/i }));
    expect(await screen.findByText("collie · bumped the version and wrote the changelog")).toBeInTheDocument();
    expect(screen.queryByText(/Ship 0\.86/)).not.toBeInTheDocument();
  });

  test("says so when nothing has pinged yet", async () => {
    const user = userEvent.setup();
    server.use(http.get("/api/notifications/log", () => HttpResponse.json({ entries: [] })));
    mount();

    await user.click(screen.getByRole("button", { name: /notifications/i }));
    expect(await screen.findByText(/nothing has pinged yet/i)).toBeInTheDocument();
  });
});
