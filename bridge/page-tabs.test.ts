import { describe, expect, it } from "bun:test";

import { BoardDb } from "./db.ts";
import { parsePageKey } from "./page-tabs.ts";

describe("page tabs", () => {
  it("accepts a page name or <cardId>/<file.html>, nothing else", () => {
    expect(parsePageKey("roadmap")).toEqual({ page: "roadmap" });
    expect(parsePageKey("c1/offre.html")).toEqual({ cardId: "c1", name: "offre.html" });
    expect(parsePageKey("c1/offre.png")).toBeNull();
    expect(parsePageKey("c1/../x.html")).toBeNull();
    expect(parsePageKey("../x.html")).toBeNull();
    expect(parsePageKey("a.b")).toBeNull();
    expect(parsePageKey("")).toBeNull();
  });

  it("keeps the ticked pages per repo, and drops the row when none is left", () => {
    const db = new BoardDb(":memory:");
    expect(db.repoPageTabs("/r")).toEqual([]);
    db.setRepoPageTabs("/r", ["roadmap", "c1/offre.html"]);
    expect(db.repoPageTabs("/r")).toEqual(["roadmap", "c1/offre.html"]);
    expect(db.repoPageTabs("/other")).toEqual([]);
    db.setRepoPageTabs("/r", []);
    expect(db.dump().repo_pref).toHaveLength(0);
  });
});
