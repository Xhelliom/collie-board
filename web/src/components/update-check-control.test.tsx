import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { server } from "@/test/setup";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import type { UpdateInfo } from "@/lib/types";
import { UpdateCheckControl } from "./update-check-control";

// UpdateCheckControl reads the running version / last-checked from the root loader's `update`, and on
// tap forces an upstream check then revalidates the snapshot. Drive it through a memory router (for
// the loader data) plus MSW (for POST /api/update/check).

const upToDate: UpdateInfo = {
  current: "0.11.0",
  latest: "0.11.0",
  latestUrl: null,
  releaseAvailable: false,
  bridgeStale: false,
  checkedAt: 1_700_000_000_000,
};

function homeData(update: UpdateInfo | undefined): HomeData {
  return {
    bridge: "connected",
    device: undefined,
    agents: [],
    shellPanes: [],
    workspaces: [],
    tabs: [],
    sessions: [],
    copilotPaneId: null,
    session: undefined,
    snoozedUntil: null,
    notifyCount: 0,
    update,
    error: false,
    authError: false,
  };
}

function renderControl(update: UpdateInfo | undefined, onLoad?: () => void) {
  const router = createMemoryRouter(
    [
      {
        id: ROOT_ROUTE_ID,
        path: "/",
        loader: () => {
          onLoad?.();
          return homeData(update);
        },
        element: (
          <div data-testid="root">
            <UpdateCheckControl />
          </div>
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  server.use(http.post("/api/update/check", () => HttpResponse.json(upToDate)));
});

describe("UpdateCheckControl", () => {
  it("shows the running version and 'Up to date' when nothing is pending", async () => {
    renderControl(upToDate);
    expect(await screen.findByText(/running v0\.11\.0/i)).toBeInTheDocument();
    expect(screen.getByText(/up to date/i)).toBeInTheDocument();
  });

  it("forces a check and revalidates the snapshot on tap", async () => {
    let posted = false;
    server.use(
      http.post("/api/update/check", () => {
        posted = true;
        // checkedAt ADVANCES past the prior state → a genuine successful check → revalidate.
        return HttpResponse.json({ ...upToDate, checkedAt: 1_700_000_000_500 });
      }),
    );
    let loads = 0;
    const user = userEvent.setup();
    renderControl(upToDate, () => {
      loads += 1;
    });
    const btn = await screen.findByRole("button", { name: /check for updates/i });
    const before = loads; // loader ran once for the initial render

    await user.click(btn);

    await waitFor(() => expect(posted).toBe(true));
    await waitFor(() => expect(loads).toBeGreaterThan(before)); // revalidation re-ran the loader
    expect(btn).not.toBeDisabled();
  });

  it("surfaces a check failure and re-enables the button", async () => {
    server.use(http.post("/api/update/check", () => new HttpResponse(null, { status: 500 })));
    const user = userEvent.setup();
    renderControl(upToDate);
    const btn = await screen.findByRole("button", { name: /check for updates/i });

    await user.click(btn);

    expect(await screen.findByText(/couldn't check/i)).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it("treats a 200 whose checkedAt didn't advance as a silent failure (no false 'Up to date')", async () => {
    // The bridge is fail-soft: a GitHub error keeps prior state and STILL returns 200 with the same
    // checkedAt. The button must surface that, not read it as an authoritative "checked, all good".
    server.use(http.post("/api/update/check", () => HttpResponse.json(upToDate))); // same checkedAt as prior
    let loads = 0;
    const user = userEvent.setup();
    renderControl(upToDate, () => {
      loads += 1;
    });
    const btn = await screen.findByRole("button", { name: /check for updates/i });
    const before = loads;

    await user.click(btn);

    expect(await screen.findByText(/couldn't check/i)).toBeInTheDocument();
    expect(loads).toBe(before); // did NOT revalidate on a non-advancing check
    expect(btn).not.toBeDisabled();
  });

  it("prompts to check when the bridge reports no update info", async () => {
    renderControl(undefined);
    expect(await screen.findByText(/whether a new collie version is available/i)).toBeInTheDocument();
    expect(screen.queryByText(/up to date/i)).toBeNull();
  });

  describe("the update button", () => {
    const newer: UpdateInfo = { ...upToDate, latest: "0.12.0", releaseAvailable: true };

    it("is offered only when a newer release exists", async () => {
      renderControl(upToDate);
      await screen.findByText(/running v0\.11\.0/i);
      expect(screen.queryByRole("button", { name: /update to/i })).toBeNull();
    });

    it("says the update is under way while the bridge restarts under the request", async () => {
      let posted = false;
      server.use(
        http.post("/api/update/apply", () => {
          posted = true;
          return HttpResponse.error(); // the restart drops the pending request
        }),
      );
      const user = userEvent.setup();
      renderControl(newer);
      await user.click(await screen.findByRole("button", { name: /update to 0\.12\.0/i }));
      await waitFor(() => expect(posted).toBe(true));
      expect(await screen.findByText(/reloads on the new version/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /updating to 0\.12\.0/i })).toBeDisabled();
    });

    it("shows why an update failed, and lets it be tried again", async () => {
      server.use(
        http.post("/api/update/apply", () =>
          HttpResponse.json({ error: "fatal: Not possible to fast-forward", kind: "update-failed" }, { status: 502 }),
        ),
      );
      const user = userEvent.setup();
      renderControl(newer);
      await user.click(await screen.findByRole("button", { name: /update to 0\.12\.0/i }));
      expect(await screen.findByText(/current version keeps running/i)).toBeInTheDocument();
      expect(screen.getByText("fatal: Not possible to fast-forward")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /update to 0\.12\.0/i })).not.toBeDisabled();
    });
  });
});
