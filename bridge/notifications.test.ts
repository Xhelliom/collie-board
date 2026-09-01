import { describe, expect, test } from "bun:test";

import {
  NotificationCoordinator,
  makeNotifySink,
  type Alert,
  type HerdSummary,
  type NotifyClock,
  type NotifySink,
} from "./notifications.ts";
import type { PushMessage } from "./push.ts";
import type { AgentStatus, AgentView } from "./types.ts";

// The coordinator decides whether/when a blocked/done transition becomes a push, and collapses the
// herd into a single summary. We drive it with a fake clock (fire timers on demand) and a recording
// sink, so every debounce / coalesce / retract path is exercised purely — no Bun.serve, no web-push.

class FakeClock implements NotifyClock<number> {
  private readonly timers = new Map<number, () => void>();
  private next = 1;
  schedule(fn: () => void, _delayMs: number): number {
    const id = this.next++;
    this.timers.set(id, fn);
    return id;
  }
  cancel(handle: number): void {
    this.timers.delete(handle);
  }
  /** Fire every still-armed timer (a cancelled one was already removed). */
  fireAll(): void {
    const fns = [...this.timers.values()];
    this.timers.clear();
    for (const fn of fns) fn();
  }
  get armed(): number {
    return this.timers.size;
  }
}

type Event = { kind: "render"; summary: HerdSummary } | { kind: "clear" };

class RecordingSink implements NotifySink {
  readonly events: Event[] = [];
  render(summary: HerdSummary): void {
    this.events.push({ kind: "render", summary });
  }
  clear(): void {
    this.events.push({ kind: "clear" });
  }
  /** The most recently rendered summary, or undefined if the last event was a clear / none yet. */
  get last(): HerdSummary | undefined {
    const e = this.events.at(-1);
    return e?.kind === "render" ? e.summary : undefined;
  }
  get renders(): HerdSummary[] {
    return this.events.flatMap((e) => (e.kind === "render" ? [e.summary] : []));
  }
  get clears(): number {
    return this.events.filter((e) => e.kind === "clear").length;
  }
}

function agentNamed(paneId: string, name: string, status: AgentStatus): AgentView {
  return {
    paneId,
    workspaceId: "w1",
    workspaceLabel: "demo",
    workspaceNumber: 1,
    tabId: "w1:t1",
    agent: name,
    status,
    cwd: "/home/you/demo",
    focused: false,
    kind: "agent",
  };
}
const agent = (paneId: string, status: AgentStatus) => agentNamed(paneId, "claude", status);

// `prefs` is a live, mutable object the injected `isNotifiable` reads on every call — so a test can
// flip a preference and call `coord.applyPrefs()` to exercise the runtime-change path. Defaults to
// both kinds enabled, matching the coordinator's old static {blocked,done} set (keeps the existing
// debounce/coalesce/retract suites unchanged).
function setup(prefs: { blocked: boolean; done: boolean; stalled?: boolean } = { blocked: true, done: true }) {
  const clock = new FakeClock();
  const sink = new RecordingSink();
  const live = { stalled: true, ...prefs };
  const isNotifiable = (s: string): boolean =>
    s === "blocked" ? live.blocked : s === "done" ? live.done : s === "stalled" ? live.stalled : false;
  const coord = new NotificationCoordinator(clock, sink, 30_000, isNotifiable);
  return { clock, sink, coord, prefs: live };
}

describe("NotificationCoordinator — debounce", () => {
  test("does not render until the debounce window elapses, then renders once", () => {
    const { clock, sink, coord } = setup();
    coord.onTransition(agent("p1", "blocked"), "working", "blocked");
    expect(sink.events).toEqual([]); // armed, not yet fired
    clock.fireAll();
    expect(sink.last).toEqual({
      // No card: the repo IS the subject, so the body carries only "what happened" — empty until a
      // subtitle lands (notify-subtitle.ts). Never the cwd again: that only echoed the title.
      title: "Needs you · demo",
      body: "",
      paneId: "p1",
      renotify: true,
    });
  });

  test("cancels an alert that resolves before the window elapses (handled at the desk)", () => {
    const { clock, sink, coord } = setup();
    coord.onTransition(agent("p1", "blocked"), "working", "blocked");
    coord.onTransition(agent("p1", "working"), "blocked", "working"); // resolved quickly
    clock.fireAll();
    expect(sink.events).toEqual([]);
    expect(clock.armed).toBe(0);
  });

  test("'done' uses the 'Done' marker", () => {
    const { clock, sink, coord } = setup();
    coord.onTransition(agent("p1", "done"), "working", "done");
    clock.fireAll();
    expect(sink.last?.title).toBe("Done · demo");
  });

  test("a card title is the subject, and the repo moves into the body — each appearing once", () => {
    const { clock, sink, coord } = setup();
    coord.onTransition(
      // The pane rename is deliberately NOT in the push: the subject is the work, not the worker
      // (NOTIFY_AUDIT.md §3.1). No surface names it — the alert no longer even carries it (§2.6).
      { ...agent("p1", "blocked"), paneLabel: "release branch", cardTitle: "Ship 0.86" },
      "working",
      "blocked",
    );
    clock.fireAll();
    expect(sink.last).toEqual({
      title: "Needs you · Ship 0.86",
      body: "demo",
      paneId: "p1",
      renotify: true,
    });
  });
});

describe("NotificationCoordinator — coalescing", () => {
  test("two outstanding agents collapse into one digest that buzzes", () => {
    const { clock, sink, coord } = setup();
    coord.onTransition({ ...agent("p1", "blocked"), cardTitle: "Ship 0.86" }, "working", "blocked");
    coord.onTransition({ ...agent("p2", "blocked"), cwd: "/home/you/elber" }, "working", "blocked");
    clock.fireAll();
    // p1 renders as a single, then p2 promotes it to a digest. The body lists the SUBJECTS: the old
    // `claude, codex` named the panes with the one word herdr reports for all of them, so a digest
    // of three said "claude, claude, claude" (NOTIFY_AUDIT.md §2.1).
    expect(sink.renders.at(-1)).toEqual({
      title: "2 questions",
      body: "Ship 0.86 · elber",
      paneId: undefined,
      renotify: true,
    });
  });

  // §3.5 — the body has two lines to fill and three subjects fill them. A fourth becomes `+1`, and a
  // card title longer than a line is clipped, so one verbose card can't push the others off-screen.
  test("a big herd shows three subjects and counts the rest", () => {
    const { clock, sink, coord } = setup();
    const titles = [
      "Remplacer les noms d'agents par les sujets dans le digest",
      "Ship 0.86",
      "The container",
      "Mesurer la lecture",
      "Auditer les notifications",
    ];
    titles.forEach((cardTitle, i) => coord.onTransition({ ...agent(`p${i}`, "blocked"), cardTitle }, "working", "blocked"));
    clock.fireAll();
    expect(sink.last?.body).toBe("Remplacer les noms d'agents par… · Ship 0.86 · The container · +2");
  });

  // A subject that resolves to nothing costs its own entry and nothing else — no ` ·  · ` hole, and
  // the title still counts it.
  test("a subjectless alert drops out of the body instead of leaving a gap", () => {
    const { clock, sink, coord } = setup();
    coord.onTransition({ ...agent("p1", "blocked"), cardTitle: "Ship 0.86" }, "working", "blocked");
    coord.onTransition({ ...agent("p2", "blocked"), cwd: "" }, "working", "blocked");
    clock.fireAll();
    expect(sink.last).toEqual({ title: "2 questions", body: "Ship 0.86", paneId: undefined, renotify: true });
  });

  test("two agents in the same repo say it once — the count is already in the title", () => {
    const { clock, sink, coord } = setup();
    coord.onTransition(agent("p1", "blocked"), "working", "blocked");
    coord.onTransition(agent("p2", "blocked"), "working", "blocked");
    clock.fireAll();
    expect(sink.last?.body).toBe("demo");
  });

  // §3.5 — the headline counts WHAT IS WAITING, by state, not how many agents produced it: the old
  // `3 agents done` counted the one field that is the same word on every pane (§2.1).
  test("a mixed herd counts each state, most urgent first", () => {
    const { clock, sink, coord } = setup();
    coord.onTransition(agentNamed("p1", "claude", "blocked"), "working", "blocked");
    coord.onTransition(agentNamed("p2", "codex", "done"), "working", "done");
    clock.fireAll();
    expect(sink.last?.title).toBe("1 question, 1 done");
  });

  test("a uniform herd names only the state it has", () => {
    const { clock, sink, coord } = setup();
    coord.onTransition(agent("p1", "done"), "working", "done");
    coord.onTransition({ ...agent("p2", "done"), cwd: "/home/you/elber" }, "working", "done");
    clock.fireAll();
    expect(sink.last?.title).toBe("2 done");
  });

  test("resolving one of two falls back to the named single, silently", () => {
    const { clock, sink, coord } = setup();
    coord.onTransition(agentNamed("p1", "claude", "blocked"), "working", "blocked");
    coord.onTransition(agentNamed("p2", "codex", "blocked"), "working", "blocked");
    clock.fireAll();
    coord.onTransition(agentNamed("p2", "codex", "idle"), "blocked", "idle"); // codex handled
    expect(sink.last).toEqual({
      title: "Needs you · demo",
      body: "",
      paneId: "p1",
      renotify: false, // a retraction update must not re-buzz
    });
  });
});

describe("NotificationCoordinator — currentSolo", () => {
  test("undefined before anything fires", () => {
    const { coord } = setup();
    expect(coord.currentSolo("p1")).toBeUndefined();
  });

  test("the outstanding alert once it's the sole one", () => {
    const { clock, coord } = setup();
    coord.onTransition(agentNamed("p1", "claude", "blocked"), "working", "blocked");
    clock.fireAll();
    expect(coord.currentSolo("p1")?.status).toBe("blocked");
  });

  test("undefined once a second alert joins it — the summary is now a digest", () => {
    const { clock, coord } = setup();
    coord.onTransition(agentNamed("p1", "claude", "blocked"), "working", "blocked");
    coord.onTransition(agentNamed("p2", "codex", "blocked"), "working", "blocked");
    clock.fireAll();
    expect(coord.currentSolo("p1")).toBeUndefined();
  });

  test("undefined again once the sole alert resolves", () => {
    const { clock, coord } = setup();
    coord.onTransition(agentNamed("p1", "claude", "blocked"), "working", "blocked");
    clock.fireAll();
    coord.onTransition(agentNamed("p1", "claude", "idle"), "blocked", "idle");
    expect(coord.currentSolo("p1")).toBeUndefined();
  });

  test("querying the wrong paneId misses even while solo", () => {
    const { clock, coord } = setup();
    coord.onTransition(agentNamed("p1", "claude", "blocked"), "working", "blocked");
    clock.fireAll();
    expect(coord.currentSolo("p2")).toBeUndefined();
  });
});

describe("NotificationCoordinator — retraction", () => {
  test("clears the herd once the last outstanding agent resolves", () => {
    const { clock, sink, coord } = setup();
    coord.onTransition(agent("p1", "blocked"), "working", "blocked");
    clock.fireAll();
    coord.onTransition(agent("p1", "idle"), "blocked", "idle");
    expect(sink.events.at(-1)).toEqual({ kind: "clear" });
  });

  test("clears the herd when the pane disappears", () => {
    const { clock, sink, coord } = setup();
    coord.onTransition(agent("p1", "blocked"), "working", "blocked");
    clock.fireAll();
    coord.onRemove("p1");
    expect(sink.events.at(-1)).toEqual({ kind: "clear" });
  });

  test("removal before delivery cancels without rendering or clearing", () => {
    const { clock, sink, coord } = setup();
    coord.onTransition(agent("p1", "blocked"), "working", "blocked");
    coord.onRemove("p1");
    clock.fireAll();
    expect(sink.events).toEqual([]);
  });

  test("a second resolution does not emit a second clear", () => {
    const { clock, sink, coord } = setup();
    coord.onTransition(agent("p1", "blocked"), "working", "blocked");
    clock.fireAll();
    coord.onTransition(agent("p1", "idle"), "blocked", "idle");
    coord.onTransition(agent("p1", "working"), "idle", "working");
    expect(sink.clears).toBe(1);
  });
});

describe("NotificationCoordinator — type preferences", () => {
  test("with default prefs (done off), a done transition never pushes — even after the window", () => {
    const { clock, sink, coord } = setup({ blocked: true, done: false });
    coord.onTransition(agent("p1", "done"), "working", "done");
    expect(clock.armed).toBe(0); // a disabled kind isn't even debounced
    clock.fireAll();
    expect(sink.events).toEqual([]);
  });

  test("with done enabled, a done transition pushes after the window", () => {
    const { clock, sink, coord } = setup({ blocked: false, done: true });
    coord.onTransition(agent("p1", "done"), "working", "done");
    expect(sink.events).toEqual([]); // still debouncing
    clock.fireAll();
    expect(sink.last?.title).toBe("Done · demo");
  });

  test("with blocked disabled, a blocked transition doesn't push", () => {
    const { clock, sink, coord } = setup({ blocked: false, done: true });
    coord.onTransition(agent("p1", "blocked"), "working", "blocked");
    expect(clock.armed).toBe(0);
    clock.fireAll();
    expect(sink.events).toEqual([]);
  });

  test("disabling a kind at runtime retracts an already-outstanding alert of that kind", () => {
    const { clock, sink, coord, prefs } = setup({ blocked: true, done: true });
    coord.onTransition(agent("p1", "done"), "working", "done");
    clock.fireAll();
    expect(sink.last?.title).toBe("Done · demo"); // delivered
    prefs.done = false; // preference changes at runtime…
    coord.applyPrefs(); // …and the API hook re-evaluates the herd
    expect(sink.events.at(-1)).toEqual({ kind: "clear" }); // the done alert is retracted
  });

  test("disabling a kind at runtime cancels a still-pending alert of that kind", () => {
    const { clock, sink, coord, prefs } = setup({ blocked: true, done: true });
    coord.onTransition(agent("p1", "done"), "working", "done"); // debouncing, not yet delivered
    expect(clock.armed).toBe(1);
    prefs.done = false;
    coord.applyPrefs();
    expect(clock.armed).toBe(0); // timer cancelled
    clock.fireAll();
    expect(sink.events).toEqual([]); // nothing was ever shown
  });

  test("a blocked alert is retracted when the agent finishes and done-pushes are off", () => {
    const { clock, sink, coord } = setup({ blocked: true, done: false });
    coord.onTransition(agent("p1", "blocked"), "working", "blocked");
    clock.fireAll();
    expect(sink.last?.title).toBe("Needs you · demo");
    // The agent completes, but done pushes are disabled — so this is a non-notifiable transition
    // that resolves (retracts) the outstanding blocked alert rather than replacing it.
    coord.onTransition(agent("p1", "done"), "blocked", "done");
    expect(sink.events.at(-1)).toEqual({ kind: "clear" });
  });
});

describe("makeNotifySink", () => {
  const summary: HerdSummary = {
    title: "Needs you · Ship 0.86",
    body: "demo",
    paneId: "p1",
    renotify: true,
  };
  class RecordingPush {
    readonly sent: PushMessage[] = [];
    send(msg: PushMessage): void {
      this.sent.push(msg);
    }
  }

  test("render maps the summary onto a single herd-tagged push", () => {
    const push = new RecordingPush();
    makeNotifySink(push, { isMuted: () => false }, "collie:herd").render(summary);
    expect(push.sent).toEqual([
      { title: "Needs you · Ship 0.86", body: "demo", tag: "collie:herd", paneId: "p1", renotify: true },
    ]);
  });

  test("clear maps to a clear push on the herd tag", () => {
    const push = new RecordingPush();
    makeNotifySink(push, { isMuted: () => false }, "collie:herd").clear();
    expect(push.sent).toEqual([{ type: "clear", tag: "collie:herd" }]);
  });

  // A "card to read" summary (§4.1) carries its destination; every other one must not gain a field.
  test("the sink puts the card in the push payload, and leaves it out otherwise", () => {
    const push = new RecordingPush();
    const sink = makeNotifySink(push, { isMuted: () => false }, "collie:herd");
    sink.render({ title: "Review · Ship it", body: "demo", paneId: "p1", cardId: "c1", renotify: true });
    sink.render({ title: "Done · demo", body: "", paneId: "p1", renotify: true });
    expect(push.sent.map((m) => m.cardId)).toEqual(["c1", undefined]);
  });

  test("an active snooze suppresses both render and clear", () => {
    const push = new RecordingPush();
    const sink = makeNotifySink(push, { isMuted: () => true }, "collie:herd");
    sink.render(summary);
    sink.clear();
    expect(push.sent).toEqual([]);
  });
});

// The subtitle hook is awaited between the debounce expiring and the render (NOTIFY_AUDIT.md §N10),
// so the alert can now be handled DURING that wait — the one new race the await introduces.
describe("NotificationCoordinator — the awaited subtitle hook", () => {
  function setupAwaiting(subtitleFor: () => Promise<string | null>) {
    const beforeFire = async () => ({ subtitle: await subtitleFor() });
    const clock = new FakeClock();
    const sink = new RecordingSink();
    const coord = new NotificationCoordinator(
      clock,
      sink,
      30_000,
      (s: string) => s === "blocked" || s === "done",
      undefined,
      beforeFire,
    );
    return { clock, sink, coord };
  }
  const settle = () => new Promise((r) => setTimeout(r, 5));

  test("the first render already carries the subtitle, still buzzing", async () => {
    const { clock, sink, coord } = setupAwaiting(async () => "3 files, +180 -12");
    coord.onTransition(agent("p1", "done"), "working", "done");
    clock.fireAll();
    await settle();
    expect(sink.renders).toEqual([
      { title: "Done · demo", body: "3 files, +180 -12", paneId: "p1", renotify: true },
    ]);
  });

  test("an alert handled while the hook was still working never lands", async () => {
    let release = (_: string | null) => {};
    const { clock, sink, coord } = setupAwaiting(() => new Promise((r) => (release = r)));
    coord.onTransition(agent("p1", "done"), "working", "done");
    clock.fireAll();
    coord.onTransition(agent("p1", "idle"), "done", "idle"); // handled at the desk mid-wait
    release("too late to matter");
    await settle();
    expect(sink.renders).toEqual([]);
  });

  test("a hook that rejects costs the body, never the alert", async () => {
    const { clock, sink, coord } = setupAwaiting(async () => {
      throw new Error("transcript unreadable");
    });
    coord.onTransition(agent("p1", "blocked"), "working", "blocked");
    clock.fireAll();
    await settle();
    expect(sink.renders).toEqual([{ title: "Needs you · demo", body: "", paneId: "p1", renotify: true }]);
  });
});

// NOTIFY_AUDIT.md §4.1: a pane that finished on a card the board has since moved to `review` gets a
// notification ABOUT THE CARD — marker, subject and destination. The card's status can only be read
// once the debounce is up (§4.2), which is why it arrives through the same pre-fire hook as the
// subtitle. §4.3's five edge cases: rows 1 and 2 are pure composition (notify-content.test.ts); the
// three below are behaviours of this class.
describe("NotificationCoordinator — the card to read", () => {
  /** A pane backing card `c1`, exactly as `withCardFields` hands it over. */
  const onCard = (paneId: string, status: AgentStatus, cardId = "c1"): AgentView => ({
    ...agent(paneId, status),
    cardId,
    cardTitle: cardId === "c1" ? "Ship it" : "The container",
  });

  /** Like `setup`, plus the pre-fire hook telling the alert what its card reads NOW. */
  function setupOnCard(cardStatus?: string) {
    const clock = new FakeClock();
    const sink = new RecordingSink();
    const coord = new NotificationCoordinator(
      clock,
      sink,
      30_000,
      (s: string) => s === "blocked" || s === "done",
      undefined,
      async () => ({ cardStatus }),
    );
    return { clock, sink, coord };
  }
  const settle = () => new Promise((r) => setTimeout(r, 5));

  test("the alert is about the card: `Review`, its title, and a tap that opens it", async () => {
    const { clock, sink, coord } = setupOnCard("review");
    coord.onTransition(onCard("p1", "done"), "working", "done");
    clock.fireAll();
    await settle();
    expect(sink.last).toEqual({
      title: "Review · Ship it",
      body: "demo",
      paneId: "p1",
      cardId: "c1",
      renotify: true,
    });
  });

  test("§4.3 row 1 — a card that is not in review keeps `Done` and the pane deep-link", async () => {
    const { clock, sink, coord } = setupOnCard("done");
    coord.onTransition(onCard("p1", "done"), "working", "done");
    clock.fireAll();
    await settle();
    expect(sink.last?.title).toBe("Done · Ship it");
    expect(sink.last?.cardId).toBeUndefined();
  });

  // §3.5 — the digest counts by the SAME marker a single alert's title uses, so `Review` there and
  // `to review` here can never disagree about what one of the collapsed alerts was.
  test("a digest counts cards in review as `to review`, questions first", async () => {
    const { clock, sink, coord } = setupOnCard("review");
    coord.onTransition(onCard("p1", "done"), "working", "done");
    coord.onTransition(onCard("p2", "done", "c2"), "working", "done");
    coord.onTransition(agentNamed("p3", "codex", "blocked"), "working", "blocked");
    clock.fireAll();
    await settle();
    expect(sink.last?.title).toBe("1 question, 2 to review");
    expect(sink.last?.body).toBe("Ship it · The container · demo");
  });

  test("§4.3 row 2 — a pane with no card is byte-for-byte what it was", async () => {
    const { clock, sink, coord } = setupOnCard(undefined);
    coord.onTransition(agent("p1", "done"), "working", "done");
    clock.fireAll();
    await settle();
    expect(sink.last).toEqual({ title: "Done · demo", body: "", paneId: "p1", renotify: true });
  });

  test("§4.3 row 3 — a pane back at work before the window is up never notifies, review or not", async () => {
    const { clock, sink, coord } = setupOnCard("review");
    coord.onTransition(onCard("p1", "done"), "working", "done");
    coord.onTransition(onCard("p1", "working"), "done", "working"); // the operator asked for more
    clock.fireAll();
    await settle();
    expect(sink.events).toEqual([]);
  });

  test("§4.3 row 4 — a subtask notifies for itself; its container has no pane to notify from", async () => {
    const { clock, sink, coord } = setupOnCard("review");
    // `cards.ts` derives the container's own `review` from its subtasks, but a container has no pane,
    // so no transition ever reaches here for it. One event, one alert, pointing at the SUBTASK.
    coord.onTransition(onCard("p1", "done", "c1"), "working", "done");
    clock.fireAll();
    await settle();
    expect(sink.renders).toHaveLength(1);
    expect(sink.last?.cardId).toBe("c1");
  });

  test("§4.3 row 5 — a card reaching review with no pane transition behind it changes nothing", async () => {
    // The pane fired while its card still read something else; the card lands in review afterwards
    // (a hand-relaunched review). Nothing announces that here — a board-sourced notification is card
    // N6 — so the alert stays exactly what it was, and nothing is left armed to re-fire.
    const { clock, sink, coord } = setupOnCard("working");
    coord.onTransition(onCard("p1", "done"), "working", "done");
    clock.fireAll();
    await settle();
    expect(sink.renders.map((r) => r.title)).toEqual(["Done · Ship it"]);
    expect(clock.armed).toBe(0);
  });
});

// An alert the BOARD raised: keyed by card, no pane behind it, and retracted by its own predicate
// rather than by a transition (bridge/board-notify.ts, NOTIFY_AUDIT.md §6.4).
const stalled = (cardId: string, cardTitle: string): Alert => ({
  cwd: "/src/collie-board",
  status: "stalled",
  cardId,
  cardTitle,
  subtitle: "its agent's pane is gone",
});

describe("NotificationCoordinator — an alert that is not a pane", () => {
  test("arms under an opaque key, and its tap goes to the card because there is no pane", () => {
    const { clock, sink, coord } = setup();
    coord.arm("card:c1", stalled("c1", "Ship it"));
    clock.fireAll();

    expect(sink.last?.title).toBe("Stalled · Ship it");
    expect(sink.last?.body).toBe("collie-board · its agent's pane is gone");
    expect(sink.last?.paneId).toBeUndefined();
    expect(sink.last?.cardId).toBe("c1");
  });

  test("retract() takes it back out of the summary, same as a resolved transition", () => {
    const { clock, sink, coord } = setup();
    coord.arm("card:c1", stalled("c1", "Ship it"));
    clock.fireAll();
    coord.retract("card:c1");
    expect(sink.clears).toBe(1);
  });

  test("retract() before the debounce expires sends nothing at all", () => {
    const { clock, sink, coord } = setup();
    coord.arm("card:c1", stalled("c1", "Ship it"));
    coord.retract("card:c1");
    clock.fireAll();
    expect(sink.events).toHaveLength(0);
  });

  test("the preference is honoured live, like every other kind", () => {
    const { clock, sink, coord, prefs } = setup({ blocked: true, done: true, stalled: false });
    coord.arm("card:c1", stalled("c1", "Ship it"));
    clock.fireAll();
    expect(sink.events).toHaveLength(0);

    prefs.stalled = true;
    coord.arm("card:c1", stalled("c1", "Ship it"));
    clock.fireAll();
    expect(sink.last?.title).toBe("Stalled · Ship it");

    // …and turning it back off retracts what it already delivered.
    prefs.stalled = false;
    coord.applyPrefs();
    expect(sink.clears).toBe(1);
  });

  test("a pane alert and a board alert share one digest — one slot, one notification", () => {
    const { clock, sink, coord } = setup();
    coord.onTransition(agent("p1", "blocked"), "working", "blocked");
    coord.arm("card:c1", stalled("c1", "Ship it"));
    coord.arm("card:c2", stalled("c2", "Fix it"));
    clock.fireAll();

    // Order is by urgency and fixed, not by size — see DIGEST_COUNTS.
    expect(sink.last?.title).toBe("1 question, 2 stalled");
    expect(sink.last?.paneId).toBeUndefined();
  });

  test("a restarted herdr: the whole board lands in ONE digest on ONE slot", async () => {
    // What `reconcile()` does when every pane vanishes at once. The four alerts are separate timers,
    // so they render one after another as the digest grows — the device shows one notification (the
    // slot is shared) but it costs one message per card to get there. That last part is a known
    // ceiling, stated at `emit`; what this pins down is the END STATE, which is what the operator
    // sees: one digest counting the whole board, not four notifications (NOTIFY_AUDIT.md §6.3).
    const clock = new FakeClock();
    const sink = new RecordingSink();
    const coord = new NotificationCoordinator(clock, sink, 30_000, () => true, undefined, async () => ({}));
    for (const id of ["c1", "c2", "c3", "c4"]) coord.arm(`card:${id}`, stalled(id, id));
    clock.fireAll();
    await new Promise((r) => setTimeout(r, 5));

    expect(sink.last?.title).toBe("4 stalled");
    expect(sink.last?.paneId).toBeUndefined();
    expect(sink.clears).toBe(0);
  });
});
