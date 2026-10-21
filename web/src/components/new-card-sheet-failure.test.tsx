import { setPreference } from "@/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/lib/api";
import { NewCardSheet } from "./new-card-sheet";

// A failed create used to close the sheet anyway — the dictated dump gone, the reason in a status
// line the sheet itself was covering. It must stay open and say why, in the bridge's own words.
beforeEach(() => setPreference("en"));

describe("NewCardSheet — a failed create", () => {
  it("stays open and shows why", async () => {
    const onClose = vi.fn();
    const onCreate = vi.fn().mockRejectedValue(new ApiError("/api/cards → 500 disk full", 500));
    render(<NewCardSheet open onClose={onClose} onCreate={onCreate} tags={[]} />);
    await userEvent.type(screen.getByRole("textbox", { name: /what needs doing/i }), "fix the thing");
    await userEvent.click(screen.getByRole("button", { name: /add to backlog/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Card not created: disk full");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: /what needs doing/i })).toHaveValue("fix the thing");
  });

  it("closes once the create succeeds", async () => {
    const onClose = vi.fn();
    render(<NewCardSheet open onClose={onClose} onCreate={vi.fn().mockResolvedValue(undefined)} tags={[]} />);
    await userEvent.type(screen.getByRole("textbox", { name: /what needs doing/i }), "fix the thing");
    await userEvent.click(screen.getByRole("button", { name: /add to backlog/i }));

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
