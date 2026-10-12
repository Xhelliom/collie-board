import { filterByProject, groupBySession, groupTitle } from "./gallery";
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
    expect(groups.map((g) => g.items.map((i) => i.name))).toEqual([["a.png", "c.png"], ["b.png"]]);
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

describe("groupTitle", () => {
  it("names a group by project and the date of its newest file, not the session id", () => {
    const t = groupTitle([img({ project: "collie", session: "abcdef123456", mtime: Date.UTC(2026, 9, 12, 12) })]);
    expect(t).toContain("collie");
    expect(t).not.toContain("abcdef12");
    expect(t).toMatch(/2026/);
  });
});

describe("filterByProject", () => {
  const items = [img({ project: "a" }), img({ project: "b" }), img({ project: "a" })];
  it("keeps one project", () => expect(filterByProject(items, "a")).toHaveLength(2));
  it("keeps everything for null", () => expect(filterByProject(items, null)).toHaveLength(3));
});
