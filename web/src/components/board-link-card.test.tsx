import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test } from "vitest";

import { BoardLinkCard } from "./board-link-card";
import { ROOT_ROUTE_ID } from "@/lib/loaders";

const pane = (over: object) => ({ paneId: "t1", agent: "claude", status: "idle", cwd: "/home/u/git/boarding-pass", workspaceId: "hc", workspaceLabel: "hc", ...over });

function show(agent: object) {
  const router = createMemoryRouter([
    { id: ROOT_ROUTE_ID, path: "/", loader: () => ({ agents: [agent] }), element: <BoardLinkCard link={{ kind: "pane", id: "t1", path: "/pane/t1" }} label="x" />, HydrateFallback: () => null },
  ]);
  render(<RouterProvider router={router} />);
}

test("under hc the agent tile names the repo, not hc's one space", async () => {
  show(pane({}));
  expect(await screen.findByText("boarding-pass")).toBeInTheDocument();
  expect(screen.queryByText("hc")).toBeNull();
});

test("under herdr 0.9 the tile keeps the workspace label", async () => {
  show(pane({ workspaceId: "w1", workspaceLabel: "my-space" }));
  expect(await screen.findByText("my-space")).toBeInTheDocument();
});
