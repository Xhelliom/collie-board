import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CommandSuggestions } from "./command-suggestions";

describe("CommandSuggestions", () => {
  it("matches the typed prefix against the agent's catalog", () => {
    render(<CommandSuggestions agent="claude" value="/comp" onPick={vi.fn()} />);

    expect(screen.getByRole("button", { name: /\/compact/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /\/clear/ })).toBeNull();
  });

  it("picks the command, with a trailing space when it takes an argument", async () => {
    const onPick = vi.fn();
    render(<CommandSuggestions agent="claude" value="/comp" onPick={onPick} />);

    await userEvent.click(screen.getByRole("button", { name: /\/compact/ }));

    expect(onPick).toHaveBeenCalledWith("/compact ");
  });

  it("stays silent unless the draft is a lone slash token", () => {
    // Nothing else renders here, so "no buttons at all" is the whole assertion.
    const { rerender } = render(<CommandSuggestions agent="claude" value="/compact " onPick={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();

    // Mid-sentence slash, and a prefix nothing matches.
    rerender(<CommandSuggestions agent="claude" value="see /compact" onPick={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<CommandSuggestions agent="claude" value="/zzz" onPick={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();

    // Unknown agent has no catalog — same as the button, which hides itself.
    rerender(<CommandSuggestions agent="bash" value="/co" onPick={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
