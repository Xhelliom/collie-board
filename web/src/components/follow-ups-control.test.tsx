import { beforeEach, describe, expect, test } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { FollowUpsControl } from "@/components/follow-ups-control";

// The board-wide follow-up switch. Driven through MSW: the GET seeds it, the POST echoes back what
// it stored, and a failing POST must leave the switch where it started.

let lastBody: Record<string, unknown> | undefined;
let autoFollowUps: boolean;

beforeEach(() => {
  lastBody = undefined;
  autoFollowUps = false;
  server.use(
    http.get("/api/board/prefs", () => HttpResponse.json({ autoFollowUps })),
    http.post("/api/board/prefs", async ({ request }) => {
      lastBody = (await request.json()) as Record<string, unknown>;
      autoFollowUps = lastBody.autoFollowUps as boolean;
      return HttpResponse.json({ autoFollowUps });
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
});
