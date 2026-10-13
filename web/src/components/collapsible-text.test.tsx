import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CollapsibleText } from "./collapsible-text";

// jsdom has no layout: fake the measured heights.
function measure(scroll: number, client: number) {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(scroll);
  void client;
}

afterEach(() => vi.restoreAllMocks());

describe("CollapsibleText", () => {
  it("leaves short text untouched: no button", () => {
    measure(40, 40);
    render(<CollapsibleText>court</CollapsibleText>);
    expect(screen.getByText("court")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    const el = screen.getByText("court");
    expect(el.style.maxHeight).toBe("");
    expect(el).not.toHaveClass("overflow-hidden");
  });

  it("folds long text and toggles with aria-expanded", async () => {
    measure(400, 100);
    render(<CollapsibleText lines={4}>long</CollapsibleText>);
    const btn = screen.getByRole("button", { name: "Voir plus" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("long").style.maxHeight).toBe("96px");

    await userEvent.setup().click(btn);
    const less = screen.getByRole("button", { name: "Voir moins" });
    expect(less).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("long").style.maxHeight).toBe("");
  });

  it("forceOpen on short text shows no button", () => {
    measure(40, 40);
    render(<CollapsibleText forceOpen>court</CollapsibleText>);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("forceOpen on long text unfolds with no dead toggle", () => {
    measure(400, 100);
    render(<CollapsibleText lines={4} forceOpen>long</CollapsibleText>);
    expect(screen.getByText("long").style.maxHeight).toBe("");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
