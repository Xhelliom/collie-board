import { describe, expect, test } from "bun:test";

import { NOTIFY_LOG_MAX, NotifyLog } from "./notify-log.ts";
import { NotificationCoordinator, type NotifyClock, type NotifySink } from "./notifications.ts";
import type { AgentStatus, AgentView } from "./types.ts";

function entry(n: number) {
  return { agent: `a${n}`, workspaceLabel: "demo", cwd: "/tmp", status: "blocked" as const, paneId: `w1:p${n}` };
}

describe("NotifyLog", () => {
  test("newest first, stamped from the injected clock", () => {
    let now = 1000;
    const log = new NotifyLog(() => now);
    log.add(entry(1));
    now = 2000;
    log.add(entry(2));

    const [first, second] = log.recent();
    expect(first?.paneId).toBe("w1:p2");
    expect(first?.ts).toBe(2000);
    expect(second?.paneId).toBe("w1:p1");
    // Ids are distinct so React can key the list without falling back to the index.
    expect(first?.id).not.toBe(second?.id);
  });

  test("caps at NOTIFY_LOG_MAX, dropping the oldest", () => {
    const log = new NotifyLog(() => 0);
    for (let i = 0; i < NOTIFY_LOG_MAX + 10; i++) log.add(entry(i));

    const kept = log.recent();
    expect(kept).toHaveLength(NOTIFY_LOG_MAX);
    expect(kept[0]?.paneId).toBe(`w1:p${NOTIFY_LOG_MAX + 9}`);
    expect(kept.at(-1)?.paneId).toBe("w1:p10");
  });

  test("recent() hands out a copy", () => {
    const log = new NotifyLog(() => 0);
    log.add(entry(1));
    log.recent().pop();
    expect(log.recent()).toHaveLength(1);
  });
});

// The coordinator's history hook: one record per alert that survives the debounce, and nothing for
// one that resolves inside it (the very case the debounce exists to swallow). A retraction leaves
// the history alone — what happened happened.
describe("NotificationCoordinator → history", () => {
  const agent = (paneId: string, status: AgentStatus): AgentView =>
    ({ paneId, workspaceLabel: "demo", cwd: "/tmp", agent: "claude", status }) as AgentView;

  function harness() {
    const timers: Array<() => void> = [];
    const clock: NotifyClock<number> = {
      schedule: (fn) => timers.push(fn) - 1,
      cancel: (h) => {
        timers[h] = () => {};
      },
    };
    const sink: NotifySink = { render: () => {}, clear: () => {} };
    const fired: string[] = [];
    const coord = new NotificationCoordinator(
      clock,
      sink,
      10,
      (s) => s === "blocked" || s === "done",
      (a) => fired.push(`${a.paneId}:${a.status}`),
    );
    return { coord, fired, fire: () => timers.splice(0).forEach((fn) => fn()) };
  }

  test("records a fired alert once, with its pane", () => {
    const { coord, fired, fire } = harness();
    coord.onTransition(agent("w1:p1", "blocked"), "working", "blocked");
    fire();
    expect(fired).toEqual(["w1:p1:blocked"]);

    // Retracting it (handled at the desk) must not touch the history.
    coord.onTransition(agent("w1:p1", "working"), "blocked", "working");
    expect(fired).toEqual(["w1:p1:blocked"]);
  });

  test("an alert resolved inside the debounce never reaches the history", () => {
    const { coord, fired, fire } = harness();
    coord.onTransition(agent("w1:p1", "blocked"), "working", "blocked");
    coord.onTransition(agent("w1:p1", "working"), "blocked", "working");
    fire();
    expect(fired).toEqual([]);
  });
});
