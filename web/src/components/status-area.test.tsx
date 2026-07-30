import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { StatusArea } from "./status-area";
import { clearStatus, setStatus } from "@/lib/status";

// An error notice is the ONE thing in the app you have to actively clear — every other tone fades on
// its own. So it must be the one thing a keyboard can definitely reach. It used to be an onClick on
// the role="status" div: no button, no tabIndex, no key handling (UI_AUDIT §5.3).
beforeEach(() => clearStatus());

describe("StatusArea — dismissing an error", () => {
  it("offers a labelled, focusable dismiss button on an error", async () => {
    setStatus("Send failed", "error");
    render(<StatusArea />);

    const dismiss = screen.getByRole("button", { name: "Dismiss" });
    await userEvent.tab();
    expect(dismiss).toHaveFocus();
    // Only the button re-enables pointer events. The bar floats over the content on home/board/space,
    // so a bar that took taps without acting on them would be a dead strip over what's beneath it.
    expect(dismiss).toHaveClass("pointer-events-auto");
    expect(screen.getByRole("status")).not.toHaveClass("pointer-events-auto");
  });

  it.each([
    ["Enter", "{Enter}"],
    ["Space", " "],
  ])("clears the status on %s", async (_name, key) => {
    setStatus("Send failed", "error");
    render(<StatusArea />);

    screen.getByRole("button", { name: "Dismiss" }).focus();
    await userEvent.keyboard(key);
    expect(screen.queryByText("Send failed")).not.toBeInTheDocument();
  });

  it("leaves the live region itself inert — no dismiss on a self-fading tone", () => {
    setStatus("Sent", "success");
    render(<StatusArea />);

    expect(screen.getByRole("status")).toHaveTextContent("Sent");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
