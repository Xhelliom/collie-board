import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { BottomSheet, SideSheet } from "./sheet";

// jsdom has no TouchEvent, so build one: a bubbling, cancelable Event carrying the single `touches`
// entry the sheet reads. fireEvent(el, event) dispatches it wrapped in act().
function touch(el: Element, type: "touchstart" | "touchmove" | "touchend", clientY: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: [{ clientY }] });
  fireEvent(el, event);
}

const panelOf = (container: HTMLElement) =>
  container.querySelector('div[tabindex="-1"]') as HTMLElement;

// Focus + labelling: the sheets are role=dialog/aria-modal, so they should be named by their title,
// move focus inside on open, restore it on close, and expose exactly ONE accessible "Close" (the
// header ✕) — the full-screen backdrop stays tappable but is hidden from assistive tech.
describe("sheet — focus & labelling", () => {
  it("labels the dialog with its title (aria-labelledby)", () => {
    render(
      <BottomSheet open onClose={vi.fn()} title="Keys">
        body
      </BottomSheet>,
    );
    expect(screen.getByRole("dialog", { name: "Keys" })).toBeInTheDocument();
  });

  it("exposes a single accessible Close (✕); the backdrop is aria-hidden but still dismisses on a real tap (down+up on it)", () => {
    const onClose = vi.fn();
    const { container } = render(
      <SideSheet open onClose={onClose} title="Navigate">
        body
      </SideSheet>,
    );
    // Only the header ✕ is in the a11y tree now — no giant duplicate "Close" from the backdrop.
    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(1);
    // ...but the backdrop still closes on a genuine press-and-release on it.
    const backdrop = container.querySelector('button[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
    fireEvent.pointerDown(backdrop!);
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus into the panel on open and restores it to the opener on close", () => {
    const opener = document.createElement("button");
    opener.textContent = "open";
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { rerender } = render(
      <BottomSheet open onClose={vi.fn()} title="Keys">
        body
      </BottomSheet>,
    );
    // Focus is now inside the dialog panel (not left on the opener behind the modal).
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(opener);

    rerender(
      <BottomSheet open={false} onClose={vi.fn()} title="Keys">
        body
      </BottomSheet>,
    );
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

// The on-device bug: a long-press that opens the sheet leaves the finger down at mount time: the
// browser's release `click` lands wherever the finger now is, which is the backdrop — and closing on
// ANY backdrop click meant the sheet closed in the same instant it opened. The fix arms the dismiss
// only when the pointer went DOWN on the backdrop too (press AND release on it), so a click whose
// pointerdown started elsewhere (the pill, in the real gesture) is ignored.
describe("BottomSheet — backdrop dismiss requires press AND release on the backdrop", () => {
  it("stays open when pointerdown happened elsewhere (not the backdrop) and only the click lands on it", () => {
    const onClose = vi.fn();
    const { container } = render(
      <BottomSheet open onClose={onClose} title="Actions">
        body
      </BottomSheet>,
    );
    // Simulate the pointerdown landing on something other than the backdrop (e.g. the pane pill that
    // triggered the long-press), then the release click landing on the backdrop.
    fireEvent.pointerDown(document.body);
    const backdrop = container.querySelector('button[aria-hidden="true"]')!;
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // The three paths below now close through the exit animation, so `onClose` lands one frame-set
  // later (CLOSE_MS) rather than synchronously — hence the waitFor.
  it("closes when both pointerdown and click land on the backdrop (a genuine backdrop tap)", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <BottomSheet open onClose={onClose} title="Actions">
        body
      </BottomSheet>,
    );
    const backdrop = container.querySelector('button[aria-hidden="true"]')!;
    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("the ✕ button still closes regardless of the backdrop arm state", async () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} title="Actions">
        body
      </BottomSheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("Escape still closes regardless of the backdrop arm state", async () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} title="Actions">
        body
      </BottomSheet>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("re-arms per open: a stale arm from a previous open doesn't leak into the next one", () => {
    const onClose = vi.fn();
    const { container, rerender } = render(
      <BottomSheet open onClose={onClose} title="Actions">
        body
      </BottomSheet>,
    );
    const backdrop = () => container.querySelector('button[aria-hidden="true"]')!;
    fireEvent.pointerDown(backdrop());
    // Close via Escape instead of the (now-armed) backdrop click, leaving the arm flag set to true.
    fireEvent.keyDown(window, { key: "Escape" });
    rerender(
      <BottomSheet open={false} onClose={onClose} title="Actions">
        body
      </BottomSheet>,
    );
    rerender(
      <BottomSheet open onClose={onClose} title="Actions">
        body
      </BottomSheet>,
    );
    onClose.mockClear();
    // A click with no pointerdown in this new open should NOT close, even though a stale arm from the
    // previous open was left set to true.
    fireEvent.click(backdrop());
    expect(onClose).not.toHaveBeenCalled();
  });
});

// The reported feel: "a drag down inside a list closes the drawer". Two separate causes, both here.
describe("BottomSheet — pull-to-dismiss", () => {
  it("a pull that starts on a control or inside a scroller scrolls, it does not dismiss", () => {
    const onClose = vi.fn();
    const { container } = render(
      <BottomSheet open onClose={onClose} title="Actions">
        <input aria-label="q" />
        <div data-testid="list" style={{ overflowY: "auto" }}>
          <p>row</p>
        </div>
      </BottomSheet>,
    );
    const panel = panelOf(container);

    // From a field: the gesture belongs to the field (caret drag / native scroll), never to dismiss.
    const field = screen.getByLabelText("q");
    touch(field, "touchstart", 100);
    touch(field, "touchmove", 320);
    touch(field, "touchend", 320);
    expect(onClose).not.toHaveBeenCalled();
    expect(panel.style.transform).toBe("");

    // From a scrollable region inside the sheet: same — that region owns the vertical gesture.
    const list = screen.getByTestId("list");
    Object.defineProperty(list, "scrollHeight", { value: 500 });
    Object.defineProperty(list, "clientHeight", { value: 100 });
    const row = screen.getByText("row");
    touch(row, "touchstart", 100);
    touch(row, "touchmove", 320);
    touch(row, "touchend", 320);
    expect(onClose).not.toHaveBeenCalled();
    expect(panel.style.transform).toBe("");
  });

  it("closes on a real pull, and leaves no residual transform behind for the next open", async () => {
    const onClose = vi.fn();
    const sheet = (open: boolean) => (
      <BottomSheet open={open} onClose={onClose} title="Actions">
        body
      </BottomSheet>
    );
    const { container, rerender } = render(sheet(true));

    // A pull from the panel itself (at scrollTop 0), well past the 90px close threshold.
    const panel = panelOf(container);
    touch(panel, "touchstart", 100);
    touch(panel, "touchmove", 260);
    expect(panel.style.transform).toBe("translateY(160px)");
    touch(panel, "touchend", 260);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    // Reopen: the panel must come back at rest. A leftover translateY here is the flicker.
    rerender(sheet(false));
    rerender(sheet(true));
    expect(panelOf(container).style.transform).toBe("");
  });
});
