import { expect, test } from "bun:test";

import { endOfLot } from "./autonomy.ts";
import { BoardDb } from "./db.ts";

// ADR 0048 §7: the end-of-lot grant never offers a lot another pair created.
test("the next lot offered is this pair's; another pair's is named, not offered", () => {
  const R = "/r/shared";
  const db = new BoardDb(":memory:");
  db.setRepoShare(R, "origin");
  db.setPeerIdentity(R, "me@x");
  db.setAutonomy(R, { enabled: true, maxChain: null, stopOnRed: false, startWhenIdle: false, maxRounds: 3 });
  const lot = (name: string) => db.createRun({ repoPath: R, cardIds: [db.createCard({ title: name, repoPath: R }).id], foldInCap: 0, planned: true, name });
  db.setPairId("dell");
  const dell = lot("Tests Windows");
  db.setPairId("here");
  const done = lot("fini");
  db.launchRun(done.id);

  const v = endOfLot(db, done);
  expect(v.go).toBe(false);
  expect(!v.go && v.why).toContain("« Tests Windows »");
  expect(!v.go && v.why).toContain("dell");

  const mine = lot("Le mien");
  const w = endOfLot(db, done);
  expect(w.go && w.next.id).toBe(mine.id);
  expect(dell.createdPair).toBe("dell");
});
