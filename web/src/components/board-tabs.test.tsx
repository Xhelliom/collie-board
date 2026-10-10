import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { BoardTabs, boardTabFor } from "./board-tabs";

describe("BoardTabs", () => {
  it("knows which view it is on", () => {
    expect(boardTabFor("/board")).toBe("board");
    expect(boardTabFor("/board/project")).toBe("project");
    expect(boardTabFor("/board/prs")).toBe("prs");
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
});
