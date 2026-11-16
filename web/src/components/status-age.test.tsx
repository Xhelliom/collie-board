import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LOUD_AFTER_MS } from "@/lib/status-age";
import { StatusAge } from "./status-age";

const H = 3_600_000;

describe("StatusAge", () => {
  it("short durations: minutes, hours, days", () => {
    const { rerender } = render(<StatusAge since={Date.now() - 12 * 60_000} signal="idle" />);
    expect(screen.getByText("for 12 min")).toBeInTheDocument();
    rerender(<StatusAge since={Date.now() - 3 * H} signal="idle" />);
    expect(screen.getByText("for 3 h")).toBeInTheDocument();
    rerender(<StatusAge since={Date.now() - 50 * H} signal="idle" />);
    expect(screen.getByText("for 2 d")).toBeInTheDocument();
  });
  it("a lower bound says « over »", () => {
    render(<StatusAge since={Date.now() - 3 * H} atLeast signal="idle" />);
    expect(screen.getByText("for over 3 h")).toBeInTheDocument();
  });
  it("solid orange for a long wait, solid red for a long stuck state, grey otherwise", () => {
    const long = Date.now() - LOUD_AFTER_MS - 60_000;
    const { rerender } = render(<StatusAge since={long} signal="blocked" />);
    expect(screen.getByText(/^for /)).toHaveClass("bg-status-blocked");
    rerender(<StatusAge since={long} signal="stuck" />);
    expect(screen.getByText(/^for /)).toHaveClass("bg-signal-stuck");
    rerender(<StatusAge since={Date.now() - 10 * 60_000} signal="blocked" />);
    expect(screen.getByText(/^for /)).toHaveClass("text-muted-foreground");
    rerender(<StatusAge since={long} signal="working" />);
    expect(screen.getByText(/^for /)).toHaveClass("text-muted-foreground");
  });
  it("nothing without an instant", () => {
    const { container } = render(<StatusAge since={undefined} signal="blocked" />);
    expect(container).toBeEmptyDOMElement();
  });
});
