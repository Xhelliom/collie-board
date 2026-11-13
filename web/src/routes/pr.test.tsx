import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

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

  it("offers no Merge on a conflicting PR, and says why it could not be read", async () => {
    mount({ repo: "/repo", number: "7", detail: detail({ conflicting: true, mergeable: false }), error: null });
    expect(await screen.findByText("Conflicts with its base")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^merge$/i })).toBeNull();
  });

  it("shows the error when the PR cannot be read", async () => {
    mount({ repo: "/repo", number: "7", detail: null, error: "boom" });
    expect(await screen.findByText(/could not be read: boom/)).toBeTruthy();
  });
});
