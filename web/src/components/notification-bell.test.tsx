import { beforeEach, describe, expect, test } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from "react-router";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { NotificationBell } from "@/components/notification-bell";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
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

/** Nested under the root route, as in the real app: the badge count comes from its loader data. */
function mount(notifyCount = 0) {
  const home = { notifyCount } as HomeData;
  const router = createMemoryRouter(
    [
      {
        id: ROOT_ROUTE_ID,
        path: "/",
        loader: () => home,
        element: <Outlet />,
        children: [
          { index: true, element: <NotificationBell /> },
          { path: "pane/:paneId", element: <Landed /> },
        ],
      },
    ],
    { hydrationData: { loaderData: { [ROOT_ROUTE_ID]: home } } },
  );
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
    // ^codex — the row itself, not its "Delete notification from codex" sibling.
    await user.click(await screen.findByRole("button", { name: /^codex/ }));

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
    // WHERE (session · repo) shares the name+verb line; WHAT (the card title) gets its own, wrappable
    // line — see notifyWhere/notifyWhat in lib/types.ts.
    expect(screen.getByText("side · collie")).toBeInTheDocument();
    expect(screen.getByText("Ship 0.86")).toBeInTheDocument();
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
    expect(await screen.findByText("collie")).toBeInTheDocument();
    expect(screen.getByText("bumped the version and wrote the changelog")).toBeInTheDocument();
    expect(screen.queryByText(/Ship 0\.86/)).not.toBeInTheDocument();
  });

  test("wears the count as a badge, without opening (or fetching) anything", () => {
    mount(3);
    // The count rides the snapshot poll, so it's on screen before the sheet — and its fetch — exists.
    expect(screen.getByRole("button", { name: "Notifications (3)" })).toHaveTextContent("3");
    expect(calls).toBe(0);
  });

  test("no badge at all when nothing has pinged", () => {
    mount(0);
    expect(screen.getByRole("button", { name: "Notifications" })).toHaveTextContent("");
  });

  test("an entry can be deleted, and it stays gone across a close/reopen", async () => {
    // The bridge is what makes a dismissal stick — the history is refetched on every open, so a
    // row that only disappeared client-side would walk right back in.
    let live = [...entries];
    server.use(
      http.get("/api/notifications/log", () => {
        calls++;
        return HttpResponse.json({ entries: live });
      }),
      http.delete("/api/notifications/log/:id", ({ params }) => {
        live = live.filter((e) => String(e.id) !== params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole("button", { name: /notifications/i }));
    await user.click(await screen.findByRole("button", { name: /delete notification from claude/i }));
    await waitFor(() => expect(screen.queryByText(/needs you/)).not.toBeInTheDocument());
    expect(screen.getByText(/is done/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: /notifications/i }));

    expect(await screen.findByText(/is done/)).toBeInTheDocument();
    expect(screen.queryByText(/needs you/)).not.toBeInTheDocument();
  });

  test("says so when nothing has pinged yet", async () => {
    const user = userEvent.setup();
    server.use(http.get("/api/notifications/log", () => HttpResponse.json({ entries: [] })));
    mount();

    await user.click(screen.getByRole("button", { name: /notifications/i }));
    expect(await screen.findByText(/nothing has pinged yet/i)).toBeInTheDocument();
  });
});
