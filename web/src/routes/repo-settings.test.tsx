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
    http.get("*/api/orchestrator/autonomy", () => HttpResponse.json({ autonomy: { enabled: false, maxChain: 1, stopOnRed: true, maxRounds: 5 } })),
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

  it("sets the rounds before calling me, autonomy off, within 1 to 15", async () => {
    const sent: unknown[] = [];
    server.use(
      http.put("*/api/orchestrator/autonomy", async ({ request }) => {
        const body = (await request.json()) as { maxRounds: number };
        sent.push(body);
        return HttpResponse.json({ autonomy: { enabled: false, maxChain: 1, stopOnRed: true, maxRounds: body.maxRounds } });
      }),
    );
    mount("/board/settings?repo=%2Fr%2Fnew");
    const input = await screen.findByLabelText("Rounds before calling me");
    expect(input).toHaveValue(5);
    expect(input).toBeEnabled();
    await userEvent.clear(input);
    await userEvent.type(input, "16");
    await userEvent.clear(input);
    await userEvent.type(input, "8");
    await screen.findByDisplayValue("8");
    // "1" then "8" are each sent; "16" and an empty field never are.
    expect(sent).toEqual([{ repoPath: "/r/new", maxRounds: 1 }, { repoPath: "/r/new", maxRounds: 8 }]);
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
