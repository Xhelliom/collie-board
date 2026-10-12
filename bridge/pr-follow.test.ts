import { describe, expect, it } from "bun:test";

import { BoardDb, type Card } from "./db.ts";
import type { PrStatus } from "./git.ts";
import type { MergeGate } from "./integrate.ts";
import { followRunId, followsOf, PrFollower } from "./pr-follow.ts";
import type { EngineSnapshot } from "./state-engine.ts";

const snap = { bridge: "connected" } as EngineSnapshot;
const pr = (state: PrStatus["state"]): PrStatus => ({ state, url: "u", mergedAt: null, conflicting: false, mergeable: true, createdAt: null });

/** A board with one card whose PR was opened by "PR & done", and a fake GitHub behind it. */
function world(land: (db: BoardDb, card: Card, gate: MergeGate) => void | "busy", opened = "card.pr_opened") {
  const time = { clock: 0 };
  const db = new BoardDb(":memory:", () => time.clock); // the journal and the follower share one clock
  const card = db.createCard({ title: "t", repoPath: "/repo", baseRef: "main" });
  db.recordEvent(card.id, opened, { url: "u" });
  db.recordEvent(card.id, "card.pr_follow", {});
  const w = {
    db,
    card,
    state: "open" as PrStatus["state"] | null,
    filed: 0,
    lands: 0,
    asks: 0,
    get clock() {
      return time.clock;
    },
    set clock(t: number) {
      time.clock = t;
    },
  };
  const make = () =>
    new PrFollower(
      db,
      {
        prStatus: async () => (w.asks++, w.state ? pr(w.state) : null),
        gate: async (_c, runId) => ({ runId, ok: true, why: "no gate set" }),
        land: async (c, gate) => {
          w.lands++;
          return land(db, c, gate);
        },
        fileAsDone: (c) => {
          w.filed++;
          db.setStatus(c.id, "done", "manual");
        },
      },
      () => w.clock,
    );
  return { w, make };
}

const runIdOf = (db: BoardDb, cardId: string) => followRunId(db.listEvents(cardId).find((e) => e.type === "card.pr_follow")!.id);
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("PR & done follows the PR to its merge (ADR 0035)", () => {
  it("waits while checks run, merges on green, then files the card", async () => {
    let green = false;
    const { w, make } = world((db, c, gate) => {
      if (!green) return db.recordRunEvent(c.id, "run.merge", { runId: gate.runId, merged: false, reason: "running", wait: true } as never);
      db.recordRunEvent(c.id, "run.merge", { runId: gate.runId, merged: true, reason: "green" });
      db.recordEvent(c.id, "card.pr_merged", { url: "u" });
    });
    const f = make();
    f.update(snap);
    await settle();
    expect(w.lands).toBe(1);
    expect(w.filed).toBe(0);
    f.update(snap); // throttled
    await settle();
    expect(w.lands).toBe(1);
    green = true;
    w.clock += 30_000;
    f.update(snap);
    await settle();
    expect(w.filed).toBe(1);
    expect(w.db.getCard(w.card.id)!.status).toBe("done");
  });

  it("resumes after a restart: a new follower reads the follow from the journal", async () => {
    const { w, make } = world((db, c, gate) => {
      db.recordRunEvent(c.id, "run.merge", { runId: gate.runId, merged: true, reason: "green" });
      db.recordEvent(c.id, "card.pr_merged", { url: "u" });
    });
    make().update(snap); // the "restarted" bridge's first tick
    await settle();
    expect(w.filed).toBe(1);
  });

  it("follows a PR the agent opened itself — only `pr_updated` in the journal — to its merge", async () => {
    const { w, make } = world(() => {}, "card.pr_updated");
    w.state = "merged";
    make().update(snap);
    await settle();
    expect(w.asks).toBe(1);
    expect(w.db.listEvents(w.card.id).filter((e) => e.type === "card.pr_merged")).toHaveLength(1);
    expect(w.filed).toBe(1);
  });

  it("stops on a red check — the card stays open", async () => {
    const { w, make } = world((db, c, gate) => db.recordRunEvent(c.id, "run.merge", { runId: gate.runId, merged: false, reason: "red", ci: {} } as never));
    const f = make();
    f.update(snap);
    await settle();
    w.clock += 30_000;
    f.update(snap);
    await settle();
    expect(w.lands).toBe(1);
    expect(w.filed).toBe(0);
  });

  it("a stopped follow still reads the PR: merged by hand after a red check, the card is filed", async () => {
    const { w, make } = world((db, c, gate) => db.recordRunEvent(c.id, "run.merge", { runId: gate.runId, merged: false, reason: "red", ci: {} } as never));
    const f = make();
    f.update(snap);
    await settle();
    w.state = "merged"; // someone fixed it and merged on GitHub
    w.clock += 30_000;
    f.update(snap);
    await settle();
    expect(w.lands).toBe(1);
    expect(w.filed).toBe(1);
  });

  it("GitHub not done computing on the first tick is a wait: the follow keeps asking (ADR 0036)", async () => {
    let ready = false;
    const { w, make } = world((db, c, gate) => {
      if (!ready) return db.recordRunEvent(c.id, "run.merge", { runId: gate.runId, merged: false, reason: "mergeability", wait: true } as never);
      db.recordRunEvent(c.id, "run.merge", { runId: gate.runId, merged: true, reason: "green" });
      db.recordEvent(c.id, "card.pr_merged", { url: "u" });
    });
    const f = make();
    f.update(snap);
    await settle();
    expect(w.filed).toBe(0);
    ready = true;
    w.clock += 30_000;
    f.update(snap);
    await settle();
    expect(w.lands).toBe(2);
    expect(w.filed).toBe(1);
  });

  it("GitHub unreadable is no reason to stop: the follow asks `land`, which counts it as a wait (ADR 0036)", async () => {
    const { w, make } = world((db, c, gate) => db.recordRunEvent(c.id, "run.merge", { runId: gate.runId, merged: false, reason: "unreadable", wait: true } as never));
    w.state = null;
    const f = make();
    f.update(snap);
    await settle();
    w.clock += 30_000;
    f.update(snap);
    await settle();
    expect(w.lands).toBe(2);
    expect(w.filed).toBe(0);
  });

  it("a stopped follow is watched slower and slower while its PR stays open, at most every 30 min", async () => {
    const { w, make } = world((db, c, gate) => db.recordRunEvent(c.id, "run.merge", { runId: gate.runId, merged: false, reason: "red", ci: {} } as never));
    const f = make();
    const tickAt = async (t: number) => {
      w.clock = t;
      f.update(snap);
      await settle();
      return w.asks;
    };
    expect(await tickAt(0)).toBe(1); // stops on the red check
    expect(await tickAt(30_000)).toBe(2); // fresh stop: still every 30 s
    expect(await tickAt(4 * 3_600_000)).toBe(3); // hours later…
    expect(await tickAt(4 * 3_600_000 + 60_000)).toBe(3); // …not again a minute after
    expect(await tickAt(4 * 3_600_000 + 30 * 60_000)).toBe(4); // but within 30 min
    expect(w.lands).toBe(1);
  });

  it("files a PR merged by someone else (GitHub's auto-merge, a human)", async () => {
    const { w, make } = world(() => {});
    w.state = "merged";
    make().update(snap);
    await settle();
    expect(w.lands).toBe(0);
    expect(w.filed).toBe(1);
    expect(w.db.listEvents(w.card.id).some((e) => e.type === "card.pr_merged")).toBe(true);
  });

  it("a new PR opened by the agent after a merge is followed afresh, not filed done", async () => {
    const { w, make } = world(() => {});
    w.db.recordEvent(w.card.id, "card.pr_merged", {});
    w.db.recordEvent(w.card.id, "card.pr_updated", { url: "u2" }); // the agent's own `gh pr create`
    w.db.recordEvent(w.card.id, "card.pr_follow", {});
    expect(followsOf(w.db.listPrEvents()).get(w.card.id)?.merged).toBe(false);
    make().update(snap);
    await settle();
    expect(w.filed).toBe(0);
    expect(w.lands).toBe(1);
  });

  it("a land refused by the integration lock journals nothing and is asked again on the next tick", async () => {
    let busy = true;
    const { w, make } = world((db, c, gate) => {
      if (busy) return "busy";
      db.recordRunEvent(c.id, "run.merge", { runId: gate.runId, merged: true, reason: "green" } as never);
    });
    const f = make();
    f.update(snap);
    await settle();
    expect(w.filed).toBe(0);
    expect(w.db.listEvents(w.card.id).some((e) => e.type === "run.merge")).toBe(false);
    busy = false;
    f.update(snap); // same clock: the refused ask did not start the 30 s wait
    await settle();
    expect(w.filed).toBe(1);
  });

  it("a plain PR is not followed", async () => {
    const { w, make } = world(() => {});
    w.db.recordEvent(w.card.id, "card.pr_closed", {});
    w.db.recordEvent(w.card.id, "card.pr_opened", { url: "u2" }); // a new PR, opened without "& done"
    make().update(snap);
    await settle();
    expect(w.lands).toBe(0);
    expect(w.filed).toBe(0);
    expect(runIdOf(w.db, w.card.id)).toStartWith("pr-follow-");
  });
});
