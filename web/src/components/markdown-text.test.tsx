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

// A table's SHAPE is the phone-specific decision: narrow enough and it stays a grid, wider and a row
// becomes a card, because four columns on a 360px screen is a horizontal pan.
describe("MarkdownText — tables", () => {
  it("renders a narrow table as a real table", () => {
    render(<MarkdownText text={"| file | change |\n|---|---|\n| a.ts | fixed |"} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "file" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "a.ts" })).toBeInTheDocument();
  });

  it("renders a wide table as one labelled card per row, not a grid", () => {
    render(
      <MarkdownText
        text={"| a | b | c | d |\n|---|---|---|---|\n| 1 | 2 | 3 | 4 |"}
      />,
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // Every cell survives, each next to the header that names it.
    for (const t of ["a", "b", "c", "d", "1", "2", "3", "4"]) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
  });

  // Same boundary as the rest of this renderer: structure comes from the AST, content is text nodes.
  it("a cell holding markup renders as text, never as elements", () => {
    render(<MarkdownText text={"| x |\n|---|\n| <img src=x onerror=alert(1)> |"} />);
    expect(screen.getByRole("cell").querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
  });
});
