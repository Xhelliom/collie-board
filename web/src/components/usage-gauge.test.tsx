import { http, HttpResponse } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { server } from "@/test/setup";
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

function serve(body: unknown, seen?: URL[]) {
  server.use(
    http.get("/api/board/usage", ({ request }) => {
      seen?.push(new URL(request.url));
      return HttpResponse.json(body);
    }),
  );
}

describe("UsageGauge", () => {
  it("shows what's LEFT of each limit, not what's used", async () => {
    serve(usage(53));
    render(<UsageGauge />);

    // 53% used → 47% left; 15% used → 85% left.
    expect(await screen.findByText("47%")).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument();
    expect(screen.getByText(/resets Aug 24/)).toBeInTheDocument();
  });

  it("refetches past the bridge cache when the refresh control is tapped", async () => {
    const seen: URL[] = [];
    serve(usage(53), seen);
    render(<UsageGauge />);
    await screen.findByText("47%");
    expect(seen[0]?.searchParams.get("refresh")).toBeNull();

    serve(usage(60), seen);
    await userEvent.click(screen.getByRole("button", { name: /refresh/i }));

    expect(await screen.findByText("40%")).toBeInTheDocument();
    expect(seen[1]?.searchParams.get("refresh")).toBe("1");
  });

  it("renders nothing when the bridge has no reading", async () => {
    serve({ usage: null });
    const { container } = render(<UsageGauge />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
