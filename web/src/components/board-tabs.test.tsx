import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { __setListedRepos } from "@/lib/listed-repos";
import { server } from "@/test/setup";

import { BoardTabs, RepoTitle, boardTabFor, fold, visibleTabs } from "./board-tabs";

const openPicker = async () => {
  await userEvent.click(screen.getByRole("button", { name: /^Repository,/ }));
  return screen.findByRole("combobox", { name: "Search a project" });
};
const choose = async (name: string) => {
  await openPicker();
  await userEvent.click(screen.getByRole("option", { name }));
};

describe("BoardTabs and RepoTitle", () => {
  it("knows which view it is on", () => {
    expect(boardTabFor("/board")).toBe("board");
    expect(boardTabFor("/board/project")).toBe("project");
    expect(boardTabFor("/board/prs")).toBe("prs");
    expect(boardTabFor("/board/recette")).toBe("recette");
    expect(boardTabFor("/board/settings")).toBe("settings");
    expect(boardTabFor("/card/x")).toBeNull();
  });

  it("marks the current view and carries the repo to the others", () => {
    render(<RouterProvider router={createMemoryRouter([{ path: "*", element: <BoardTabs /> }], { initialEntries: ["/board/project?repo=%2Fr%2Fapp"] })} />);
    expect(screen.getByRole("link", { name: "Project" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Cards" })).toHaveAttribute("href", "/board?repo=%2Fr%2Fapp");
    expect(screen.getByRole("link", { name: "Open PRs" })).toHaveAttribute("href", "/board/prs?repo=%2Fr%2Fapp");
  });

  it("shows every tab in priority order, each labelled, and no « More » when they all fit", () => {
    render(<RouterProvider router={createMemoryRouter([{ path: "*", element: <BoardTabs /> }], { initialEntries: ["/board/project"] })} />);
    const nav = screen.getByRole("navigation");
    expect([...nav.querySelectorAll("a")].map((a) => a.textContent)).toEqual(["Project", "Cards", "Testing", "Roadmap", "Open PRs", "Documents", "Settings"]);
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
  });

  it("puts what does not fit behind « More », the current tab always shown", () => {
    const w = [80, 80, 80, 80, 80, 80, 80];
    expect(visibleTabs(w, 600, 60, 0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // 300 px: three tabs and « More ».
    expect(visibleTabs(w, 300, 60, 0)).toEqual([0, 1, 2]);
    // The current one, past the shown, takes the last place.
    expect(visibleTabs(w, 300, 60, 5)).toEqual([0, 1, 5]);
    expect(visibleTabs(w, 300, 60, 1)).toEqual([0, 1, 2]);
    expect(visibleTabs(w, 300, 60, -1)).toEqual([0, 1, 2]);
  });

  it("switches the repo from any of the views, keeping the view and not stacking history", async () => {
    const router = createMemoryRouter(
      [{ path: "*", element: <RepoTitle repos={[{ path: "/r/app", name: "app" }, { path: "/r/web", name: "web" }]} /> }],
      { initialEntries: ["/board/project?repo=%2Fr%2Fapp"] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByRole("button", { name: "Repository, app" })).toBeInTheDocument();
    await choose("web");
    expect(router.state.location.pathname).toBe("/board/project");
    expect(router.state.location.search).toBe("?repo=%2Fr%2Fweb");
    expect(router.state.historyAction).toBe("REPLACE");
    await choose("All projects");
    expect(router.state.location.search).toBe("");
  });

  it("offers the repos with cards and the ones listed by hand — not every repo the bridge knows", async () => {
    __setListedRepos(["/r/grive"]);
    const router = createMemoryRouter([{ path: "*", element: <RepoTitle repos={[{ path: "/r/app", name: "app" }]} /> }], {
      initialEntries: ["/board/project"],
    });
    render(<RouterProvider router={router} />);
    await openPicker();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["All projects", "app", "grive", "Add a project…"]);
    await userEvent.click(screen.getByRole("option", { name: "grive" }));
    expect(router.state.location.search).toBe("?repo=%2Fr%2Fgrive");
  });

  it("adds a known repo to the list and opens its project", async () => {
    __setListedRepos(["/r/grive"]);
    let posted: unknown;
    server.use(
      http.get("/api/repos", () =>
        HttpResponse.json({
          repos: [
            { path: "/r/app", name: "app", source: "card" },
            { path: "/r/grive", name: "grive", source: "herd", listed: true },
            { path: "/r/scan", name: "scan", source: "scan" },
          ],
          hiddenCount: 0,
        }),
      ),
      http.post("/api/repos/listed", async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ ok: true, paths: ["/r/grive", "/r/scan"] });
      }),
    );
    const router = createMemoryRouter([{ path: "*", element: <RepoTitle repos={[{ path: "/r/app", name: "app" }]} /> }], {
      initialEntries: ["/board"],
    });
    render(<RouterProvider router={router} />);
    await choose("Add a project…");
    await userEvent.click(await screen.findByRole("button", { name: /\/r\/scan/ }));
    expect(screen.queryByRole("button", { name: /\/r\/grive/ })).toBeNull();
    expect(posted).toEqual({ path: "/r/scan", listed: true });
    expect(router.state.location.pathname).toBe("/board/project");
    expect(router.state.location.search).toBe("?repo=%2Fr%2Fscan");
  });

  it("removes a hand-listed repo from the list", async () => {
    __setListedRepos(["/r/grive"]);
    let posted: unknown;
    server.use(
      http.post("/api/repos/listed", async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ ok: true, paths: [] });
      }),
    );
    render(<RouterProvider router={createMemoryRouter([{ path: "*", element: <RepoTitle repos={[{ path: "/r/app", name: "app" }]} /> }], { initialEntries: ["/board/project?repo=%2Fr%2Fgrive"] })} />);
    await choose("Remove from the list");
    expect(posted).toEqual({ path: "/r/grive", listed: false });
    await waitFor(() => expect(screen.queryByRole("option", { name: "Remove from the list" })).toBeNull());
  });

  it("filters as you type, ignoring case and accents, and picks with the arrows and Enter", async () => {
    expect(fold("Écran Été")).toBe("ecran ete");
    const router = createMemoryRouter(
      [{ path: "*", element: <RepoTitle repos={[{ path: "/r/ecran", name: "Écran" }, { path: "/r/eclair", name: "eclair" }, { path: "/r/web", name: "web" }]} /> }],
      { initialEntries: ["/board/prs"] },
    );
    render(<RouterProvider router={router} />);
    const input = await openPicker();
    expect(input).toHaveFocus();
    await userEvent.type(input, "ECR");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Écran", "Add a project…"]);
    await userEvent.clear(input);
    await userEvent.type(input, "écl");
    expect(input).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { name: "eclair" }).id);
    await userEvent.keyboard("{ArrowDown}{ArrowUp}");
    expect(screen.getByRole("option", { name: "eclair" })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Enter}");
    expect(router.state.location.pathname).toBe("/board/prs");
    expect(router.state.location.search).toBe("?repo=%2Fr%2Feclair");
  });

  it("closes on Escape without changing project", async () => {
    const router = createMemoryRouter([{ path: "*", element: <RepoTitle repos={[{ path: "/r/app", name: "app" }]} /> }], { initialEntries: ["/board?repo=%2Fr%2Fapp"] });
    render(<RouterProvider router={router} />);
    await openPicker();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    expect(router.state.location.search).toBe("?repo=%2Fr%2Fapp");
  });
});
