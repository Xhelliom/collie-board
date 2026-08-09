import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ImageLightboxHost } from "./image-lightbox";
import { closeLightbox, openLightbox } from "@/lib/lightbox";

// The viewer leans on two platform features rather than reimplementing them: <dialog showModal()>
// for the modal layer and CSS scroll snapping for the swipe. jsdom has no layout, so the SWIPE
// itself isn't testable here (scrollLeft/clientWidth are always 0) — what is testable, and what
// would actually break, is the wiring: that the store drives what's on screen, that the whole set is
// rendered as panes to swipe between, and that it can be closed.

const A = "/tmp/claude-1/p/s/scratchpad/a.png";
const B = "/tmp/claude-1/p/s/scratchpad/b.png";

afterEach(() => closeLightbox());

describe("ImageLightboxHost", () => {
  it("renders nothing until something opens it", () => {
    render(<ImageLightboxHost />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows every image in the set as its own pane, with the position of the opened one", () => {
    render(<ImageLightboxHost />);
    act(() => openLightbox([A, B], 1));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(2);
    // Opened on the second one — the counter is the only cue on a phone that more exist.
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.getByText("b.png")).toBeInTheDocument();
  });

  it("points each pane at the gallery route, path-encoded", () => {
    render(<ImageLightboxHost />);
    act(() => openLightbox([A]));
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      `/api/gallery/file?p=${encodeURIComponent(A)}`,
    );
  });

  it("names the file in alt text, so a swept scratchpad still reads as what was there", () => {
    render(<ImageLightboxHost />);
    act(() => openLightbox([A]));
    expect(screen.getByAltText("a.png")).toBeInTheDocument();
  });

  it("hides the counter for a single image", () => {
    render(<ImageLightboxHost />);
    act(() => openLightbox([A]));
    expect(screen.queryByText("1/1")).not.toBeInTheDocument();
  });

  it("closes on the close button", async () => {
    render(<ImageLightboxHost />);
    act(() => openLightbox([A]));
    await userEvent.click(screen.getByLabelText("Close"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("refuses to open on an empty set or an index outside it", () => {
    // Callers pass indexOf() results straight in, so an out-of-range index is a real path.
    render(<ImageLightboxHost />);
    act(() => openLightbox([]));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => openLightbox([A], 5));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
