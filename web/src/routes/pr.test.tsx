import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { server } from "@/test/setup";
import { PrRoute } from "./pr";
import { setPreference } from "@/i18n";
import type { PrDetail } from "@/lib/board";
import type { PrSheetData } from "@/lib/board-loaders";

beforeEach(() => setPreference("en"));

const detail = (over: Partial<PrDetail> = {}): PrDetail => ({
  number: 7,
  title: "Fix the thing",
  body: "## Why\n\nbecause **reasons** <script>alert(1)</script>",
  author: "ana",
  createdAt: Date.now() - 3_600_000,
  updatedAt: null,
  base: "main",
  head: "board/fix",
  state: "open",
  mergeable: true,
  conflicting: false,
  isDraft: false,
  url: "https://github.com/o/r/pull/7",
  card: { id: "c1", title: "The card" },
  modes: [],
  blocker: null,
  checks: [],
  files: [{ path: "src/a.ts", additions: 3, deletions: 1 }],
  diff: "diff --git a/src/a.ts b/src/a.ts\n+added line\n-removed line",
  diffTruncated: false,
  ...over,
});

function mount(data: PrSheetData) {
  const router = createMemoryRouter(
    [
      { path: "/board/prs/:number", loader: () => data, element: <PrRoute /> },
      { path: "/board/prs", element: <p>list</p> },
      { path: "/card/:cardId", element: <p>card screen</p> },
    ],
    { initialEntries: ["/board/prs/7?repo=%2Frepo"] },
  );
  render(<RouterProvider router={router} />);
}

describe("PrRoute", () => {
  it("shows title, state, author, branches, card, description, files and the diff", async () => {
    mount({ repo: "/repo", number: "7", detail: detail(), error: null });
    expect(await screen.findByRole("heading", { name: "Fix the thing" })).toBeTruthy();
    expect(screen.getByText("Mergeable")).toBeTruthy();
    expect(screen.getByText(/by ana/)).toBeTruthy();
    expect(screen.getByText("board/fix into main")).toBeTruthy();
    expect(screen.getByRole("link", { name: /the card/i })).toHaveAttribute("href", "/card/c1");
    expect(screen.getByText(/reasons/)).toBeTruthy();
    // A <script> in the description is text, never markup.
    expect(document.querySelector("script[src], main script")).toBeNull();
    expect(screen.getByText("src/a.ts")).toBeTruthy();
    expect(screen.getByText("+3")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /show the diff/i }));
    expect(screen.getByText("+added line")).toBeTruthy();
  });

  it("offers Merge and Close, and Open on GitHub in the ⋯", async () => {
    mount({ repo: "/repo", number: "7", detail: detail(), error: null });
    expect(await screen.findByRole("button", { name: /^merge$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^close$/i })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.getByRole("menuitem", { name: /open on github/i })).toHaveAttribute("href", "https://github.com/o/r/pull/7");
  });

  it("disables Merge on a conflicting PR and says why before the tap", async () => {
    mount({ repo: "/repo", number: "7", detail: detail({ conflicting: true, mergeable: false, blocker: "conflict" }), error: null });
    expect(await screen.findByText("Can't merge: it conflicts with main.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^merge$/i })).toBeDisabled();
  });

  it("names the red check that blocks the merge", async () => {
    const checks = [{ name: "build", state: "failure" as const, startedAt: 0, completedAt: 1, url: "", runId: null }];
    mount({ repo: "/repo", number: "7", detail: detail({ checks, blocker: "red" }), error: null });
    expect(await screen.findByText("Can't merge: build failed.")).toBeTruthy();
  });

  it("offers the modes the repo allows, the first preselected, and merges with the one picked", async () => {
    const calls: unknown[] = [];
    server.use(http.post("*/api/board/prs/merge", async ({ request }) => (calls.push(await request.json()), HttpResponse.json({ ok: true }))));
    mount({ repo: "/repo", number: "7", detail: detail({ modes: ["squash", "rebase"], card: null }), error: null });
    expect(await screen.findByRole("radio", { name: "Squash" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: "Merge commit" })).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "Rebase" }));
    await userEvent.click(screen.getByRole("button", { name: /^merge$/i }));
    await screen.findByText("list");
    expect(calls).toEqual([{ repo: "/repo", number: 7, mode: "rebase" }]);
  });

  it("a card's PR merges through the card's integration, with the mode", async () => {
    const calls: unknown[] = [];
    server.use(http.post("*/api/cards/c1/integration", async ({ request }) => (calls.push(await request.json()), HttpResponse.json({ ok: true, card: {} }))));
    mount({ repo: "/repo", number: "7", detail: detail({ modes: ["squash", "rebase"] }), error: null });
    await userEvent.click(await screen.findByRole("radio", { name: "Rebase" }));
    await userEvent.click(screen.getByRole("button", { name: /^merge$/i }));
    await screen.findByText("list");
    expect(calls).toEqual([{ action: "merge", andDone: false, mode: "rebase" }]);
  });

  it("lists the checks, with Re-run on a failure only", async () => {
    const chk = (name: string, state: PrDetail["checks"][number]["state"], runId: string | null = "9") => ({
      name, state, startedAt: 0, completedAt: 65_000, url: "https://github.com/o/r/actions/runs/9", runId,
    });
    mount({ repo: "/repo", number: "7", detail: detail({ checks: [chk("lint", "success"), chk("test", "failure"), chk("e2e", "pending")] }), error: null });
    expect(await screen.findByText("test")).toBeTruthy();
    expect(screen.getByText("lint")).toBeTruthy();
    expect(screen.getAllByText("1m 5s").length).toBe(3);
    expect(screen.getAllByRole("button", { name: /^re-run$/i }).length).toBe(1);
    expect(screen.queryByRole("button", { name: /re-run the failures/i })).toBeNull();
    // The verdict reads the red check, like the list.
    expect(screen.getByText(/test/i, { selector: "span.font-medium" })).toBeTruthy();
  });

  it("shows the error when the PR cannot be read", async () => {
    mount({ repo: "/repo", number: "7", detail: null, error: "boom" });
    expect(await screen.findByText(/could not be read: boom/)).toBeTruthy();
  });
});
