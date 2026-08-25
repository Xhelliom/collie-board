import { beforeEach, describe, expect, test } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { FollowUpsControl } from "@/components/follow-ups-control";

// The board-wide follow-up switch. Driven through MSW: the GET seeds it, the POST echoes back what
// it stored, and a failing POST must leave the switch where it started.

let lastBody: Record<string, unknown> | undefined;
let prefs: { autoFollowUps: boolean; followUpCategories: string[] };

beforeEach(() => {
  lastBody = undefined;
  prefs = { autoFollowUps: false, followUpCategories: ["test", "feature", "bug", "docs", "chore"] };
  server.use(
    http.get("/api/board/prefs", () => HttpResponse.json(prefs)),
    http.post("/api/board/prefs", async ({ request }) => {
      lastBody = (await request.json()) as Record<string, unknown>;
      prefs = { ...prefs, ...lastBody };
      return HttpResponse.json(prefs);
    }),
  );
});

describe("FollowUpsControl", () => {
  test("renders the bridge's answer, off by default", async () => {
    render(<FollowUpsControl />);
    expect(await screen.findByRole("switch", { name: /follow-up cards/i })).not.toBeChecked();
  });

  test("turning it on POSTs the new value", async () => {
    const user = userEvent.setup();
    render(<FollowUpsControl />);
    const toggle = await screen.findByRole("switch", { name: /follow-up cards/i });

    await user.click(toggle);

    await waitFor(() => expect(lastBody).toEqual({ autoFollowUps: true }));
    await waitFor(() => expect(toggle).toBeChecked());
  });

  test("reverts the optimistic toggle when the POST fails", async () => {
    const user = userEvent.setup();
    server.use(http.post("/api/board/prefs", () => new HttpResponse(null, { status: 500 })));
    render(<FollowUpsControl />);
    const toggle = await screen.findByRole("switch", { name: /follow-up cards/i });

    await user.click(toggle);

    await waitFor(() => expect(toggle).not.toBeChecked());
  });

  test("the category rows are inert until the global switch is on", async () => {
    const user = userEvent.setup();
    render(<FollowUpsControl />);
    const testing = await screen.findByRole("switch", { name: /testing to do/i });
    // Every category is on by default — the coarse switch is what's off, and that's what makes the
    // row unusable rather than the row's own value.
    expect(testing).toBeChecked();
    expect(testing).toBeDisabled();

    await user.click(await screen.findByRole("switch", { name: /follow-up cards/i }));

    await waitFor(() => expect(testing).toBeEnabled());
  });

  test("turning one category off POSTs the remaining list, and leaves the global alone", async () => {
    const user = userEvent.setup();
    prefs.autoFollowUps = true;
    render(<FollowUpsControl />);
    const testing = await screen.findByRole("switch", { name: /testing to do/i });

    await user.click(testing);

    await waitFor(() =>
      expect(lastBody).toEqual({ followUpCategories: ["feature", "bug", "docs", "chore"] }),
    );
    await waitFor(() => expect(testing).not.toBeChecked());
    expect(screen.getByRole("switch", { name: /missing feature/i })).toBeChecked();
    expect(screen.getByRole("switch", { name: /follow-up cards/i })).toBeChecked();
  });
});
