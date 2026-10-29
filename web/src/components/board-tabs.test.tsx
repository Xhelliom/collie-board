import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { __setListedRepos } from "@/lib/listed-repos";
import { server } from "@/test/setup";

import { BoardTabs, boardTabFor } from "./board-tabs";

describe("BoardTabs", () => {
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
    expect(screen.getByRole("link", { name: "Board" })).toHaveAttribute("href", "/board?repo=%2Fr%2Fapp");
    expect(screen.getByRole("link", { name: "Open PRs" })).toHaveAttribute("href", "/board/prs?repo=%2Fr%2Fapp");
  });

  it("switches the repo from any of the views, keeping the view and not stacking history", async () => {
    const router = createMemoryRouter(
      [{ path: "*", element: <BoardTabs repos={[{ path: "/r/app", name: "app" }, { path: "/r/web", name: "web" }]} /> }],
      { initialEntries: ["/board/project?repo=%2Fr%2Fapp"] },
    );
    render(<RouterProvider router={router} />);
    const select = screen.getByRole("combobox", { name: "Repository" });
    expect(select).toHaveValue("/r/app");
    await userEvent.selectOptions(select, "/r/web");
    expect(router.state.location.pathname).toBe("/board/project");
    expect(router.state.location.search).toBe("?repo=%2Fr%2Fweb");
    expect(router.state.historyAction).toBe("REPLACE");
    await userEvent.selectOptions(select, "");
    expect(router.state.location.search).toBe("");
  });

  it("offers the repos with cards and the ones listed by hand — not every repo the bridge knows", async () => {
    __setListedRepos(["/r/grive"]);
    const router = createMemoryRouter([{ path: "*", element: <BoardTabs repos={[{ path: "/r/app", name: "app" }]} /> }], {
      initialEntries: ["/board/project"],
    });
    render(<RouterProvider router={router} />);
    const select = screen.getByRole("combobox", { name: "Repository" });
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["All repos", "app", "grive"]);
    await userEvent.selectOptions(select, "/r/grive");
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
    const router = createMemoryRouter([{ path: "*", element: <BoardTabs repos={[{ path: "/r/app", name: "app" }]} /> }], {
      initialEntries: ["/board"],
    });
    render(<RouterProvider router={router} />);
    await userEvent.click(screen.getByRole("button", { name: "Add a project" }));
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
    render(<RouterProvider router={createMemoryRouter([{ path: "*", element: <BoardTabs repos={[{ path: "/r/app", name: "app" }]} /> }], { initialEntries: ["/board/project?repo=%2Fr%2Fgrive"] })} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove from the list" }));
    expect(posted).toEqual({ path: "/r/grive", listed: false });
    expect(await screen.findByRole("button", { name: "Add a project" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove from the list" })).toBeNull();
  });
});
