import { describe, expect, it } from "bun:test";

import { BoardDb } from "./db.ts";
import { STUCK_AFTER_MS, StuckCards, stuckState, stuckStep } from "./stuck-card.ts";
import type { EngineSnapshot } from "./state-engine.ts";

const flush = () => new Promise((r) => setTimeout(r, 0));
const MIN = 60_000;

describe("stuckStep", () => {
  it("fires once past the threshold, not before, and re-arms when the card moves", () => {
    let s = stuckStep(undefined, "k", 0);
    expect(s.fire).toBe(false);
    s = stuckStep(s.next, "k", STUCK_AFTER_MS - 1);
    expect(s.fire).toBe(false);
    s = stuckStep(s.next, "k", STUCK_AFTER_MS);
    expect(s.fire).toBe(true);
    s = stuckStep(s.next, "k", 5 * STUCK_AFTER_MS);
    expect(s.fire).toBe(false);
    // The card moved: a new episode, counted from now.
    s = stuckStep(s.next, "k2", 5 * STUCK_AFTER_MS);
    expect(s.fire).toBe(false);
    expect(stuckStep(s.next, "k2", 6 * STUCK_AFTER_MS).fire).toBe(true);
    // Working again ends the episode.
    expect(stuckStep(s.next, null, 7 * STUCK_AFTER_MS).next).toBeUndefined();
  });

  it("reads working as progress, everything else as a stall", () => {
    expect(stuckState("working")).toBeNull();
    expect(stuckState("blocked")).toBe("blocked");
    expect(stuckState("idle")).toBe("idle");
    expect(stuckState(undefined)).toBe("absent");
    expect(stuckState("idle", "shell")).toContain("shell");
  });
});

describe("StuckCards", () => {
  function world() {
    let t = 0;
    const db = new BoardDb(":memory:");
    const sent: string[] = [];
    const herdr = {
      getAgent: async () => ({ interactive_ready: true, agent_status: "idle" }),
      promptAgent: async (o: { target: string; text: string }) => void sent.push(o.text),
      sendPaneKeys: async () => {},
      readPane: async () => ({ text: "Allow edit to foo.ts?\n❯ 1. Yes\n" }),
    } as never;
    const card = db.createCard({ title: "carte x", repoPath: "/g/r", status: "ready" });
    const run = db.createRun({ repoPath: "/g/r", cardIds: [card.id], foldInCap: 0, name: "lot" });
    db.launchRun(run.id);
    db.patchCard(card.id, { status: "blocked" });
    db.openSession({ cardId: card.id, paneId: "w1" });
    const watcher = new StuckCards(db, herdr, () => t);
    const snap = (status: string, bridge = "connected") =>
      ({
        bridge,
        shellPanes: [],
        agents: [
          { paneId: "o1", workspaceLabel: "orchestrator-r", cwd: "/g/r", status: "idle" },
          { paneId: "w1", workspaceLabel: "w", cwd: "/x", status },
        ],
      }) as unknown as EngineSnapshot;
    return { db, sent, watcher, snap, card, at: (ms: number) => (t = ms) };
  }

  it("wakes the orchestrator once with the end of the screen when a permission waits 10 min", async () => {
    const w = world();
    w.watcher.update(w.snap("blocked"));
    w.at(9 * MIN);
    w.watcher.update(w.snap("blocked"));
    await flush();
    expect(w.sent).toHaveLength(0);
    w.at(10 * MIN);
    w.watcher.update(w.snap("blocked"));
    await flush();
    await flush();
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]).toContain("carte x");
    expect(w.sent[0]).toContain("blocked");
    expect(w.sent[0]).toContain("Allow edit to foo.ts?");
    w.at(60 * MIN);
    w.watcher.update(w.snap("blocked"));
    await flush();
    expect(w.sent).toHaveLength(1);
    // Working again re-arms: the next stall is a new episode.
    w.watcher.update(w.snap("working"));
    w.watcher.update(w.snap("blocked"));
    w.at(70 * MIN);
    w.watcher.update(w.snap("blocked"));
    await flush();
    await flush();
    expect(w.sent).toHaveLength(2);
  });

  it("ignores a disconnected snapshot", async () => {
    const w = world();
    w.watcher.update(w.snap("blocked", "disconnected"));
    w.at(20 * MIN);
    w.watcher.update(w.snap("blocked", "disconnected"));
    await flush();
    expect(w.sent).toHaveLength(0);
  });
});
