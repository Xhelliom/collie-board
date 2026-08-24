import { http, HttpResponse } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { server } from "@/test/setup";
import type { ClaudeUsage } from "@/lib/board";
import { UsageGauge } from "./usage-gauge";

/** The bridge's reading, as `/api/board/usage` serves it. */
const usage = (sessionPct: number) => ({
  usage: {
    limits: [
      { label: "Current session", percent: sessionPct, resetsAt: "Aug 24, 11:59am (Europe/Paris)" },
      { label: "Current week (all models)", percent: 15, resetsAt: null },
    ],
    checkedAt: 1_000,
  },
});

function serve(body: { usage: ClaudeUsage | null }, seen?: URL[]) {
  server.use(
    http.get("/api/board/usage", ({ request }) => {
      seen?.push(new URL(request.url));
      return HttpResponse.json(body);
    }),
  );
}

describe("UsageGauge", () => {
  it("collapses to the limit that decides — the closest one to its wall", async () => {
    serve(usage(53));
    render(<UsageGauge />);

    // 53% used, shown as 53% (the direction every other bar on the screen runs).
    expect(await screen.findByText("53%")).toBeInTheDocument();
    // The other limit is the tap's job, not the resting line's.
    expect(screen.queryByText("15%")).not.toBeInTheDocument();
  });

  it("shows every limit once expanded", async () => {
    serve(usage(53));
    render(<UsageGauge />);
    await screen.findByText("53%");

    await userEvent.click(screen.getByRole("button", { name: /show every quota limit/i }));

    expect(await screen.findByText("15%")).toBeInTheDocument();
    expect(screen.getByText(/resets Aug 24/)).toBeInTheDocument();
  });

  it("opens itself past the critical threshold instead of waiting for the tap", async () => {
    serve(usage(91));
    render(<UsageGauge />);

    // Twice over: the collapsed line's summary, and the session row it opened by itself.
    expect(await screen.findAllByText("91%")).toHaveLength(2);
    expect(screen.getByText("15%")).toBeInTheDocument(); // expanded with no interaction
    expect(screen.getByText(/at the limit/i)).toBeInTheDocument();
  });

  it("can still be dismissed when critical — it escalates, it doesn't trap", async () => {
    serve(usage(91));
    render(<UsageGauge />);
    await screen.findAllByText("91%");

    await userEvent.click(screen.getByRole("button", { name: /hide the quota detail/i }));

    expect(screen.queryByText("15%")).not.toBeInTheDocument();
    expect(screen.getAllByText("91%")).toHaveLength(1); // the summary survives the dismissal
  });

  it("refetches past the bridge cache when the refresh control is tapped", async () => {
    const seen: URL[] = [];
    serve(usage(53), seen);
    render(<UsageGauge />);
    await screen.findByText("53%");
    expect(seen[0]?.searchParams.get("refresh")).toBeNull();

    serve(usage(60), seen);
    await userEvent.click(screen.getByRole("button", { name: /refresh/i }));

    expect(await screen.findByText("60%")).toBeInTheDocument();
    expect(seen[1]?.searchParams.get("refresh")).toBe("1");
  });

  it("renders nothing when the bridge has no reading", async () => {
    serve({ usage: null });
    const { container } = render(<UsageGauge />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
