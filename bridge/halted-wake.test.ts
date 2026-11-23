import { describe, expect, it } from "bun:test";

import { BoardDb } from "./db.ts";
import { HaltedWaker, REMIND_MS } from "./halted-wake.ts";
import type { EngineSnapshot } from "./state-engine.ts";

const flush = () => new Promise((r) => setTimeout(r, 0));
const snap = (status: string | null) =>
  ({
    bridge: "connected",
    shellPanes: [],
    agents: status ? [{ paneId: "o1", workspaceLabel: "orchestrator-r", cwd: "/g/r", status }] : [],
  }) as unknown as EngineSnapshot;

function world() {
  const db = new BoardDb(":memory:");
  const card = db.createCard({ title: "a", repoPath: "/g/r", status: "working" });
  const run = db.createRun({ repoPath: "/g/r", cardIds: [card.id], foldInCap: 0, name: "Sélecteur" });
  db.launchRun(run.id);
  db.recordRunEvent(card.id, "run.halted", { runId: run.id, reason: "lead muet 266 min" });
  const sent: string[] = [];
  const clock = { t: Date.now() };
  let lands = true;
  const waker = () =>
    new HaltedWaker(db, {} as never, () => clock.t, async (_h, _p, text) => {
      sent.push(text);
      return lands;
    });
  return { db, card, run, sent, clock, waker, setLands: (v: boolean) => (lands = v) };
}

describe("HaltedWaker", () => {
  it("tells a halted lot with its reason, then waits for the reminder", async () => {
    const w = world();
    const k = w.waker();
    k.update(snap("idle"));
    await flush();
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]).toContain("Sélecteur");
    expect(w.sent[0]).toContain("lead muet 266 min");
    w.clock.t += 60_000;
    k.update(snap("idle"));
    await flush();
    expect(w.sent).toHaveLength(1);
    w.clock.t += REMIND_MS;
    k.update(snap("idle"));
    await flush();
    expect(w.sent).toHaveLength(2);
  });

  it("retries a wake lost while the orchestrator was not ready", async () => {
    const w = world();
    const k = w.waker();
    k.update(snap("unknown")); // relaunched by resume-lost: not ready, nothing sent
    await flush();
    expect(w.sent).toHaveLength(0);
    w.setLands(false);
    w.clock.t += 60_000;
    k.update(snap("idle")); // sent, but it did not land
    await flush();
    expect(w.sent).toHaveLength(1);
    w.setLands(true);
    w.clock.t += 60_000;
    k.update(snap("idle"));
    await flush();
    expect(w.sent).toHaveLength(2);
    w.clock.t += 60_000;
    k.update(snap("idle"));
    await flush();
    expect(w.sent).toHaveLength(2);
  });

  it("re-announces after a bridge restart what was never heard, and keeps the cadence of what was", async () => {
    const w = world();
    w.waker().update(snap(null)); // no orchestrator before the restart
    await flush();
    expect(w.sent).toHaveLength(0);
    const fresh = w.waker();
    fresh.update(snap("idle"));
    await flush();
    expect(w.sent).toHaveLength(1);
    w.waker().update(snap("idle")); // restarted again: told moments ago, from the journal
    await flush();
    expect(w.sent).toHaveLength(1);
  });

  it("goes quiet once the lot is resumed", async () => {
    const w = world();
    w.db.recordRunEvent(w.card.id, "run.resumed", { runId: w.run.id });
    const k = w.waker();
    k.update(snap("idle"));
    w.clock.t += REMIND_MS * 2;
    k.update(snap("idle"));
    await flush();
    expect(w.sent).toHaveLength(0);
  });

  it("does not type into a busy orchestrator", async () => {
    const w = world();
    w.waker().update(snap("working"));
    await flush();
    expect(w.sent).toHaveLength(0);
  });
});
