import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RepoFilter } from "./repo-filter";

const repos = [
  { path: "/home/me/git/collie-board", name: "collie-board" },
  { path: "/home/me/git/herdr", name: "herdr" },
];

// Same contract as TagFilter's: what is pinned is the two ways OUT and the "is it visible at all"
// rule — a scope you can't see is a board that has silently lost cards.
describe("RepoFilter", () => {
  it("renders nothing when there is nothing to choose between", () => {
    const { container } = render(
      <RepoFilter repos={repos.slice(0, 1)} active={null} onPick={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("stays on screen for a scope that is now the only repo left — the way out must not vanish", () => {
    render(<RepoFilter repos={repos.slice(0, 1)} active={repos[0]!.path} onPick={() => {}} />);
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
  });

  it("scopes to a repo on tap, by path — the label is only what it shows", async () => {
    const onPick = vi.fn();
    render(<RepoFilter repos={repos} active={null} onPick={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: "herdr" }));
    expect(onPick).toHaveBeenCalledWith("/home/me/git/herdr");
  });

  it("goes back to every repo by tapping the active one again", async () => {
    const onPick = vi.fn();
    render(<RepoFilter repos={repos} active={repos[0]!.path} onPick={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: "collie-board" }));
    expect(onPick).toHaveBeenCalledWith(null);
  });

  it("goes back to every repo from All — the escape that is always on screen", async () => {
    const onPick = vi.fn();
    render(<RepoFilter repos={repos} active={repos[0]!.path} onPick={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(onPick).toHaveBeenCalledWith(null);
  });

  it("marks which repo is on, so a scoped board says so", () => {
    render(<RepoFilter repos={repos} active={repos[0]!.path} onPick={() => {}} />);
    expect(screen.getByRole("button", { name: "collie-board" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("button", { name: "All" })).not.toHaveAttribute("aria-current");
  });
});
