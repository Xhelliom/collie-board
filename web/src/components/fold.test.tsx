import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";

import { server } from "@/test/setup";
import type { AgentView } from "@/lib/types";
import type { RepoTile } from "@/lib/dashboard";
import { AgentList } from "./agent-list";
import { CardDiff } from "./card-diff";
import { ProjectTiles } from "./home-dashboard";

const idle = (n: number): AgentView[] =>
  Array.from({ length: n }, (_, i) => ({
    paneId: `w1:p${i}`, workspaceId: "w1", workspaceLabel: `ws${i}`, workspaceNumber: 1, tabId: "w1:t1",
    agent: "claude", status: "idle", cwd: "/r", focused: false, kind: "agent",
  }) as AgentView);

const repo = (i: number, phases = 0): RepoTile => ({
  path: `/r/${i}`, name: `repo${i}`, active: 0, waiting: 0, closedCount: 0, updatedAt: 1,
  current: Array.from({ length: phases }, (_, k) => ({ key: `p${k}`, title: `phase${k}`, done: 0, steps: [] })),
});

describe("count folds", () => {
  it("Idle · done lists 4, then the rest on a tap", async () => {
    render(<AgentList agents={idle(10)} onOpen={() => {}} />);
    expect(screen.getAllByRole("button", { name: /ws\d/ })).toHaveLength(4);
    await userEvent.click(screen.getByRole("button", { name: "Show 6 more" }));
    expect(screen.getAllByRole("button", { name: /ws\d/ })).toHaveLength(10);
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");
  });

  it("a short list shows no toggle", () => {
    render(<AgentList agents={idle(3)} onOpen={() => {}} />);
    expect(screen.queryByRole("button", { name: /Show/ })).toBeNull();
  });

  it("Projects: 3 tiles then a count; a tile lists 2 phases then +n", async () => {
    render(<MemoryRouter><ProjectTiles repos={[repo(0, 5), repo(1), repo(2), repo(3), repo(4)]} /></MemoryRouter>);
    expect(screen.getAllByText(/^repo\d$/)).toHaveLength(3);
    expect(screen.getByText("phase1")).toBeInTheDocument();
    expect(screen.queryByText("phase2")).toBeNull();
    expect(screen.getByText("+3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
    expect(screen.getAllByText(/^repo\d$/)).toHaveLength(5);
  });

  it("the diff lists 8 files then a count", async () => {
    const files = Array.from({ length: 57 }, (_, i) => ({ path: `src/f${i}.ts`, added: 1, removed: 0, kind: "text" }));
    server.use(http.get("/api/cards/c1/diff", () => HttpResponse.json({ ok: true, base: "b", cwd: "/w", files, added: 57, removed: 0 })));
    render(<CardDiff cardId="c1" statusKey="review" />);
    expect(await screen.findByText("src/f0.ts")).toBeInTheDocument();
    expect(screen.queryByText("src/f8.ts")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Show 49 more" }));
    expect(screen.getByText("src/f56.ts")).toBeInTheDocument();
  });
});
