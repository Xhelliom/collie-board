import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { checkSummary, prVerdict, PrsRoute } from "./prs";
import type { OpenPr, PrStatus } from "@/lib/board";
import { server } from "@/test/setup";

const status = (over: Partial<PrStatus>): PrStatus => ({
  state: "open",
  url: "https://github.com/o/r/pull/58",
  mergedAt: null,
  conflicting: false,
  mergeable: false,
  ...over,
});

const row = (id: string, pr?: PrStatus | null): OpenPr => ({
  card: { id, title: `card ${id}`, status: "done", repoPath: "/home/me/collie-board", branch: `board/${id}` },
  url: "https://github.com/o/r/pull/58",
  openedAt: Date.now() - 3_600_000,
  ...(pr === undefined ? {} : { pr }),
});

describe("prVerdict — only what GitHub actually said", () => {
  it("never reads UNKNOWN as mergeable", () => {
    expect(prVerdict(status({ mergeable: true }))).toBe("mergeable");
    expect(prVerdict(status({ conflicting: true }))).toBe("conflict");
    expect(prVerdict(status({}))).toBe("pending");
  });

  it("tells an unchecked row from one GitHub could not be asked about", () => {
    expect(prVerdict(undefined)).toBe("unchecked");
    expect(prVerdict(null)).toBe("unknown");
    expect(prVerdict(status({ state: "merged" }))).toBe("merged");
  });

  it("asks for another check only when GitHub was still working one out", () => {
    expect(checkSummary(["conflict", "mergeable", "mergeable"])).toBe("1 conflict · 2 mergeable.");
    expect(checkSummary(["pending"])).toContain("check again in a few seconds");
  });
});

describe("PrsRoute", () => {
  function mount(rows: OpenPr[]) {
    const router = createMemoryRouter(
      [
        { path: "/board/prs", loader: () => rows, element: <PrsRoute /> },
        { path: "/card/:cardId", element: <p>card screen</p> },
      ],
      { initialEntries: ["/board/prs"] },
    );
    render(<RouterProvider router={router} />);
  }

  it("asks GitHub nothing until Check, then says which PR conflicts and offers the reopen", async () => {
    let checked = false;
    server.use(
      http.get("*/api/board/prs", ({ request }) => {
        checked = new URL(request.url).searchParams.get("check") === "1";
        return HttpResponse.json({
          prs: [row("a", status({ conflicting: true })), row("b", status({ state: "merged", mergedAt: Date.now() }))],
        });
      }),
    );
    mount([row("a"), row("b")]);
    await screen.findByText("card a");
    expect(screen.queryByText(/conflicts with its base/i)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /check/i }));
    expect(await screen.findByText(/conflicts with its base/i)).toBeTruthy();
    expect(checked).toBe(true);
    expect(screen.getByRole("button", { name: /reopen with an agent/i })).toBeTruthy();
    // The merged one is said to be leaving, not listed as open.
    expect(screen.getByText(/leaving this list/i)).toBeTruthy();
    expect(screen.getByText(/merged/)).toBeTruthy();
  });

  it("reopens from the list and lands on the card", async () => {
    let sent: unknown = null;
    server.use(
      http.post("*/api/cards/:id/integration", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ ok: true, paneId: "w1:p1" });
      }),
    );
    mount([row("a", status({ conflicting: true }))]);
    await userEvent.click(await screen.findByRole("button", { name: /reopen with an agent/i }));
    expect(await screen.findByText("card screen")).toBeTruthy();
    expect(sent).toMatchObject({ action: "reopen" });
  });
});
