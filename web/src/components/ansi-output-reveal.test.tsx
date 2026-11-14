import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { AnsiOutput } from "./ansi-output";

// The bridge sends the mirror masked; « Afficher » asks for one secret, by the row it sits on.
const MASKED = "DB_PASSWORD=••••••••••••••\nDB_PASSWORD=••••••••••••••\n$ ";

describe("AnsiOutput — a masked secret", () => {
  it("reveals on tap, by row, rows below and column, and masks again on Hide", async () => {
    const onReveal = vi.fn().mockResolvedValue("hunter2hunter2");
    const { container } = render(<AnsiOutput text={MASKED} onReveal={onReveal} />);
    const buttons = screen.getAllByRole("button", { name: /secret|Show|Afficher/i });
    expect(buttons).toHaveLength(2);
    expect(container.textContent).not.toContain("hunter2");

    await userEvent.click(buttons[0]!);
    expect(onReveal).toHaveBeenCalledWith("DB_PASSWORD=••••••••••••••", 1, 12);
    expect(container.textContent).toContain("hunter2hunter2");

    await userEvent.click(screen.getByRole("button", { name: /Hide|Masquer/ }));
    expect(container.textContent).not.toContain("hunter2");
  });

  it("is masked again once the view is left", async () => {
    const onReveal = vi.fn().mockResolvedValue("hunter2hunter2");
    const { container, unmount } = render(<AnsiOutput text={MASKED} onReveal={onReveal} />);
    await userEvent.click(screen.getAllByRole("button")[1]!);
    expect(onReveal).toHaveBeenCalledWith("DB_PASSWORD=••••••••••••••", 0, 12);
    unmount();
    const again = render(<AnsiOutput text={MASKED} onReveal={onReveal} />);
    expect(again.container.textContent).not.toContain("hunter2");
    expect(container.textContent).toBe("");
  });

  it("shows no button without a reveal handler", () => {
    render(<AnsiOutput text={MASKED} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
