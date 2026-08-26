import { describe, expect, test } from "bun:test";

import { notifySubtitlePrompt, toNotifySubtitle } from "./copilot.ts";
import type { DiffStat } from "./git.ts";
import { enrichNotification, firstSubtitle, type SubtitleSources } from "./notify-subtitle.ts";
import { NotificationCoordinator } from "./notifications.ts";
import type { Alert, FiredAlert, HerdSummary, NotifySink } from "./notifications.ts";
import type { AgentStatus, AgentView } from "./types.ts";
import type { TranscriptEntry } from "./transcript.ts";

// Two stages, split where the cost is (NOTIFY_AUDIT.md §N10):
//   • firstSubtitle — tiers 2 and 3, awaited BEFORE the one buzzing push, so it returns a string
//     rather than rendering one. Tested by its return value.
//   • enrichNotification — the copilot's later, silent update, and nothing else. Tested by what it
//     renders (or refuses to render, when the pane has moved on).
// Everything is driven by fakes: no real copilot pane, git checkout, or transcript file.

function baseAlert(overrides: Partial<FiredAlert> = {}): FiredAlert {
  return {
    paneId: "p1",
    agent: "claude",
    workspaceLabel: "demo",
    cwd: "/home/you/demo",
    status: "done",
    ...overrides,
  };
}

class RecordingSink implements NotifySink {
  readonly renders: HerdSummary[] = [];
  render(summary: HerdSummary): void {
    this.renders.push(summary);
  }
  clear(): void {}
}

function fakeCoordinator(alert: Alert | undefined) {
  return { currentSolo: (_paneId: string) => alert };
}

function fakeCopilot(answer: unknown, enabled = true) {
  let calls = 0;
  return {
    enabled,
    ask: async (buildPrompt: (outPath: string) => string) => {
      calls++;
      buildPrompt("out.json"); // exercised for its side effect (none) — mirrors the real call shape
      return answer;
    },
    get calls() {
      return calls;
    },
  };
}

function fakeBoard(card: { title: string; spec: string | null } | null) {
  return { getCard: (_id: string) => card };
}

function textEntry(role: TranscriptEntry["role"], text: string): TranscriptEntry {
  return { uuid: "u1", ts: "", role, parts: [{ kind: "text", text }] };
}

/** `byPath` entries answer `pageAt` — the resolvePath fallback for a pane with no reported session. */
function fakeTranscripts(entries: TranscriptEntry[], byPath?: TranscriptEntry[]) {
  return {
    page: async (_id: string, _opts: { limit: number }) => ({ entries }),
    pageAt: async (_path: string, _opts: { limit: number }) => ({ entries: byPath ?? entries }),
  };
}

/** A stat with `n` text files in it — only the counts matter to anything under test here. */
function fakeStat(n: number, added: number, removed: number): DiffStat {
  return {
    base: "HEAD",
    files: Array.from({ length: n }, (_, i) => ({ path: `f${i}.ts`, added: 0, removed: 0, kind: "text" as const })),
    added,
    removed,
  };
}

/** Nothing to measure — the shape `cardDiffStat` returns for a card with no branch or no worktree. */
const noDiff = async (_target: { cardId?: string; cwd: string }) => null;
const neverResolvePath = async (_input: { paneId: string; cwd: string }) => null;

function sources(overrides: Partial<SubtitleSources> & { alert: FiredAlert }): SubtitleSources {
  return { board: fakeBoard(null), transcripts: null, statFor: noDiff, ...overrides };
}

/** A `done` on a card, in a worktree — the shape the cascade's tier 3 exists for. */
const cardDone = (overrides: Partial<FiredAlert> = {}) =>
  baseAlert({
    cardId: "c1",
    cardTitle: "Ship the header bell",
    cwd: "/home/you/.herdr/worktrees/collie-board/board/ship-it",
    ...overrides,
  });

describe("firstSubtitle — tier 2, the agent's own last line", () => {
  test("returns the agent's last message, verbatim", async () => {
    const subtitle = await firstSubtitle(
      sources({
        alert: baseAlert({ agentSessionId: "s1", status: "blocked" }),
        transcripts: fakeTranscripts([textEntry("assistant", "Should I also bump the changelog?")]),
      }),
    );
    expect(subtitle).toBe("Should I also bump the changelog?");
  });

  test("collapses whitespace and caps a long raw message with an ellipsis", async () => {
    const long = `line one\n\n  line two   with lots of   space   ${"x".repeat(200)}`;
    const subtitle =
      (await firstSubtitle(
        sources({
          alert: baseAlert({ agentSessionId: "s1", status: "blocked" }),
          transcripts: fakeTranscripts([textEntry("assistant", long)]),
        }),
      )) ?? "";
    expect(subtitle).toHaveLength(140);
    expect(subtitle.endsWith("…")).toBe(true);
    expect(subtitle).not.toContain("\n");
    expect(subtitle).not.toContain("  ");
  });

  test("the last ASSISTANT text turn wins, skipping trailing user/tool rows", async () => {
    const subtitle = await firstSubtitle(
      sources({
        alert: baseAlert({ agentSessionId: "s1", status: "blocked" }),
        transcripts: fakeTranscripts([
          textEntry("assistant", "the real closing message"),
          textEntry("user", "thanks"),
          { uuid: "u2", ts: "", role: "assistant", parts: [{ kind: "tool", name: "Bash", summary: "ls" }] },
        ]),
      }),
    );
    expect(subtitle).toBe("the real closing message");
  });

  test("falls back to resolvePath + pageAt when herdr reported no agent_session", async () => {
    let resolvedFor: { paneId: string; cwd: string } | undefined;
    const subtitle = await firstSubtitle(
      sources({
        alert: baseAlert({ status: "blocked" }),
        transcripts: fakeTranscripts([], [textEntry("assistant", "Should I also update the changelog?")]),
        resolvePath: async (input) => {
          resolvedFor = input;
          return "/home/you/.claude/projects/-demo/abc.jsonl";
        },
      }),
    );
    expect(resolvedFor).toEqual({ paneId: "p1", cwd: "/home/you/demo" });
    expect(subtitle).toBe("Should I also update the changelog?");
  });

  test("an agent-reported session id always wins over resolvePath", async () => {
    let resolvePathCalls = 0;
    await firstSubtitle(
      sources({
        alert: baseAlert({ agentSessionId: "s1", status: "blocked" }),
        transcripts: fakeTranscripts([textEntry("assistant", "the reported-session message")]),
        resolvePath: async () => {
          resolvePathCalls++;
          return "/should/not/be/used.jsonl";
        },
      }),
    );
    expect(resolvePathCalls).toBe(0);
  });

  test("no transcript store at all is just no tier 2 — a `blocked` then has nothing", async () => {
    const subtitle = await firstSubtitle(
      sources({ alert: baseAlert({ status: "blocked", cardId: "c1" }), resolvePath: neverResolvePath }),
    );
    expect(subtitle).toBeNull();
  });
});

describe("firstSubtitle — tier 3, the diff line (NOTIFY_AUDIT.md §3.3)", () => {
  test("a `done` with no transcript line carries the diff as one line", async () => {
    const subtitle = await firstSubtitle(
      sources({ alert: cardDone(), resolvePath: neverResolvePath, statFor: async () => fakeStat(3, 180, 12) }),
    );
    expect(subtitle).toBe("3 files, +180 -12");
  });

  test("the agent's own last line outranks it — no subprocess is even spent", async () => {
    let statCalls = 0;
    const subtitle = await firstSubtitle(
      sources({
        alert: cardDone({ agentSessionId: "s1" }),
        transcripts: fakeTranscripts([textEntry("assistant", "Bumped the version and cut the release.")]),
        statFor: async () => {
          statCalls++;
          return fakeStat(3, 180, 12);
        },
      }),
    );
    expect(subtitle).toBe("Bumped the version and cut the release.");
    expect(statCalls).toBe(0);
  });

  test("a `blocked` never gets one — a stat is an account of finished work, not of a question", async () => {
    let statCalls = 0;
    const subtitle = await firstSubtitle(
      sources({
        alert: cardDone({ status: "blocked" }),
        resolvePath: neverResolvePath,
        statFor: async () => {
          statCalls++;
          return fakeStat(3, 180, 12);
        },
      }),
    );
    expect(statCalls).toBe(0);
    expect(subtitle).toBeNull();
  });

  test("an empty diff falls through to tier 4 — nothing, never the card title again", async () => {
    const subtitle = await firstSubtitle(
      sources({ alert: cardDone(), resolvePath: neverResolvePath, statFor: async () => fakeStat(0, 0, 0) }),
    );
    expect(subtitle).toBeNull();
  });

  test("a throwing stat is just no tier 3, not a crash", async () => {
    const subtitle = await firstSubtitle(
      sources({
        alert: cardDone(),
        resolvePath: neverResolvePath,
        statFor: async () => {
          throw new Error("not a git repo");
        },
      }),
    );
    expect(subtitle).toBeNull();
  });
});

// The first push waits on these, so what it waits on must be bounded — §N10's second point of
// attention. A hung read costs the body; it must never cost the alert.
describe("firstSubtitle — the deadline", () => {
  const hangs = <T,>() => new Promise<T>(() => {});

  test("a transcript read that never answers gives up and returns nothing", async () => {
    const subtitle = await firstSubtitle(
      sources({
        alert: baseAlert({ agentSessionId: "s1", status: "blocked" }),
        transcripts: { page: hangs, pageAt: hangs },
      }),
      5,
    );
    expect(subtitle).toBeNull();
  });

  test("a `git --stat` that never answers gives up and returns nothing", async () => {
    const subtitle = await firstSubtitle(
      sources({ alert: cardDone(), resolvePath: neverResolvePath, statFor: hangs }),
      5,
    );
    expect(subtitle).toBeNull();
  });

  test("work that answers in time is not cut off", async () => {
    const subtitle = await firstSubtitle(
      sources({
        alert: cardDone(),
        resolvePath: neverResolvePath,
        statFor: async () => {
          await new Promise((r) => setTimeout(r, 1));
          return fakeStat(1, 2, 3);
        },
      }),
      200,
    );
    expect(subtitle).toBe("1 file, +2 -3");
  });
});

describe("enrichNotification — the copilot's silent update, and nothing else", () => {
  test("never asks, and never renders, when the copilot is disabled", async () => {
    const sink = new RecordingSink();
    const copilot = fakeCopilot({ subtitle: "renamed the header bell" }, false);
    await enrichNotification({
      ...sources({ alert: cardDone(), transcripts: fakeTranscripts([textEntry("assistant", "a real line")]) }),
      alert: cardDone({ agentSessionId: "s1" }),
      coordinator: fakeCoordinator(cardDone()),
      sink,
      copilot,
      board: fakeBoard({ title: "Card", spec: "do the thing" }),
    });
    expect(copilot.calls).toBe(0);
    expect(sink.renders).toEqual([]);
  });

  test("skips the copilot turn when there's truly nothing to work with", async () => {
    const copilot = fakeCopilot({ subtitle: "should never be asked" });
    const alert = baseAlert({ status: "blocked", cardId: "c1" }); // no diff attempted, no transcript
    await enrichNotification({
      ...sources({ alert, resolvePath: neverResolvePath }),
      coordinator: fakeCoordinator(alert),
      sink: new RecordingSink(),
      copilot,
      board: fakeBoard({ title: "Card", spec: null }),
    });
    expect(copilot.calls).toBe(0);
  });

  test("a hand-launched `done` pane still gets a cwd diff attempt — no card required", async () => {
    let target: { cardId?: string; cwd: string } | undefined;
    const alert = baseAlert();
    await enrichNotification({
      ...sources({
        alert,
        resolvePath: neverResolvePath,
        statFor: async (t) => {
          target = t;
          return fakeStat(1, 1, 0);
        },
      }),
      coordinator: fakeCoordinator(alert),
      sink: new RecordingSink(),
      copilot: fakeCopilot({ subtitle: "tidied the imports" }),
    });
    expect(target).toEqual({ cardId: undefined, cwd: "/home/you/demo" });
  });

  test("renders the enriched body, keeping the repo name and dropping renotify", async () => {
    const sink = new RecordingSink();
    // A card-backed pane: the card title is the title's subject, so the repo moves into the body —
    // the one shape where both appear, each exactly once.
    const current = baseAlert({ cardId: "c1", cardTitle: "Ship the header bell" });
    await enrichNotification({
      ...sources({ alert: baseAlert({ cardId: "c1", cardTitle: "Ship the header bell" }) }),
      coordinator: fakeCoordinator(current),
      sink,
      copilot: fakeCopilot({ subtitle: "renamed the header bell" }),
      board: fakeBoard({ title: "Card", spec: "do the thing" }),
    });
    expect(sink.renders).toEqual([
      {
        title: "Done · Ship the header bell",
        body: "demo · renamed the header bell",
        paneId: "p1",
        renotify: false,
      },
    ]);
  });

  test("writes the subtitle back onto the outstanding alert, so a later re-render keeps it", async () => {
    const current = baseAlert({ cardId: "c1", subtitle: "3 files, +180 -12" });
    await enrichNotification({
      ...sources({ alert: baseAlert({ cardId: "c1" }) }),
      coordinator: fakeCoordinator(current),
      sink: new RecordingSink(),
      copilot: fakeCopilot({ subtitle: "renamed the header bell" }),
      board: fakeBoard({ title: "Card", spec: "do the thing" }),
    });
    expect(current.subtitle).toBe("renamed the header bell");
  });

  test("patches the bell's history entry, matching what the push now shows", async () => {
    const current = baseAlert({ cardId: "c1" });
    const enriched: Array<[string, string, string]> = [];
    await enrichNotification({
      ...sources({ alert: baseAlert({ cardId: "c1" }) }),
      coordinator: fakeCoordinator(current),
      sink: new RecordingSink(),
      copilot: fakeCopilot({ subtitle: "renamed the header bell" }),
      board: fakeBoard({ title: "Card", spec: "do the thing" }),
      notifyLog: { enrich: (paneId, status, subtitle) => enriched.push([paneId, status, subtitle]) },
    });
    expect(enriched).toEqual([["p1", "done", "renamed the header bell"]]);
  });

  test("drops the answer if the alert resolved while the copilot was thinking", async () => {
    const sink = new RecordingSink();
    const enriched: unknown[] = [];
    await enrichNotification({
      ...sources({ alert: baseAlert({ cardId: "c1" }) }),
      coordinator: fakeCoordinator(undefined), // handled at the desk, or now part of a digest
      sink,
      copilot: fakeCopilot({ subtitle: "renamed the header bell" }),
      board: fakeBoard({ title: "Card", spec: "do the thing" }),
      notifyLog: { enrich: (...args) => enriched.push(args) },
    });
    expect(sink.renders).toEqual([]);
    expect(enriched).toEqual([]);
  });

  test("drops the answer if the pane's status moved on (e.g. blocked → done) meanwhile", async () => {
    const sink = new RecordingSink();
    const stale = baseAlert({ status: "done", cardId: "c1" }); // coordinator now shows `done`
    await enrichNotification({
      ...sources({ alert: baseAlert({ status: "blocked", cardId: "c1" }), resolvePath: neverResolvePath }),
      coordinator: fakeCoordinator(stale),
      sink,
      copilot: fakeCopilot({ subtitle: "needs the staging API key" }),
      board: fakeBoard({ title: "Card", spec: "do the thing" }),
    });
    expect(sink.renders).toEqual([]);
  });

  test("drops a null/unparseable copilot answer", async () => {
    const sink = new RecordingSink();
    const current = baseAlert({ cardId: "c1" });
    await enrichNotification({
      ...sources({ alert: baseAlert({ cardId: "c1" }) }),
      coordinator: fakeCoordinator(current),
      sink,
      copilot: fakeCopilot(null),
      board: fakeBoard({ title: "Card", spec: "do the thing" }),
    });
    expect(sink.renders).toEqual([]);
  });

  test("hands the agent's own last line to the prompt, card or no card", async () => {
    let seenPrompt = "";
    const alert = baseAlert({ agentSessionId: "s1", status: "blocked" });
    await enrichNotification({
      ...sources({
        alert,
        transcripts: fakeTranscripts([textEntry("assistant", "Fixed it, the mock was racing the timer.")]),
      }),
      coordinator: fakeCoordinator(alert),
      sink: new RecordingSink(),
      copilot: {
        enabled: true,
        ask: async (build) => {
          seenPrompt = build("out.json");
          return { subtitle: "fixed the flaky test" };
        },
      },
    });
    expect(seenPrompt).toContain("Fixed it, the mock was racing the timer.");
  });
});

describe("notifySubtitlePrompt / toNotifySubtitle", () => {
  test("the prompt names the verb and includes every optional ingredient given", () => {
    const prompt = notifySubtitlePrompt({
      verb: "finished",
      cardTitle: "Fix the bell",
      cardSpec: "Anchor it to the header",
      statSummary: "1 file changed",
      lastMessage: "Done, moved the bell.",
      outPath: "out.json",
    });
    expect(prompt).toContain("The agent just finished.");
    expect(prompt).toContain("Fix the bell");
    expect(prompt).toContain("Anchor it to the header");
    expect(prompt).toContain("1 file changed");
    expect(prompt).toContain("Done, moved the bell.");
    expect(prompt).toContain("out.json");
  });

  test("toNotifySubtitle extracts, collapses whitespace and caps length", () => {
    expect(toNotifySubtitle({ subtitle: "  renamed   the\nbell  " })).toBe("renamed the bell");
    expect(toNotifySubtitle({ subtitle: "x".repeat(200) })).toHaveLength(140);
  });

  test("toNotifySubtitle rejects a missing/empty/malformed answer", () => {
    expect(toNotifySubtitle(null)).toBeNull();
    expect(toNotifySubtitle({})).toBeNull();
    expect(toNotifySubtitle({ subtitle: "" })).toBeNull();
    expect(toNotifySubtitle("just a string")).toBeNull();
  });
});

// The whole point of §N10, end to end: the coordinator, the real firstSubtitle, and — where it is
// on — the real enrichNotification, wired exactly as index.ts wires them. The claim under test is
// about MESSAGE COUNT and `renotify`, because every message shares one collapse topic and a sleeping
// phone is only ever handed the last one.
describe("copilot OFF sends exactly one message, and it buzzes (NOTIFY_AUDIT.md §N10)", () => {
  /** Drive the coordinator for real: transition → fire the debounce → let the awaited hook settle. */
  async function push(
    pane: Partial<AgentView>,
    subtitleSources: SubtitleSources | null,
    onFire?: (alert: FiredAlert) => void,
  ): Promise<HerdSummary[]> {
    const sink = new RecordingSink();
    let fire = () => {};
    const coord = new NotificationCoordinator(
      { schedule: (fn: () => void) => (fire = fn), cancel: () => {} },
      sink,
      0,
      (s: AgentStatus) => s === "blocked" || s === "done",
      onFire,
      subtitleSources ? (alert) => firstSubtitle({ ...subtitleSources, alert }) : undefined,
    );
    coord.onTransition(
      {
        paneId: "p1",
        workspaceId: "w1",
        workspaceLabel: "demo",
        workspaceNumber: 1,
        tabId: "w1:t1",
        agent: "claude",
        status: "done",
        cwd: "/home/you/demo",
        focused: false,
        kind: "agent",
        ...pane,
      } as AgentView,
      "working",
      "done",
    );
    fire();
    await new Promise((r) => setTimeout(r, 20)); // let the awaited subtitle hook settle
    return sink.renders;
  }

  test("one render, renotify:true, and the diff is already in it", async () => {
    const renders = await push(
      { cardId: "c1", cardTitle: "Ship the header bell", cwd: "/home/you/.herdr/worktrees/collie-board/b/x" },
      sources({
        alert: baseAlert(), // replaced per-alert by the coordinator
        resolvePath: neverResolvePath,
        statFor: async () => fakeStat(3, 180, 12),
      }),
    );
    expect(renders).toEqual([
      {
        title: "Done · Ship the header bell",
        body: "collie-board · 3 files, +180 -12",
        paneId: "p1",
        renotify: true,
      },
    ]);
  });

  test("one render for a transcript line too — the same single, buzzing message", async () => {
    const renders = await push(
      { agentSessionId: "s1" },
      sources({
        alert: baseAlert(),
        transcripts: fakeTranscripts([textEntry("assistant", "Bumped the version and cut the release.")]),
      }),
    );
    expect(renders).toHaveLength(1);
    expect(renders[0]).toMatchObject({ body: "Bumped the version and cut the release.", renotify: true });
  });

  test("nothing to say still sends the alert — an empty body, once, buzzing", async () => {
    const renders = await push({}, sources({ alert: baseAlert(), resolvePath: neverResolvePath }));
    expect(renders).toEqual([{ title: "Done · demo", body: "", paneId: "p1", renotify: true }]);
  });

  test("the bell's history is handed the same subtitle the push went out with", async () => {
    const fired: FiredAlert[] = [];
    await push(
      { agentSessionId: "s1" },
      sources({
        alert: baseAlert(),
        transcripts: fakeTranscripts([textEntry("assistant", "the line that shipped")]),
      }),
      (alert) => fired.push(alert),
    );
    expect(fired.map((a) => a.subtitle)).toEqual(["the line that shipped"]);
  });

  test("with no subtitle hook at all the coordinator behaves exactly as before", async () => {
    const renders = await push({ cardId: "c1", cardTitle: "Ship the header bell" }, null);
    expect(renders).toEqual([
      { title: "Done · Ship the header bell", body: "demo", paneId: "p1", renotify: true },
    ]);
  });

  // And with the copilot ON, the second message reappears — but only for the rephrase, over a body
  // that already said something. That is the one place a second stage is coherent.
  test("copilot ON adds a second, SILENT message that only rewords the body", async () => {
    const sink = new RecordingSink();
    let fire = () => {};
    const src = sources({
      alert: baseAlert(),
      resolvePath: neverResolvePath,
      statFor: async () => fakeStat(3, 180, 12),
    });
    const coord: NotificationCoordinator<number> = new NotificationCoordinator<number>(
      { schedule: (fn: () => void) => ((fire = fn), 1), cancel: () => {} },
      sink,
      0,
      (s: AgentStatus) => s === "blocked" || s === "done",
      (alert) =>
        void enrichNotification({
          ...src,
          alert,
          coordinator: coord,
          sink,
          copilot: fakeCopilot({ subtitle: "renamed the header bell" }),
        }),
      (alert) => firstSubtitle({ ...src, alert }),
    );
    coord.onTransition(
      {
        paneId: "p1",
        workspaceId: "w1",
        workspaceLabel: "demo",
        workspaceNumber: 1,
        tabId: "w1:t1",
        agent: "claude",
        status: "done",
        cwd: "/home/you/.herdr/worktrees/collie-board/b/x",
        focused: false,
        kind: "agent",
        cardId: "c1",
        cardTitle: "Ship the header bell",
      } as AgentView,
      "working",
      "done",
    );
    fire();
    await new Promise((r) => setTimeout(r, 20));
    expect(sink.renders).toEqual([
      {
        title: "Done · Ship the header bell",
        body: "collie-board · 3 files, +180 -12",
        paneId: "p1",
        renotify: true,
      },
      {
        title: "Done · Ship the header bell",
        body: "collie-board · renamed the header bell",
        paneId: "p1",
        renotify: false,
      },
    ]);
  });
});
