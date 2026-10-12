import { describe, expect, it } from "bun:test";

import { BoardDb, type Card } from "./db.ts";
import type { PrStatus } from "./git.ts";
import type { MergeGate } from "./integrate.ts";
import { followRunId, PrFollower } from "./pr-follow.ts";
import type { EngineSnapshot } from "./state-engine.ts";

const snap = { bridge: "connected" } as EngineSnapshot;
const pr = (state: PrStatus["state"]): PrStatus => ({ state, url: "u", mergedAt: null, conflicting: false, mergeable: true, createdAt: null });

/** A board with one card whose PR was opened by "PR & done", and a fake GitHub behind it. */
function world(land: (db: BoardDb, card: Card, gate: MergeGate) => void) {
  const db = new BoardDb(":memory:");
  const card = db.createCard({ title: "t", repoPath: "/repo", baseRef: "main" });
  db.recordEvent(card.id, "card.pr_opened", { url: "u" });
  db.recordEvent(card.id, "card.pr_follow", {});
  const w = { db, card, state: "open" as PrStatus["state"], filed: 0, lands: 0, clock: 0 };
  const make = () =>
    new PrFollower(
      db,
      {
        prStatus: async () => pr(w.state),
        gate: async (_c, runId) => ({ runId, ok: true, why: "no gate set" }),
        land: async (c, gate) => {
          w.lands++;
          land(db, c, gate);
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

  it("files a PR merged by someone else (GitHub's auto-merge, a human)", async () => {
    const { w, make } = world(() => {});
    w.state = "merged";
    make().update(snap);
    await settle();
    expect(w.lands).toBe(0);
    expect(w.filed).toBe(1);
    expect(w.db.listEvents(w.card.id).some((e) => e.type === "card.pr_merged")).toBe(true);
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
