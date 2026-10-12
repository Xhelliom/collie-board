import { http, HttpResponse } from "msw";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { server } from "@/test/setup";
import { MemoryRouter } from "react-router";
import type { DashboardView } from "@/lib/dashboard";
import { HomeActivity, HomeHero, HomeKpis, OpenPrs, UsageRings } from "./home-dashboard";

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

describe("HomeKpis", () => {
  it("leads each figure to the board, filtered on its status", () => {
    render(<MemoryRouter><HomeKpis dash={dash} /></MemoryRouter>);
    const href = (name: RegExp) => screen.getByRole("link", { name }).getAttribute("href");
    expect(href(/to review/i)).toBe("/board?status=review");
    expect(href(/stuck/i)).toBe("/board?status=blocked%2Corphaned");
    expect(href(/ready/i)).toBe("/board?status=ready");
    expect(href(/delivered/i)).toBe("/board?status=done");
  });

  it("names the object — these are cards, not panes — and drops the redundant notes", () => {
    render(<MemoryRouter><HomeKpis dash={dash} /></MemoryRouter>);
    expect(screen.getByText("Cards")).toBeInTheDocument();
    expect(screen.queryByText("can start now")).not.toBeInTheDocument();
  });
});

describe("HomeHero", () => {
  it("does not repeat the review count the KPI already shows", () => {
    render(<HomeHero agents={[]} />);
    expect(screen.queryByText(/to review/i)).not.toBeInTheDocument();
  });
});

describe("HomeActivity", () => {
  it("is titled as the alerts it lists", async () => {
    server.use(http.get("/api/notifications/log", () => HttpResponse.json({ entries: [] })));
    render(<MemoryRouter><HomeActivity session={undefined} /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Latest alerts" })).toBeInTheDocument();
    expect(await screen.findByText("Nothing yet.")).toBeInTheDocument();
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
