import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { OutputZoom } from "./output-zoom";

const LONG = "x".repeat(400);

describe("OutputZoom", () => {
  it("shows the output unwrapped, as text, and zooms in steps", () => {
    const { container } = render(<OutputZoom text={`<b>hi</b>\n${LONG}`} fontSize={11} title="claude" onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    // Text nodes, never markup.
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText(/<b>hi<\/b>/)).toBeTruthy();
    const pre = container.querySelector("pre")!;
    expect(pre.className).toContain("whitespace-pre");
    expect(pre.className).not.toContain("whitespace-pre-wrap");

    expect(screen.getByRole("button", { name: /1×/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Zoom in|Agrandir/ }));
    expect(screen.getByRole("button", { name: /1\.5×/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /1\.5×/ }));
    expect(screen.getByRole("button", { name: /1×/ })).toBeTruthy();
  });

  it("Escape and ✕ close it", () => {
    const onClose = vi.fn();
    render(<OutputZoom text="x" fontSize={11} title="claude" onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /Back to the pane|Retour au pane/ }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
