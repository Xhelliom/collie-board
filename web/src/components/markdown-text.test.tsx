import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MarkdownText } from "./markdown-text";

// Copy button on transcript code blocks (UI_AUDIT §6.4) — the AST's block.text is already the exact
// string to copy, so the only real behavior to pin is the secure-context gate (disabled, not hidden,
// on plain HTTP — same convention as push.ts) and the copy + confirm round trip.
describe("MarkdownText — code block copy button", () => {
  const CODE = "```\nconsole.log('hi')\n```";
  const secureDescriptor = Object.getOwnPropertyDescriptor(window, "isSecureContext");
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");

  afterEach(() => {
    if (secureDescriptor) Object.defineProperty(window, "isSecureContext", secureDescriptor);
    if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  });

  it("copies the block's text and confirms with a check", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    render(<MarkdownText text={CODE} />);
    const copyBtn = screen.getByRole("button", { name: "Copy code block" });
    expect(copyBtn).toBeEnabled();
    await user.click(copyBtn);

    expect(writeText).toHaveBeenCalledWith("console.log('hi')");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("is disabled (not hidden) outside a secure context", () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });

    render(<MarkdownText text={CODE} />);
    expect(screen.getByRole("button", { name: "Copy code block" })).toBeDisabled();
  });
});
