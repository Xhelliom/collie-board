import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OriginFilter } from "./origin-filter";

describe("OriginFilter", () => {
  it("draws nothing on a board where no card is automatic — which is the default board", () => {
    const { container } = render(<OriginFilter has={false} active={false} onPick={() => {}} />);
    expect(container.textContent).toBe("");
  });

  it("stays on screen while the filter is on, even if nothing matches it any more", () => {
    // Otherwise the way out of an empty board is the one thing not drawn on it.
    render(<OriginFilter has={false} active onPick={() => {}} />);
    expect(screen.getByText("Auto")).toBeInTheDocument();
  });

  it("turns the filter on, and takes it back off from either chip", async () => {
    const onPick = vi.fn();
    const { rerender } = render(<OriginFilter has active={false} onPick={onPick} />);
    await userEvent.click(screen.getByText("Auto"));
    expect(onPick).toHaveBeenLastCalledWith(true);

    rerender(<OriginFilter has active onPick={onPick} />);
    await userEvent.click(screen.getByText("Auto"));
    expect(onPick).toHaveBeenLastCalledWith(false);
    await userEvent.click(screen.getByText("All"));
    expect(onPick).toHaveBeenLastCalledWith(false);
  });
});
