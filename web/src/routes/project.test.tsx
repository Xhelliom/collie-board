import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import type { CardView } from "@/lib/board";
import type { BoardData } from "@/lib/board-loaders";
import { ProjectRoute } from "./project";

const card = (o: Partial<CardView> & { id: string }): CardView =>
  ({ title: o.id, status: "backlog", parentId: null, dependsOn: null, position: 0, createdAt: 0, repoPath: "/r/app", ...o }) as CardView;

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
    expect(await screen.findByText("Phase one")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText(/waiting for you · 1/i)).toBeTruthy();
    expect(screen.queryByText("other")).toBeNull();
  });

  it("says so when the repo has no cards", async () => {
    mount([]);
    expect(await screen.findByText(/no cards in this repo/i)).toBeTruthy();
  });
});
