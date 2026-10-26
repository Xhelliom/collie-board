import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { setPreference } from "@/i18n";
import { autonomyPath } from "@/lib/board";
import { server } from "@/test/setup";

import { RepoSettingsRoute } from "./repo-settings";

function mount(url: string) {
  server.use(
    http.get("*/api/orchestrator/autonomy", () => HttpResponse.json({ autonomy: { enabled: false, maxChain: 1, stopOnRed: true } })),
    http.get("*/api/repos", () => HttpResponse.json({ repos: [{ path: "/r/new", gate: "make test" }] })),
  );
  const router = createMemoryRouter([{ path: "/board/settings", element: <RepoSettingsRoute /> }, { path: "/board/prs", element: <p>prs</p> }], {
    initialEntries: [url],
  });
  render(<RouterProvider router={router} />);
}

beforeEach(() => {
  setPreference("en");
  localStorage.clear();
});

describe("RepoSettingsRoute", () => {
  it("shows the repo's settings even when it has no card", async () => {
    mount("/board/settings?repo=%2Fr%2Fnew");
    expect(await screen.findByRole("region", { name: "Autonomy" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /make test/ })).toBeInTheDocument();
  });

  it("asks to pick a repo when none is chosen", () => {
    mount("/board/settings");
    expect(screen.getByText(/Pick a repo/)).toBeInTheDocument();
  });

  it("is a tab next to Open PRs, and the autonomy link lands on it", async () => {
    mount("/board/settings?repo=%2Fr%2Fnew");
    const nav = screen.getByRole("navigation", { name: "Board views" });
    expect(within(nav).getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Open PRs" })).toHaveAttribute("href", "/board/prs?repo=%2Fr%2Fnew");
    expect(autonomyPath("/r/new")).toBe("/board/settings?repo=%2Fr%2Fnew#project-autonomy");
    await userEvent.click(within(nav).getByRole("link", { name: "Open PRs" }));
    expect(await screen.findByText("prs")).toBeInTheDocument();
  });
});
