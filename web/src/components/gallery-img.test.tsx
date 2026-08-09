import { act, fireEvent, render, screen } from "@testing-library/react";

import { GalleryImg } from "./gallery-img";

// The retry is the whole reason this component exists. Reported symptom: some images sat broken
// until a full page reload, then loaded fine — an agent still writing the file loses the race, the
// browser paints the broken state, and an <img> never asks a second time on its own.
//
// jsdom fetches no images, so load/error are driven by hand — which is exactly the seam under test.

const P = "/tmp/claude-1/p/s/scratchpad/render.png";
const img = () => screen.getByRole("img");

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("GalleryImg", () => {
  it("re-requests after a failure, with the attempt in the url", () => {
    render(<GalleryImg path={P} />);
    expect(img()).toHaveAttribute("src", `/api/gallery/file?p=${encodeURIComponent(P)}`);

    fireEvent.error(img());
    // Nothing yet — the retry is deferred, so a file that lost the race gets a moment to land.
    expect(img().getAttribute("src")).not.toContain("retry=");

    act(() => vi.advanceTimersByTime(700));
    // A DIFFERENT url: re-setting an identical src is a no-op, the browser would reuse the failure.
    expect(img().getAttribute("src")).toContain("retry=1");
    expect(img().getAttribute("src")).toContain(encodeURIComponent(P));
  });

  it("backs off across attempts and then gives up, leaving the alt text", () => {
    render(<GalleryImg path={P} />);
    for (const [i, delay] of [700, 2000, 5000].entries()) {
      fireEvent.error(img());
      act(() => vi.advanceTimersByTime(delay));
      expect(img().getAttribute("src")).toContain(`retry=${i + 1}`);
    }
    // Out of attempts: a file that is genuinely gone must not be re-requested forever.
    fireEvent.error(img());
    act(() => vi.advanceTimersByTime(60_000));
    expect(img().getAttribute("src")).toContain("retry=3");
  });

  it("stops retrying once the image loads", () => {
    render(<GalleryImg path={P} />);
    fireEvent.error(img());
    act(() => vi.advanceTimersByTime(700));
    fireEvent.load(img());
    act(() => vi.advanceTimersByTime(60_000));
    expect(img().getAttribute("src")).toContain("retry=1"); // no further attempts
  });

  it("falls back to the filename as alt text", () => {
    render(<GalleryImg path={P} />);
    expect(screen.getByAltText("render.png")).toBeInTheDocument();
  });

  it("starts a new path's attempts from scratch", () => {
    const { rerender } = render(<GalleryImg path={P} />);
    fireEvent.error(img());
    act(() => vi.advanceTimersByTime(700));
    expect(img().getAttribute("src")).toContain("retry=1");

    const other = "/tmp/claude-1/p/s/scratchpad/other.png";
    rerender(<GalleryImg path={other} />);
    expect(img().getAttribute("src")).toBe(`/api/gallery/file?p=${encodeURIComponent(other)}`);
  });
});
