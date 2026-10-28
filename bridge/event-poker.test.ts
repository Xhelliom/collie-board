import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";

import { buildSubscriptions, EventPoker, sameIdSet, type Subscription } from "./event-poker.ts";
import type { HerdrClient } from "./herdr-client.ts";

// EventPoker owns the stream lifecycle (ack → healthy, events → throttled poke, down → backoff
// reconnect). The socket itself lives in HerdrClient.subscribeEvents and stays untested; here we
// fake it so tests drive ack/event/down synchronously and assert the decisions. Time is bun's fake
// clock: a real sleep under load (a pre-push beside running lots, a slow CI) made the counts flaky.

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
const sleep = (ms: number) => jest.advanceTimersByTime(ms);

interface FakeStream {
  subscriptions: Subscription[];
  onUp: () => void;
  onEvent: (event: string, data: unknown) => void;
  onDown: (reason: string) => void;
  closed: boolean;
}

class FakeClient {
  readonly streams: FakeStream[] = [];
  subscribeEvents(opts: {
    subscriptions: Subscription[];
    onUp: () => void;
    onEvent: (event: string, data: unknown) => void;
    onDown: (reason: string) => void;
  }): { close(): void } {
    const stream: FakeStream = { ...opts, closed: false };
    this.streams.push(stream);
    return {
      close: () => {
        if (stream.closed) return;
        stream.closed = true;
        stream.onDown("closed");
      },
    };
  }
  get last(): FakeStream {
    const s = this.streams[this.streams.length - 1];
    if (!s) throw new Error("no stream");
    return s;
  }
}

function makePoker(opts?: { windowMs?: number; backoffMs?: number[] }) {
  const client = new FakeClient();
  const poker = new EventPoker(client as unknown as HerdrClient, {
    windowMs: opts?.windowMs ?? 10,
    backoffMs: opts?.backoffMs ?? [10, 20],
  });
  const pokes: number[] = [];
  const health: boolean[] = [];
  poker.onPoke(() => pokes.push(1));
  poker.onHealth((h) => health.push(h));
  return { client, poker, pokes, health };
}

describe("buildSubscriptions / sameIdSet", () => {
  test("emits the global set (no layout/worktree/scroll/output) plus one scoped status sub per pane", () => {
    const subs = buildSubscriptions(["w1:p1", "w2:p3"]);
    const types = subs.map((s) => s.type);
    expect(types).toContain("pane.created");
    expect(types).toContain("pane.agent_detected");
    expect(types).toContain("workspace.focused");
    expect(types).not.toContain("layout.updated");
    expect(types).not.toContain("pane.scroll_changed");
    expect(types).not.toContain("pane.output_matched");
    const scoped = subs.filter((s) => s.type === "pane.agent_status_changed");
    expect(scoped).toEqual([
      { type: "pane.agent_status_changed", pane_id: "w1:p1" },
      { type: "pane.agent_status_changed", pane_id: "w2:p3" },
    ]);
    // Globals are unscoped.
    expect(subs.find((s) => s.type === "pane.created")?.pane_id).toBeUndefined();
  });

  test("sameIdSet ignores order and duplicates", () => {
    expect(sameIdSet(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameIdSet(["a", "a", "b"], ["a", "b"])).toBe(true);
    expect(sameIdSet(["a"], ["a", "b"])).toBe(false);
    expect(sameIdSet([], [])).toBe(true);
  });
});

describe("EventPoker — health", () => {
  test("goes healthy on ack and unhealthy on down, notifying each transition once", () => {
    const { client, poker, health } = makePoker();
    poker.start();
    expect(client.streams.length).toBe(1);
    client.last.onUp();
    client.last.onUp(); // duplicate ack — no second notify
    expect(health).toEqual([true]);
    client.last.onDown("socket error");
    expect(health).toEqual([true, false]);
    poker.stop();
  });
});

describe("EventPoker — throttled poke", () => {
  test("a burst pokes once at once, then once more when the window closes", () => {
    const { client, poker, pokes } = makePoker({ windowMs: 30 });
    poker.start();
    client.last.onUp();
    client.last.onEvent("pane_created", {});
    expect(pokes.length).toBe(1); // the first event pokes immediately — no wait on a status flip
    for (let i = 0; i < 20; i++) client.last.onEvent("pane_agent_status_changed", {});
    expect(pokes.length).toBe(1); // the rest of the burst waits for the window
    sleep(45);
    expect(pokes.length).toBe(2); // one catch-up for the whole burst, the last event not lost
    sleep(45);
    expect(pokes.length).toBe(2); // quiet window after it: nothing owed, no extra poke
    poker.stop();
  });

  test("a steady stream polls at most once per window", () => {
    const { client, poker, pokes } = makePoker({ windowMs: 20 });
    poker.start();
    client.last.onUp();
    for (let i = 0; i < 20; i++) {
      client.last.onEvent("pane_agent_status_changed", {});
      sleep(5);
    }
    // 100ms of events every 5ms → one poke per 20ms window (0, 20, 40, 60, 80, and the 100ms
    // catch-up for the last event), not twenty.
    expect(pokes.length).toBe(6);
    poker.stop();
  });

  test("stop drops a pending catch-up", () => {
    const { client, poker, pokes } = makePoker({ windowMs: 15 });
    poker.start();
    client.last.onUp();
    client.last.onEvent("pane_created", {});
    client.last.onEvent("pane_created", {});
    poker.stop();
    sleep(30);
    expect(pokes.length).toBe(1);
  });
});

describe("EventPoker — reconnect backoff", () => {
  test("reconnects after a down per the backoff schedule and resets on the next ack", () => {
    const { client, poker, health } = makePoker({ backoffMs: [15, 40] });
    poker.start();
    client.last.onUp();
    client.last.onDown("boom");
    expect(client.streams.length).toBe(1); // not yet — waiting out the backoff
    sleep(30);
    expect(client.streams.length).toBe(2); // reconnected (first backoff step)
    client.last.onUp(); // healthy again → backoff reset
    expect(health).toEqual([true, false, true]);
    poker.stop();
  });
});

describe("EventPoker — resubscribe on pane-set change", () => {
  test("reconnects with the new scoped subscriptions and skips a no-op set", () => {
    const { client, poker } = makePoker();
    poker.start();
    client.last.onUp();
    expect(client.streams.length).toBe(1);

    poker.setAgentPanes(["w1:p1"]);
    expect(client.streams.length).toBe(2); // resubscribed
    expect(client.streams[0]!.closed).toBe(true); // old stream torn down
    expect(
      client.last.subscriptions.some((s) => s.type === "pane.agent_status_changed" && s.pane_id === "w1:p1"),
    ).toBe(true);

    poker.setAgentPanes(["w1:p1"]); // same set — no churn
    expect(client.streams.length).toBe(2);
    poker.stop();
  });
});

describe("EventPoker — stop()", () => {
  test("closes the stream, cancels a pending reconnect, and never reconnects afterward", () => {
    const { client, poker } = makePoker({ backoffMs: [10] });
    poker.start();
    client.last.onUp();
    client.last.onDown("boom"); // schedules a reconnect
    poker.stop();
    sleep(30);
    expect(client.streams.length).toBe(1); // the scheduled reconnect was cancelled
  });

  test("closing an up stream on stop() does not flip health or schedule work", () => {
    const { client, poker, health } = makePoker();
    poker.start();
    client.last.onUp();
    poker.stop();
    expect(client.last.closed).toBe(true); // stop() closed it
    expect(health).toEqual([true]); // the deliberate close is stale — no spurious unhealthy
    sleep(20);
    expect(client.streams.length).toBe(1);
  });
});
