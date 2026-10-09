import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import type { CardView } from "@/lib/board";
import type { BoardData } from "@/lib/board-loaders";
import { ProjectRoute } from "./project";

const card = (o: Partial<CardView> & { id: string }): CardView =>
  ({ title: o.id, status: "backlog", acceptance: [], parentId: null, dependsOn: null, position: 0, createdAt: 0, repoPath: "/r/app", ...o }) as CardView;

function mount(cards: CardView[], url = "/board/project?repo=%2Fr%2Fapp") {
  const data: BoardData = { cards, error: false, authError: false };
  const router = createMemoryRouter(
    [
      { path: "/board/project", loader: () => data, element: <ProjectRoute /> },
      { path: "/board", element: <p>board</p> },
    ],
    { initialEntries: [url] },
  );
  render(<RouterProvider router={router} />);
}

describe("ProjectRoute", () => {
  it("shows the phases, the progress and what waits for you", async () => {
    mount([
      card({ id: "Phase one" }),
      card({ id: "a", parentId: "Phase one", status: "done" }),
      card({ id: "b", parentId: "Phase one", status: "blocked" }),
      card({ id: "other", repoPath: "/r/else", status: "done" }),
    ]);
    expect((await screen.findAllByText("Phase one")).length).toBeGreaterThan(0);
    expect(await screen.findByText("50%", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText(/1 waiting for you/i)).toBeTruthy();
    expect(screen.queryByText("other")).toBeNull();
  });

  it("filters the steps by what they are doing, and remembers it", async () => {
    mount([card({ id: "a", status: "done" }), card({ id: "b", status: "ready" })]);
    await screen.findByText("a");
    await userEvent.click(screen.getByRole("button", { name: /^done/ }));
    expect(document.getElementById("step-b")).toBeNull();
    expect(document.getElementById("step-a")).not.toBeNull();
  });

  it("says so when the repo has no cards", async () => {
    mount([]);
    expect(await screen.findByText(/no cards in this repo/i)).toBeTruthy();
  });
});
