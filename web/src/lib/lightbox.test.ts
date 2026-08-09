import { collectImages } from "./lightbox";
import type { TranscriptEntry } from "@/lib/types";

// collectImages is the whole "images in this session" feature: the set you swipe through from a
// thumbnail, and what the history header's button opens. It's derived from the turns rather than
// from a directory listing, so its contract is order and de-duplication.

const turn = (parts: TranscriptEntry["parts"]): TranscriptEntry => ({
  uuid: Math.random().toString(36),
  ts: "",
  role: "assistant",
  parts,
});

const tool = (image?: string) => ({
  kind: "tool" as const,
  name: "Read",
  summary: image ?? "ls",
  ...(image ? { image } : {}),
});

describe("collectImages", () => {
  it("collects images across turns, oldest first", () => {
    expect(
      collectImages([
        turn([tool("/tmp/claude-1/p/s/scratchpad/a.png")]),
        turn([{ kind: "text", text: "here it is" }]),
        turn([tool("/tmp/claude-1/p/s/scratchpad/b.png")]),
      ]),
    ).toEqual(["/tmp/claude-1/p/s/scratchpad/a.png", "/tmp/claude-1/p/s/scratchpad/b.png"]);
  });

  it("de-duplicates a file the agent read more than once", () => {
    // An agent re-reading one render after each edit is normal, and it must not become five panes
    // of the same picture to swipe through.
    const p = "/tmp/claude-1/p/s/scratchpad/a.png";
    expect(collectImages([turn([tool(p)]), turn([tool(p)]), turn([tool(p)])])).toEqual([p]);
  });

  it("ignores tool calls that touched no image, and non-tool parts", () => {
    expect(
      collectImages([turn([tool(), { kind: "text", text: "hi" }, { kind: "thinking", text: "…" }])]),
    ).toEqual([]);
  });

  it("is empty for an empty transcript", () => {
    expect(collectImages([])).toEqual([]);
  });
});

// openLightbox's guard is asserted where it's observable — image-lightbox.test.tsx renders the host.
