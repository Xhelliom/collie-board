import { describe, expect, it } from "bun:test";

import { BoardDb } from "./db.ts";
import { NUDGE_TEXT, STUCK_AFTER_MS, StuckCards, nudgeState, screenPrint, stuckState, stuckStep } from "./stuck-card.ts";
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

describe("nudge rule", () => {
  it("ignores the spinner and the digits that tick on a hung screen, not new output", () => {
    const a = "$ bun run build\nbuilding…\n✽ Vibing… (1m 41s · ↓ 7.6k tokens)\n● full  $0.00  12s\n  esc to interrupt";
    const b = "$ bun run build\nbuilding…\n✻ Vibing… (61m 2s · ↑ 9.1k tokens)\n● full  $0.00  3671s\n  esc to interrupt";
    expect(screenPrint(a)).toBe(screenPrint(b));
    expect(screenPrint(a + "\ncompiled web/")).not.toBe(screenPrint(a));
  });

  it("reads idle/done as idle, working only with a screen, never a shell or a blocked pane", () => {
    expect(nudgeState("idle", "agent", undefined)).toBe("idle");
    expect(nudgeState("done", undefined, undefined)).toBe("idle");
    expect(nudgeState("working", "agent", undefined)).toBeNull();
    expect(nudgeState("working", "agent", "x")).toBe("working|x");
    expect(nudgeState("blocked", "agent", "x")).toBeNull();
    expect(nudgeState("idle", "shell", undefined)).toBeNull();
    expect(nudgeState(undefined, undefined, undefined)).toBeNull();
  });
});

describe("StuckCards — asking the agent", () => {
  function world(screens: string[]) {
    let t = 0;
    const db = new BoardDb(":memory:");
    const sent: { pane: string; text: string }[] = [];
    const keys: string[][] = [];
    let read = 0;
    const herdr = {
      getAgent: async () => ({ interactive_ready: true, agent_status: "working" }),
      promptAgent: async (o: { target: string; text: string }) => void sent.push({ pane: o.target, text: o.text }),
      sendPaneKeys: async (_p: string, k: string[]) => void keys.push(k),
      readPane: async () => ({ text: screens[Math.min(read++, screens.length - 1)]! }),
    } as never;
    // Not in a lot: the nudge watches every card « en cours » with an agent.
    const card = db.createCard({ title: "carte y", repoPath: "/g/r", status: "ready" });
    db.patchCard(card.id, { status: "working" });
    db.openSession({ cardId: card.id, paneId: "w1" });
    const watcher = new StuckCards(db, herdr, () => t, STUCK_AFTER_MS, 60 * MIN, async () => {});
    const snap = (status: string) =>
      ({ bridge: "connected", shellPanes: [], agents: [{ paneId: "w1", workspaceLabel: "w", cwd: "/x", status }] }) as unknown as EngineSnapshot;
    // One tick every 5 min up to `min`.
    const run = async (status: string, from: number, to: number) => {
      for (let m = from; m <= to; m += 5) {
        t = m * MIN;
        watcher.update(snap(status));
        await flush();
        await flush();
      }
    };
    return { sent, keys, run };
  }

  it("asks an idle agent once, after an hour, outside any lot", async () => {
    const w = world([]);
    await w.run("idle", 0, 55);
    expect(w.sent).toHaveLength(0);
    await w.run("idle", 60, 180);
    expect(w.sent).toEqual([{ pane: "w1", text: NUDGE_TEXT }]);
    expect(w.keys).toHaveLength(0);
  });

  it("sends Escape then the question to a working agent whose screen froze for an hour, once", async () => {
    const w = world(["⏺ Bash(sleep infinity)\n✽ Vibing… (1m 0s)"]);
    await w.run("working", 0, 60);
    expect(w.sent).toHaveLength(0);
    await w.run("working", 65, 240);
    expect(w.keys).toEqual([["Escape"]]);
    expect(w.sent).toEqual([{ pane: "w1", text: NUDGE_TEXT }]);
  });

  it("leaves alone a working agent whose output moves", async () => {
    const w = world(Array.from({ length: 100 }, (_, i) => `compiling unit ${"x".repeat(i)}`));
    await w.run("working", 0, 240);
    expect(w.sent).toHaveLength(0);
    expect(w.keys).toHaveLength(0);
  });
});
