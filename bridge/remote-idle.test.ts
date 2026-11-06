import { describe, expect, it } from "bun:test";

import { BoardDb } from "./db.ts";
import type { PrStatus } from "./git.ts";
import { followsOf } from "./pr-follow.ts";
import { REMOTE_IDLE, REMOTE_IDLE_CLEARED, RemoteIdle } from "./remote-idle.ts";
import { REMOTE_LAUNCHED } from "./remote-launch.ts";

const PR = (state: PrStatus["state"]): PrStatus => ({ state, url: "https://github.com/o/r/pull/252", mergedAt: null, conflicting: false, mergeable: true, createdAt: null });

function setup(pr: () => PrStatus | null = () => null) {
  const db = new BoardDb(":memory:");
  const card = db.createCard({ title: "Sonde Windows", repoPath: "/r", environment: { peer: "dell", name: "win" } });
  db.recordEvent(card.id, REMOTE_LAUNCHED, { peer: "dell", environment: "win", paneId: "w1:p1", branch: "board/sonde-windows" });
  db.setStatus(card.id, "working", "launched");
  const asked: (string | null)[] = [];
  const idle = new RemoteIdle(db, async (c) => (asked.push(c.branch), pr()));
  const read = (status: string) => idle.seen("dell", [{ paneId: "w1:p1", status, peer: "dell" }]);
  const types = () => db.listEvents(card.id).map((e) => e.type).filter((t) => t.startsWith("card.remote_idle") || t.startsWith("card.pr_"));
  return { db, card, read, types, asked };
}

describe("RemoteIdle", () => {
  it("a remote pane that stops without a PR journals remote_idle once, retracted when it works again", async () => {
    const { read, types, asked } = setup();
    await read("working"); // first sighting: no transition
    await read("idle");
    await read("done");
    await read("idle");
    expect(types()).toEqual([REMOTE_IDLE]);
    expect(asked).toEqual(["board/sonde-windows"]);
    await read("working");
    expect(types()).toEqual([REMOTE_IDLE_CLEARED, REMOTE_IDLE]);
    await read("working");
    expect(types()).toHaveLength(2);
  });

  it("a blocked pane (a screen holds it) is no stop; its idle after is", async () => {
    const { read, types } = setup();
    await read("working");
    await read("blocked");
    expect(types()).toEqual([]);
    await read("idle");
    expect(types()).toEqual([REMOTE_IDLE]);
  });

  it("finds the PR the remote agent opened: attached, followed, the card's branch set — no idle", async () => {
    const { db, card, read, types } = setup(() => PR("open"));
    await read("working");
    await read("idle");
    expect(types()).toEqual(["card.pr_follow", "card.pr_updated"]);
    expect(db.getCard(card.id)!.branch).toBe("board/sonde-windows");
    expect(followsOf(db.listPrEvents()).has(card.id)).toBe(true);
    await read("working");
    await read("idle"); // same PR: not attached twice
    expect(types()).toEqual(["card.pr_follow", "card.pr_updated"]);
  });

  it("a PR merged already is journaled merged, for the follower to file the card", async () => {
    const { db, card, read } = setup(() => PR("merged"));
    await read("working");
    await read("idle");
    expect(followsOf(db.listPrEvents()).get(card.id)?.merged).toBe(true);
  });

  it("a PR turning up later retracts the idle; a pane of no card, or a done card, says nothing", async () => {
    let pr: PrStatus | null = null;
    const { db, card, read, types } = setup(() => pr);
    await read("working");
    await read("idle");
    pr = PR("open");
    await read("working");
    await read("idle");
    expect(types()[0]).toBe("card.pr_follow");
    expect(types()).toContain(REMOTE_IDLE_CLEARED);
    db.setStatus(card.id, "done", "manual");
    const before = types().length;
    await read("working");
    await read("idle");
    expect(types()).toHaveLength(before);
  });
});
