import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { BottomSheet, SideSheet } from "./sheet";

// The sheet is Vaul's drawer now, so what is worth testing here changed shape: the drag physics is
// the library's and is tested there, while what remains OURS is the shell around it — the labelling,
// the single accessible Close, where focus goes, which dismiss paths fire `onClose`, and which
// regions are marked no-drag. Those are what these tests hold.
const dialog = () => screen.getByRole("dialog");
const overlay = () => document.querySelector("[data-vaul-overlay]") as HTMLElement;

describe("sheet — focus & labelling", () => {
  it("labels the dialog with its title (aria-labelledby)", () => {
    render(
      <BottomSheet open onClose={vi.fn()} title="Keys">
        body
      </BottomSheet>,
    );
    expect(screen.getByRole("dialog", { name: "Keys" })).toBeInTheDocument();
  });

  it("exposes a single accessible Close (✕) — the overlay is not a second one", () => {
    render(
      <SideSheet open onClose={vi.fn()} title="Navigate">
        body
      </SideSheet>,
    );
    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(1);
  });

  it("moves focus into the panel on open and restores it to the opener on close", async () => {
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
    // Vaul leaves focus on the opener (behind the modal) unless told otherwise, and Radix's own
    // default would take the first tabbable — the ✕, where an Enter closes what you just opened.
    // Neither: the panel itself takes it.
    await waitFor(() => expect(document.activeElement).toBe(dialog()));
    expect(document.activeElement).not.toBe(opener);

    rerender(
      <BottomSheet open={false} onClose={vi.fn()} title="Keys">
        body
      </BottomSheet>,
    );
    await waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });
});

// The on-device bug from the long-press sheets: a long-press that opens the sheet leaves the finger
// down at mount time, so the browser's release `click` lands wherever the finger now is — the
// overlay. Closing on any overlay click meant the sheet closed in the same instant it opened. The
// hand-rolled version guarded this with a `backdropArmed` ref; Radix's outside-POINTERDOWN rule does
// it by construction, and this test is what says so out loud.
describe("BottomSheet — dismiss paths", () => {
  it("stays open on a click whose pointerdown never landed outside (the long-press release)", async () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} title="Actions">
        body
      </BottomSheet>,
    );
    await waitFor(() => expect(overlay()).not.toBeNull());
    fireEvent.click(overlay());
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();
  });

  it("closes on a genuine tap: pointerdown on the overlay, then its release", async () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} title="Actions">
        body
      </BottomSheet>,
    );
    await waitFor(() => expect(overlay()).not.toBeNull());
    // A touch dismiss is deliberately two-part in Radix: the pointerdown outside arms it, the click
    // fires it. That pairing IS the long-press fix above — a release with no matching press does
    // nothing.
    fireEvent.pointerDown(overlay(), { pointerType: "touch" });
    fireEvent.click(overlay());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("closes on the ✕", async () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} title="Actions">
        body
      </BottomSheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} title="Actions">
        body
      </BottomSheet>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

// The reported bug: "a drag down inside a list closes the drawer". Vaul arms its pull-to-dismiss
// from anywhere on the panel that is not marked, so the fix is a marking, not a gesture handler —
// which is exactly what is asserted here. The gesture ITSELF (velocity, threshold, elasticity) is
// Vaul's and is not re-tested in jsdom: it needs pointer capture and real layout, and a test that
// faked those would only assert our fake.
describe("sheet — what the pull-to-dismiss may not touch", () => {
  it("marks the whole body no-drag, so a touch on a field or a list can never arm the dismiss", () => {
    render(
      <BottomSheet open onClose={vi.fn()} title="Actions">
        <input aria-label="q" />
        <div data-testid="list">
          <p>row</p>
        </div>
      </BottomSheet>,
    );
    // Vaul walks up from the touch target looking for [data-vaul-no-drag]; every one of these finds it.
    expect(screen.getByLabelText("q").closest("[data-vaul-no-drag]")).not.toBeNull();
    expect(screen.getByText("row").closest("[data-vaul-no-drag]")).not.toBeNull();
  });

  it("leaves the header draggable — it is the grab zone the handle advertises", () => {
    render(
      <BottomSheet open onClose={vi.fn()} title="Actions">
        body
      </BottomSheet>,
    );
    const header = screen.getByText("Actions").closest("div")!;
    expect(header.closest("[data-vaul-no-drag]")).toBeNull();
  });

  it("marks a SideSheet footer no-drag too — its buttons are not a grab zone", () => {
    render(
      <SideSheet open onClose={vi.fn()} title="Navigate" footer={<button>Act</button>}>
        body
      </SideSheet>,
    );
    expect(screen.getByRole("button", { name: "Act" }).closest("[data-vaul-no-drag]")).not.toBeNull();
  });
});
