import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";

import { server } from "@/test/setup";
import type { TidyCandidate } from "@/lib/tidy";
import { TidySheet } from "./tidy-sheet";

const c = (paneId: string, reason: TidyCandidate["reason"], extra: Partial<TidyCandidate> = {}): TidyCandidate => ({
  paneId,
  reason,
  since: Date.now() - 3 * 3600_000,
  agent: "claude",
  workspaceLabel: "ws",
  label: paneId,
  cwd: "/r",
  ...extra,
});

describe("TidySheet", () => {
  it("leaves shells unchecked, and closes the selection after a confirm that names the count", async () => {
    let sent: unknown = null;
    server.use(
      http.get("*/api/tidy", () => HttpResponse.json({ candidates: [c("done1", "agent-done"), c("idle1", "idle"), c("sh1", "shell", { since: null })] })),
      http.post("*/api/tidy/close", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ ok: true, closed: ["done1", "idle1"], skipped: [], failed: [] });
      }),
    );
    const router = createMemoryRouter([{ path: "/", element: <TidySheet open onClose={() => {}} /> }]);
    render(<RouterProvider router={router} />);

    expect(await screen.findByText(/waiting for 3 h/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /sh1/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /done1/ })).toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: "Close the selection (2)" }));
    await userEvent.click(screen.getByRole("button", { name: "Close 2 panes" }));
    expect(await screen.findByText("2 panes closed.")).toBeInTheDocument();
    expect(sent).toEqual({ paneIds: ["done1", "idle1"], idleHours: 2 });
  });
});
