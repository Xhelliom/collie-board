import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TagFilter } from "./tag-filter";

// The filter's contract is the acceptance criterion "visible, and undone in one gesture" — so what
// is pinned here is the two ways OUT, not the styling.
describe("TagFilter", () => {
  it("renders nothing when no card carries a tag", () => {
    const { container } = render(<TagFilter tags={[]} active={null} onPick={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("picks a tag on tap", async () => {
    const onPick = vi.fn();
    render(<TagFilter tags={["bug", "infra"]} active={null} onPick={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: "infra" }));
    expect(onPick).toHaveBeenCalledWith("infra");
  });

  it("clears the filter by tapping the active tag again", async () => {
    const onPick = vi.fn();
    render(<TagFilter tags={["bug", "infra"]} active={"bug"} onPick={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: "bug" }));
    expect(onPick).toHaveBeenCalledWith(null);
  });

  it("clears the filter from All — the escape that is always on screen", async () => {
    const onPick = vi.fn();
    render(<TagFilter tags={["bug"]} active={"bug"} onPick={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(onPick).toHaveBeenCalledWith(null);
  });

  it("marks which tag is on, so a filtered board says so", () => {
    render(<TagFilter tags={["bug", "infra"]} active={"bug"} onPick={() => {}} />);
    expect(screen.getByRole("button", { name: "bug" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "infra" })).toHaveAttribute("aria-pressed", "false");
  });
});
