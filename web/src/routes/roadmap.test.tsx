import { act, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { roadmapLoader } from "@/lib/board-loaders";
import { server } from "@/test/setup";

import { RoadmapRoute } from "./roadmap";

const roadmap = (status: string) => ({
  repoPath: "/r/app",
  vision: "Ship it",
  revision: status === "done" ? 2 : 1,
  items: [
    { id: "a", name: "Foundations", goal: "the base", status: "done", detail: "" },
    { id: "b", name: "Autonomy", goal: "", status, detail: "## Demo\nIt runs alone" },
  ],
  decisions: [{ id: "d1", text: "Self-hosted first", status: "decided", itemId: null }],
});

describe("live roadmap", () => {
  it("renders steps, board phases and decisions, and shows a new revision on the next poll", async () => {
    let current = roadmap("active");
    server.use(
      http.get("/api/roadmap", () => HttpResponse.json({ roadmap: current })),
      http.get("/api/phases", () => HttpResponse.json({ phases: [{ id: "p", repoPath: "/r/app", name: "Lot 1", goal: "", position: 0, roadmapItemId: "b", closedAt: 1 }] })),
      http.get("/api/docs/pages", () => HttpResponse.json({ ref: "main", pages: [{ name: "roadmap", size: 1 }] })),
    );
    const router = createMemoryRouter([{ path: "/board/roadmap", loader: roadmapLoader, element: <RoadmapRoute /> }], {
      initialEntries: ["/board/roadmap?repo=%2Fr%2Fapp"],
    });
    render(<RouterProvider router={router} />);
    expect(await screen.findByText("1 of 2 step done · 1 active")).toBeInTheDocument();
    expect(screen.getByText("Lot 1")).toBeInTheDocument();
    expect(screen.getByText("Self-hosted first")).toBeInTheDocument();
    // The static export's tab gives way to the live one.
    expect(screen.queryByRole("link", { name: "roadmap" })).toBeNull();

    current = roadmap("done");
    await act(() => router.revalidate());
    expect(await screen.findByText("2 of 2 steps done · 0 active")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "100% done" })).toBeInTheDocument();
  });
});
