import { http, HttpResponse } from "msw";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { server } from "@/test/setup";
import { UsageRings } from "./home-dashboard";

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
