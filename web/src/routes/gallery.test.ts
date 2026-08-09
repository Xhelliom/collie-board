import { groupBySession } from "./gallery";
import type { GalleryImage } from "@/lib/types";

// The screen is markup around one decision: images are grouped by the SESSION that made them, and
// each group keeps the listing's newest-first order so the grid and the viewer agree on what
// "next" means.

const img = (over: Partial<GalleryImage>): GalleryImage => ({
  path: `/tmp/claude-1/proj/s1/scratchpad/${over.name ?? "a.png"}`,
  name: "a.png",
  project: "proj",
  session: "s1",
  size: 1,
  mtime: 0,
  ...over,
});

describe("groupBySession", () => {
  it("groups by session, keeping listing order within and between groups", () => {
    const groups = groupBySession([
      img({ name: "a.png", session: "s1", mtime: 3 }),
      img({ name: "b.png", session: "s2", mtime: 2 }),
      img({ name: "c.png", session: "s1", mtime: 1 }),
    ]);
    expect(groups.map((g) => g.images.map((i) => i.name))).toEqual([["a.png", "c.png"], ["b.png"]]);
  });

  it("keeps same-named sessions in different projects apart", () => {
    // Session ids are only unique within a project's harness dir, so the key must carry both.
    const groups = groupBySession([
      img({ project: "one", session: "s1" }),
      img({ project: "two", session: "s1" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("is empty for no images", () => {
    expect(groupBySession([])).toEqual([]);
  });
});
