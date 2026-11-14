import { http, HttpResponse } from "msw";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { server } from "@/test/setup";
import { MemoryRouter } from "react-router";
import type { DashboardView } from "@/lib/dashboard";
import type { RepoTile } from "@/lib/dashboard";
import type { AgentView } from "@/lib/types";
import { CardsLine, HomeHero, Machines, machinesOf, OpenPrs, ProjectRows, UsageRings } from "./home-dashboard";

const dash = { review: 2, stuck: 3, ready: 1, delivered: 4, repos: [] } as unknown as DashboardView;

const claude = {
  id: "claude",
  label: "Claude Code",
  checkedAt: 1_000,
  limits: [
    { label: "Current session", percent: 53, resetsAt: "Aug 24, 11:59am (Europe/Paris)" },
    { label: "Current week (all models)", percent: 15, resetsAt: null },
  ],
};

describe("UsageRings", () => {
  it("draws one ring per provider, at the limit closest to its wall", async () => {
    server.use(http.get("/api/board/usage", () => HttpResponse.json({ usage: claude, providers: [claude, { ...claude, id: "other", label: "Other", limits: [{ label: "Current session", percent: 90, resetsAt: null }] }] })));
    render(<UsageRings />);
    expect(await screen.findByText("53%")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.queryByText("15%")).not.toBeInTheDocument();
  });

  it("lists every limit on a tap", async () => {
    server.use(http.get("/api/board/usage", () => HttpResponse.json({ usage: claude, providers: [claude] })));
    render(<UsageRings />);
    await userEvent.click(await screen.findByRole("button", { name: /claude code/i }));
    expect(await screen.findByText("15%")).toBeInTheDocument();
  });

  it("falls back to the legacy single reading from an older bridge", async () => {
    server.use(http.get("/api/board/usage", () => HttpResponse.json({ usage: claude })));
    render(<UsageRings />);
    expect(await screen.findByText("53%")).toBeInTheDocument();
  });

  it("renders nothing without a reading", async () => {
    server.use(http.get("/api/board/usage", () => HttpResponse.json({ usage: null, providers: [] })));
    const { container } = render(<UsageRings />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });
});

describe("CardsLine", () => {
  it("says the waiting cards as a sentence of links to the filtered board, skipping what is at zero", () => {
    render(<MemoryRouter><CardsLine dash={{ ...dash, ready: 0 }} /></MemoryRouter>);
    const href = (name: RegExp) => screen.getByRole("link", { name }).getAttribute("href");
    expect(href(/2 cards to review/)).toBe("/board?status=review");
    expect(href(/3 stuck/)).toBe("/board?status=blocked%2Corphaned");
    expect(screen.queryByText(/ready/)).toBeNull();
  });
});

const ag = (status: AgentView["status"]): AgentView => ({ paneId: status, workspaceId: "w", workspaceLabel: "w", workspaceNumber: 1, tabId: "t", agent: "claude", status, cwd: "/r", focused: false, kind: "agent" });

describe("HomeHero", () => {
  it("titles the screen with the herd's state, and rings who works out of all", () => {
    render(<HomeHero agents={[ag("working"), ag("working"), ag("idle")]} cards={null} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Nothing needs you, 2 agents are working");
    expect(screen.getByRole("img", { name: "2 working out of 3" })).toHaveTextContent("of 3");
  });

  it("leads with who waits", () => {
    render(<HomeHero agents={[ag("blocked"), ag("idle")]} cards={null} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("1 agent needs you, all at rest");
  });
});

const repo = (i: number, extra: Partial<RepoTile> = {}): RepoTile => ({
  path: `/r/${i}`, name: `repo${i}`, active: 0, waiting: 0, blocked: 0, closedCount: 0, updatedAt: 1, current: [], ...extra,
});

describe("ProjectRows", () => {
  it("puts the projects where something runs first, five rows, the rest behind « All projects »", async () => {
    render(<MemoryRouter><ProjectRows repos={[0, 1, 2, 3, 4, 5].map((i) => repo(i, i === 4 ? { active: 2 } : {}))} /></MemoryRouter>);
    expect(screen.getAllByText(/^repo\d$/).map((e) => e.textContent)).toEqual(["repo4", "repo0", "repo1", "repo2", "repo3"]);
    await userEvent.click(screen.getByRole("button", { name: "All projects (6)" }));
    expect(screen.getAllByText(/^repo\d$/)).toHaveLength(6);
  });

  it("shows the objective with its budget, the current phase and the activity", () => {
    const step = { id: "s", status: "done" } as never;
    render(
      <MemoryRouter>
        <ProjectRows
          repos={[repo(0, { waiting: 1, blocked: 1, current: [{ key: "p", title: "Fortress", done: 1, steps: [step, { id: "t", status: "working" } as never] }] }), repo(1)]}
          goals={{ "/r/0": { status: "active", text: "Hold the siege. Then more.", lots: 2, maxLots: 10, pct: 68 } }}
          toTest={{ "/r/0": 3 }}
        />
      </MemoryRouter>,
    );
    const row = screen.getByText("repo0").closest("a")!;
    expect(row.querySelector("[data-goal]")).toHaveTextContent("Hold the siege.");
    expect(row.querySelector("[data-goal]")).not.toHaveTextContent("Then more");
    expect(row.querySelector("[data-goal] svg")).toHaveClass("text-status-done");
    expect(row).toHaveTextContent("lot 2 of 10, budget 68 %");
    expect(row).toHaveTextContent("Fortress");
    expect(row).toHaveTextContent("1 of 2");
    expect(row).toHaveTextContent("1 for you");
    expect(row).toHaveTextContent("1 stuck");
    expect(row).toHaveTextContent("3 to test");
    expect(screen.getByText("repo1").closest("a")).toHaveTextContent("No objective");
  });
});

describe("ProjectRow signal", () => {
  it("bars a running lot's project in blue with the lot's name, rests the idle one, keeps the waiting one orange", () => {
    const running = { name: "Siege", done: 1, total: 3, blocked: 0, finishedAt: null };
    render(
      <MemoryRouter>
        <ProjectRows repos={[repo(0), repo(1), repo(2, { waiting: 1 })]} lots={{ "/r/0": running, "/r/2": running }} />
      </MemoryRouter>,
    );
    const row = (n: number) => screen.getByText(`repo${n}`).closest("a")!;
    expect(row(0).querySelector("[data-signal]")).toHaveAttribute("data-signal", "working");
    expect(row(0)).toHaveTextContent("Lot: Siege");
    expect(row(1).querySelector("[data-signal]")).toBeNull();
    expect(row(2).querySelector("[data-signal]")).toHaveAttribute("data-signal", "blocked");
  });
});

describe("Machines", () => {
  it("lists this machine and every peer, an unreachable one in words", () => {
    const peers = [
      { peer: "dev", state: "connected" as const, error: null, agents: [ag("idle")], engine: { engine: "herdr09" as const, hc: null } },
      { peer: "dell", state: "disconnected" as const, error: "timeout", agents: [] },
    ];
    render(<Machines machines={machinesOf({ bridge: "connected", engine: { engine: "hc", hc: null }, agents: 22 }, peers, "This PC")} />);
    expect(screen.getByText("This PC").parentElement).toHaveTextContent("herdr-core, 22 agents");
    expect(screen.getByText("dev").parentElement).toHaveTextContent("herdr 0.9, 1 agent");
    expect(screen.getByText("dell").parentElement).toHaveTextContent("unreachable");
  });
});

describe("OpenPrs", () => {
  it("shows the count with its link, and nothing at zero", async () => {
    server.use(http.get("/api/board/prs", () => HttpResponse.json({ prs: [{}, {}] })));
    const { unmount } = render(<MemoryRouter><OpenPrs /></MemoryRouter>);
    expect(await screen.findByRole("link", { name: /open prs/i })).toHaveTextContent("2");
    unmount();
    server.use(http.get("/api/board/prs", () => HttpResponse.json({ prs: [] })));
    const { container } = render(<MemoryRouter><OpenPrs /></MemoryRouter>);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });
});
