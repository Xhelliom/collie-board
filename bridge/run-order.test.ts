import { describe, expect, it } from "bun:test";

import { BoardDb, byDependsOn } from "./db.ts";

const c = (id: string, dependsOn: string | null = null) => ({ id, dependsOn });
const ids = (cards: { id: string }[]) => cards.map((x) => x.id);

describe("byDependsOn — a lot's launch order", () => {
  it("puts an inverted chain A<-B<-C back in order", () => {
    expect(ids(byDependsOn([c("C", "B"), c("B", "A"), c("A")]))).toEqual(["A", "B", "C"]);
  });

  it("keeps two independent chains in position order otherwise", () => {
    expect(ids(byDependsOn([c("Y", "X"), c("B", "A"), c("X"), c("A")]))).toEqual(["X", "Y", "A", "B"]);
  });

  it("ignores a dependency outside the lot", () => {
    expect(ids(byDependsOn([c("B", "elsewhere"), c("A")]))).toEqual(["B", "A"]);
  });

  it("falls back to the given order on a cycle", () => {
    expect(ids(byDependsOn([c("B", "A"), c("A", "B"), c("Z")]))).toEqual(["B", "A", "Z"]);
  });

  it("runMembers returns a predecessor before its dependent", () => {
    const db = new BoardDb(":memory:");
    const board = db.createCard({ title: "Board", repoPath: "/repo" });
    const carte = db.createCard({ title: "Carte", repoPath: "/repo", dependsOn: board.id }); // newer → on top
    const run = db.createRun({ repoPath: "/repo", cardIds: [carte.id, board.id], foldInCap: 0 });
    expect(ids(db.runMembers(run.id))).toEqual([board.id, carte.id]);
    db.close();
  });
});
