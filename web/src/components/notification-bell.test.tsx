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

/**
 * Nested under the root route, as in the real app: the badge count comes from its loader data, and
 * the bell renders OUTSIDE the outlet (it lives in the header) so it survives a deep-link. Pass a
 * function for a count that moves — the root loader re-runs on every navigation and revalidation.
 */
function mount(notifyCount: number | (() => number) = 0) {
  const home = () => ({ notifyCount: typeof notifyCount === "function" ? notifyCount() : notifyCount }) as HomeData;
  const router = createMemoryRouter(
    [
      {
        id: ROOT_ROUTE_ID,
        path: "/",
        loader: home,
        element: (
          <>
            <NotificationBell />
            <Outlet />
          </>
        ),
        children: [
          { index: true, element: null },
          { path: "pane/:paneId", element: <Landed /> },
          { path: "card/:cardId", element: <Landed /> },
        ],
      },
    ],
    { hydrationData: { loaderData: { [ROOT_ROUTE_ID]: home() } } },
  );
  render(<RouterProvider router={router} />);
}

describe("NotificationBell", () => {
  test("fetches nothing until the bell is tapped, then lists what pinged", async () => {
    const user = userEvent.setup();
    mount();
    expect(calls).toBe(0);

    await user.click(screen.getByRole("button", { name: /notifications/i }));
    expect(await screen.findByText(/Needs you/)).toBeInTheDocument();
    expect(screen.getByText(/Done ·/)).toBeInTheDocument();
    expect(calls).toBe(1);
  });

  test("an entry deep-links to its pane, carrying its own session", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole("button", { name: /notifications/i }));
    // ^Done — the row itself, not its "Delete notification: …" sibling.
    await user.click(await screen.findByRole("button", { name: /^Done · collie/ }));

    // The `done` entry belongs to the "side" session — the link must scope to it, not to whichever
    // session the app happens to be showing.
    expect(await screen.findByTestId("landed")).toHaveTextContent("/pane/w2%3Ap1?s=side");
  });

  test("a card-to-read entry says Review and lands on the CARD, not the pane it ran in", async () => {
    const review: NotifyLogEntry = {
      id: 4,
      ts: Date.now() - 1_000,
      agent: "claude",
      workspaceLabel: "collie",
      cwd: "/home/you/collie",
      status: "done",
      paneId: "w4:p1",
      cardTitle: "Ship 0.86",
      cardId: "c1",
      cardStatus: "review",
    };
    server.use(http.get("/api/notifications/log", () => HttpResponse.json({ entries: [review] })));
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole("button", { name: /notifications/i }));
    // ^Review — the row, not its "Delete notification: …" sibling.
    await user.click(await screen.findByRole("button", { name: /^Review · Ship 0\.86/ }));
    expect(await screen.findByTestId("landed")).toHaveTextContent("/card/c1");
  });

  test("a board entry has no pane at all, and lands on its card whatever the card now reads", async () => {
    // What bridge/board-notify.ts writes: a fact the board journalled, with no terminal behind it.
    // `cardStatus` is `done` here on purpose — the absent paneId, not the status, is what routes it.
    const boardEntry: NotifyLogEntry = {
      id: 5,
      ts: Date.now() - 1_000,
      cwd: "/home/you/collie",
      status: "done",
      cardTitle: "Ship 0.86",
      cardId: "c9",
      cardStatus: "done",
      subtitle: "Copilot review: partial",
    };
    server.use(http.get("/api/notifications/log", () => HttpResponse.json({ entries: [boardEntry] })));
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole("button", { name: /notifications/i }));
    await user.click(await screen.findByRole("button", { name: /^Done · Ship 0\.86/ }));
    expect(await screen.findByTestId("landed")).toHaveTextContent("/card/c9");
  });

  test("a stalled card reads Stalled, and lands on the card that stopped", async () => {
    // The board's own alert, back from the coordinator's history hook (bridge/board-notify.ts):
    // a card whose pane vanished or whose handoff never landed. No pane, so no terminal to open.
    const stalledEntry: NotifyLogEntry = {
      id: 6,
      ts: Date.now() - 1_000,
      cwd: "/home/you/.herdr/worktrees/collie-board/board/ship-it",
      status: "stalled",
      cardTitle: "Ship 0.86",
      cardId: "c7",
      cardStatus: "orphaned",
      subtitle: "its agent's pane is gone — relaunch from the last handoff",
    };
    server.use(http.get("/api/notifications/log", () => HttpResponse.json({ entries: [stalledEntry] })));
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole("button", { name: /notifications/i }));
    const row = await screen.findByRole("button", { name: /^Stalled · Ship 0\.86/ });
    expect(row).toHaveTextContent("collie-board · its agent's pane is gone — relaunch from the last handoff");
    await user.click(row);
    expect(await screen.findByTestId("landed")).toHaveTextContent("/card/c7");
  });

  test("the card is the subject and the repo drops to the second line — same sentence as the push", async () => {
    const rich: NotifyLogEntry = {
      id: 3,
      ts: Date.now() - 1_000,
      agent: "claude",
      workspaceLabel: "collie",
      cwd: "/home/you/collie",
      status: "blocked",
      paneId: "w3:p1",
      session: "side",
      cardTitle: "Ship 0.86",
    };
    server.use(http.get("/api/notifications/log", () => HttpResponse.json({ entries: [rich] })));
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole("button", { name: /notifications/i }));
    // The pane's own names name nothing the operator doesn't already know, and are gone from every
    // surface since N9: the subject is the card. The rename ingredients no longer even reach the
    // entry (NOTIFY_AUDIT.md §2.6) — `agent` is the last carried-but-unrendered one left.
    expect(await screen.findByText("Needs you · Ship 0.86")).toBeInTheDocument();
    expect(screen.getByText("side · collie")).toBeInTheDocument();
    expect(screen.queryByText(/claude/)).not.toBeInTheDocument();
  });

  test("a copilot subtitle lands under the card, not over it — nothing is said twice", async () => {
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
    // The old body was `subtitle ?? cardTitle ?? cwd` — a fallback onto the very thing the title
    // already said. Now the card holds the title and the body is repo + what happened, in one line.
    expect(await screen.findByText("Done · Ship 0.86")).toBeInTheDocument();
    expect(screen.getByText("collie · bumped the version and wrote the changelog")).toBeInTheDocument();
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
    await user.click(await screen.findByRole("button", { name: /delete notification: Needs you · webapp/i }));
    await waitFor(() => expect(screen.queryByText(/Needs you/)).not.toBeInTheDocument());
    expect(screen.getByText(/Done ·/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: /notifications/i }));

    expect(await screen.findByText(/Done ·/)).toBeInTheDocument();
    expect(screen.queryByText(/Needs you/)).not.toBeInTheDocument();
  });

  test("tapping an entry marks it read, and the badge drops to the unread count", async () => {
    // The badge counts UNREAD entries, so the number has to move on the tap itself — not when the
    // row is deleted, and not only after the next 1.5s poll.
    let live = entries.map((e) => ({ ...e }));
    server.use(
      http.get("/api/notifications/log", () => HttpResponse.json({ entries: live })),
      http.post("/api/notifications/log/:id/read", ({ params }) => {
        live = live.map((e) => (String(e.id) === params.id ? { ...e, read: true } : e));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    mount(() => live.filter((e) => !e.read).length);
    expect(screen.getByRole("button", { name: "Notifications (2)" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^notifications/i }));
    await user.click(await screen.findByRole("button", { name: /^Needs you · webapp/ }));

    // The bridge is what holds the read state (it survives a reload), so the badge only drops once
    // the POST has landed — and the entry itself is still in the history, merely not counted.
    await waitFor(() => expect(screen.getByRole("button", { name: "Notifications (1)" })).toBeInTheDocument());
    expect(live).toHaveLength(2);
  });

  test("one gesture marks every entry read — the badge empties, the history stays", async () => {
    let live = entries.map((e) => ({ ...e }));
    server.use(
      http.get("/api/notifications/log", () => HttpResponse.json({ entries: live })),
      http.post("/api/notifications/log/read-all", () => {
        live = live.map((e) => ({ ...e, read: true }));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    mount(() => live.filter((e) => !e.read).length);

    await user.click(screen.getByRole("button", { name: /^notifications/i }));
    await user.click(await screen.findByRole("button", { name: /mark all read/i }));

    // Badge gone (the bell drops its count from its aria-label — `hidden`, because the open sheet
    // aria-hides the header behind it), rows still there, gesture retired now that nothing is
    // unread — that last one is the whole "marks, doesn't delete" distinction.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Notifications", hidden: true })).toBeInTheDocument(),
    );
    expect(screen.getByText(/Needs you/)).toBeInTheDocument();
    expect(screen.getByText(/Done ·/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark all read/i })).not.toBeInTheDocument();
    expect(live).toHaveLength(2);
  });

  test("says so when nothing has pinged yet", async () => {
    const user = userEvent.setup();
    server.use(http.get("/api/notifications/log", () => HttpResponse.json({ entries: [] })));
    mount();

    await user.click(screen.getByRole("button", { name: /notifications/i }));
    expect(await screen.findByText(/nothing has pinged yet/i)).toBeInTheDocument();
  });
});
