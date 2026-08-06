import { describe, expect, test } from "bun:test";

import { notifySubtitlePrompt, toNotifySubtitle } from "./copilot.ts";
import { enrichNotification } from "./notify-subtitle.ts";
import type { Alert, FiredAlert, HerdSummary, NotifySink } from "./notifications.ts";
import type { TranscriptEntry } from "./transcript.ts";

// enrichNotification is the second, silent push: it only ever fires after the plain one, so every
// test starts from an alert that has already been rendered once (the base case NotificationCoordinator
// itself covers). What's under test here is purely the enrichment decision — ask or don't, render or
// drop — driven by fakes so no real copilot pane, git checkout, or transcript file is involved.

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

const noDiff = async (_target: { cardId?: string; cwd: string }) => "(no changes)";
const neverResolvePath = async (_input: { paneId: string; cwd: string }) => null;

describe("enrichNotification — gating", () => {
  test("never asks the copilot when it's disabled", async () => {
    const sink = new RecordingSink();
    const copilot = fakeCopilot({ subtitle: "renamed the header bell" }, false);
    await enrichNotification({
      alert: baseAlert({ cardId: "c1" }),
      coordinator: fakeCoordinator(baseAlert({ cardId: "c1" })),
      sink,
      copilot,
      board: fakeBoard({ title: "Card", spec: "do the thing" }),
      transcripts: null,
      statFor: noDiff,
    });
    expect(copilot.calls).toBe(0);
    expect(sink.renders).toEqual([]);
  });

  test("skips the copilot turn when there's truly nothing to work with", async () => {
    const sink = new RecordingSink();
    const copilot = fakeCopilot({ subtitle: "should never be asked" });
    // `blocked`, so no diff is even attempted — leaves no spec, no transcript, no diff at all.
    const alert = baseAlert({ status: "blocked", cardId: "c1" });
    await enrichNotification({
      alert,
      coordinator: fakeCoordinator(alert),
      sink,
      copilot,
      board: fakeBoard({ title: "Card", spec: null }),
      transcripts: null,
      resolvePath: neverResolvePath,
      statFor: noDiff,
    });
    expect(copilot.calls).toBe(0);
    expect(sink.renders).toEqual([]);
  });

  test("a hand-launched `done` pane still gets a cwd diff attempt — no card required", async () => {
    const sink = new RecordingSink();
    const alert = baseAlert(); // no cardId at all
    let statTarget: { cardId?: string; cwd: string } | undefined;
    await enrichNotification({
      alert,
      coordinator: fakeCoordinator(alert),
      sink,
      copilot: fakeCopilot({ subtitle: "cleaned up the trim-tools helper" }),
      board: fakeBoard(null),
      transcripts: null,
      statFor: async (target) => {
        statTarget = target;
        return "trim-tools.ts | +12 -3";
      },
    });
    expect(statTarget).toEqual({ cardId: undefined, cwd: "/home/you/demo" });
    expect(sink.renders[0]?.body).toBe("demo · cleaned up the trim-tools helper");
  });

  test("a hand-launched `blocked` pane has nothing to enrich from — no diff attempted", async () => {
    const sink = new RecordingSink();
    const copilot = fakeCopilot({ subtitle: "should never be asked" });
    const alert = baseAlert({ status: "blocked" });
    let statCalls = 0;
    await enrichNotification({
      alert,
      coordinator: fakeCoordinator(alert),
      sink,
      copilot,
      board: fakeBoard(null),
      transcripts: null,
      resolvePath: neverResolvePath,
      statFor: async () => {
        statCalls++;
        return "unused";
      },
    });
    expect(statCalls).toBe(0);
    expect(copilot.calls).toBe(0);
  });

  test("only fetches the diff stat for `done`, never for `blocked`", async () => {
    let statCalls = 0;
    const alert = baseAlert({ status: "blocked", cardId: "c1" });
    await enrichNotification({
      alert,
      coordinator: fakeCoordinator(alert),
      sink: new RecordingSink(),
      copilot: fakeCopilot(null), // no answer — irrelevant to this assertion
      board: fakeBoard({ title: "Card", spec: "the spec" }),
      transcripts: null,
      statFor: async () => {
        statCalls++;
        return "stat";
      },
    });
    expect(statCalls).toBe(0);
  });
});

describe("enrichNotification — the free-tier fallback (no copilot)", () => {
  test("falls back to the agent's own last line, verbatim, when the copilot is disabled", async () => {
    const sink = new RecordingSink();
    const alert = baseAlert({ agentSessionId: "s1", status: "blocked" });
    const copilot = fakeCopilot({ subtitle: "should never be asked" }, false);
    await enrichNotification({
      alert,
      coordinator: fakeCoordinator(alert),
      sink,
      copilot,
      board: fakeBoard(null),
      transcripts: fakeTranscripts([textEntry("assistant", "Should I also bump the changelog?")]),
      statFor: noDiff,
    });
    expect(copilot.calls).toBe(0);
    expect(sink.renders[0]?.body).toBe("demo · Should I also bump the changelog?");
  });

  test("also falls back when the copilot IS enabled but answers with nothing usable", async () => {
    const sink = new RecordingSink();
    const alert = baseAlert({ agentSessionId: "s1", status: "blocked" });
    await enrichNotification({
      alert,
      coordinator: fakeCoordinator(alert),
      sink,
      copilot: fakeCopilot(null), // answers, but toNotifySubtitle rejects it
      board: fakeBoard(null),
      transcripts: fakeTranscripts([textEntry("assistant", "The mock was racing the timer.")]),
      statFor: noDiff,
    });
    expect(sink.renders[0]?.body).toBe("demo · The mock was racing the timer.");
  });

  test("without a transcript there is no free tier to fall back to — even a card spec isn't enough", async () => {
    const sink = new RecordingSink();
    const alert = baseAlert({ status: "blocked", cardId: "c1" });
    const copilot = fakeCopilot({ subtitle: "should never be asked" }, false);
    await enrichNotification({
      alert,
      coordinator: fakeCoordinator(alert),
      sink,
      copilot,
      board: fakeBoard({ title: "Card", spec: "a real spec, but the copilot is off" }),
      transcripts: null,
      resolvePath: neverResolvePath,
      statFor: noDiff,
    });
    expect(sink.renders).toEqual([]);
  });

  test("collapses whitespace and caps a long raw message with an ellipsis", async () => {
    const sink = new RecordingSink();
    const alert = baseAlert({ agentSessionId: "s1", status: "blocked" });
    const long = `line one\n\n  line two   with lots of   space   ${"x".repeat(200)}`;
    await enrichNotification({
      alert,
      coordinator: fakeCoordinator(alert),
      sink,
      copilot: fakeCopilot(null, false),
      board: fakeBoard(null),
      transcripts: fakeTranscripts([textEntry("assistant", long)]),
      statFor: noDiff,
    });
    const body = sink.renders[0]?.body ?? "";
    const subtitle = body.slice("demo · ".length);
    expect(subtitle).toHaveLength(140);
    expect(subtitle.endsWith("…")).toBe(true);
    expect(subtitle).not.toContain("\n");
    expect(subtitle).not.toContain("  ");
  });

  test("a disabled copilot still skips the git subprocess entirely — nothing would use it", async () => {
    let statCalls = 0;
    const alert = baseAlert({ agentSessionId: "s1", status: "done" });
    await enrichNotification({
      alert,
      coordinator: fakeCoordinator(alert),
      sink: new RecordingSink(),
      copilot: fakeCopilot(null, false),
      board: fakeBoard(null),
      transcripts: fakeTranscripts([textEntry("assistant", "done here")]),
      statFor: async () => {
        statCalls++;
        return "unused";
      },
    });
    expect(statCalls).toBe(0);
  });

  test("the free tier also patches the bell's history", async () => {
    const alert = baseAlert({ agentSessionId: "s1", status: "blocked" });
    const enriched: unknown[] = [];
    await enrichNotification({
      alert,
      coordinator: fakeCoordinator(alert),
      sink: new RecordingSink(),
      copilot: fakeCopilot(null, false),
      board: fakeBoard(null),
      transcripts: fakeTranscripts([textEntry("assistant", "the raw closing line")]),
      statFor: noDiff,
      notifyLog: { enrich: (...args) => enriched.push(args) },
    });
    expect(enriched).toEqual([["p1", "blocked", "the raw closing line"]]);
  });
});

describe("enrichNotification — the silent update", () => {
  test("also patches the bell's history entry, matching what the push now shows", async () => {
    const current = baseAlert({ cardId: "c1" });
    const enriched: Array<[string, string, string]> = [];
    await enrichNotification({
      alert: baseAlert({ cardId: "c1" }),
      coordinator: fakeCoordinator(current),
      sink: new RecordingSink(),
      copilot: fakeCopilot({ subtitle: "renamed the header bell" }),
      board: fakeBoard({ title: "Card", spec: "do the thing" }),
      transcripts: null,
      statFor: noDiff,
      notifyLog: { enrich: (paneId, status, subtitle) => enriched.push([paneId, status, subtitle]) },
    });
    expect(enriched).toEqual([["p1", "done", "renamed the header bell"]]);
  });

  test("a stale/dropped answer never touches the history — notifyLog.enrich is never called", async () => {
    const enriched: unknown[] = [];
    await enrichNotification({
      alert: baseAlert({ cardId: "c1" }),
      coordinator: fakeCoordinator(undefined), // resolved before the copilot answered
      sink: new RecordingSink(),
      copilot: fakeCopilot({ subtitle: "should never land" }),
      board: fakeBoard({ title: "Card", spec: "do the thing" }),
      transcripts: null,
      statFor: noDiff,
      notifyLog: { enrich: (...args) => enriched.push(args) },
    });
    expect(enriched).toEqual([]);
  });

  test("renders the enriched body, keeping the repo name and dropping renotify", async () => {
    const sink = new RecordingSink();
    const current = baseAlert({ cardId: "c1" });
    await enrichNotification({
      alert: baseAlert({ cardId: "c1" }),
      coordinator: fakeCoordinator(current),
      sink,
      copilot: fakeCopilot({ subtitle: "renamed the header bell" }),
      board: fakeBoard({ title: "Card", spec: "do the thing" }),
      transcripts: null,
      statFor: noDiff,
    });
    expect(sink.renders).toEqual([
      {
        title: "claude is done",
        body: "demo · renamed the header bell",
        paneId: "p1",
        renotify: false,
      },
    ]);
  });

  test("drops the answer if the alert resolved while the copilot was thinking", async () => {
    const sink = new RecordingSink();
    await enrichNotification({
      alert: baseAlert({ cardId: "c1" }),
      coordinator: fakeCoordinator(undefined), // handled at the desk, or now part of a digest
      sink,
      copilot: fakeCopilot({ subtitle: "renamed the header bell" }),
      board: fakeBoard({ title: "Card", spec: "do the thing" }),
      transcripts: null,
      statFor: noDiff,
    });
    expect(sink.renders).toEqual([]);
  });

  test("drops the answer if the pane's status moved on (e.g. blocked → done) meanwhile", async () => {
    const sink = new RecordingSink();
    const stale = baseAlert({ status: "done", cardId: "c1" }); // coordinator now shows `done`
    await enrichNotification({
      alert: baseAlert({ status: "blocked", cardId: "c1" }), // this answer was asked for `blocked`
      coordinator: fakeCoordinator(stale),
      sink,
      copilot: fakeCopilot({ subtitle: "needs the staging API key" }),
      board: fakeBoard({ title: "Card", spec: "do the thing" }),
      transcripts: null,
      resolvePath: neverResolvePath,
      statFor: noDiff,
    });
    expect(sink.renders).toEqual([]);
  });

  test("drops a null/unparseable copilot answer", async () => {
    const sink = new RecordingSink();
    const current = baseAlert({ cardId: "c1" });
    await enrichNotification({
      alert: baseAlert({ cardId: "c1" }),
      coordinator: fakeCoordinator(current),
      sink,
      copilot: fakeCopilot(null),
      board: fakeBoard({ title: "Card", spec: "do the thing" }),
      transcripts: null,
      statFor: noDiff,
    });
    expect(sink.renders).toEqual([]);
  });

  test("pulls the agent's last transcript message in without a card at all", async () => {
    const sink = new RecordingSink();
    const alert = baseAlert({ agentSessionId: "s1", status: "blocked" }); // no cardId, no diff
    await enrichNotification({
      alert,
      coordinator: fakeCoordinator(alert),
      sink,
      copilot: fakeCopilot({ subtitle: "fixed the flaky test" }),
      board: fakeBoard(null),
      transcripts: fakeTranscripts([textEntry("assistant", "Fixed it, the mock was racing the timer.")]),
      statFor: noDiff,
    });
    expect(sink.renders[0]?.body).toBe("demo · fixed the flaky test");
  });

  test("the last ASSISTANT text turn wins, skipping trailing user/tool rows", async () => {
    const sink = new RecordingSink();
    const alert = baseAlert({ agentSessionId: "s1", status: "blocked" });
    let seenPrompt = "";
    await enrichNotification({
      alert,
      coordinator: fakeCoordinator(alert),
      sink,
      copilot: {
        enabled: true,
        ask: async (build) => {
          seenPrompt = build("out.json");
          return { subtitle: "ok" };
        },
      },
      board: fakeBoard(null),
      transcripts: fakeTranscripts([
        textEntry("assistant", "the real closing message"),
        textEntry("user", "thanks"),
        { uuid: "u2", ts: "", role: "assistant", parts: [{ kind: "tool", name: "Bash", summary: "ls" }] },
      ]),
      statFor: noDiff,
    });
    expect(seenPrompt).toContain("the real closing message");
  });

  test("falls back to resolvePath + pageAt when herdr reported no agent_session", async () => {
    const sink = new RecordingSink();
    const alert = baseAlert({ status: "blocked" }); // no agentSessionId, no cardId
    let resolvedFor: { paneId: string; cwd: string } | undefined;
    await enrichNotification({
      alert,
      coordinator: fakeCoordinator(alert),
      sink,
      copilot: fakeCopilot({ subtitle: "asking whether to also update the changelog" }),
      board: fakeBoard(null),
      transcripts: fakeTranscripts([], [textEntry("assistant", "Should I also update the changelog?")]),
      resolvePath: async (input) => {
        resolvedFor = input;
        return "/home/you/.claude/projects/-demo/abc.jsonl";
      },
      statFor: noDiff,
    });
    expect(resolvedFor).toEqual({ paneId: "p1", cwd: "/home/you/demo" });
    expect(sink.renders[0]?.body).toBe("demo · asking whether to also update the changelog");
  });

  test("resolvePath returning null is just no transcript signal, not a crash", async () => {
    const sink = new RecordingSink();
    const alert = baseAlert({ status: "blocked", cardId: "c1" });
    await enrichNotification({
      alert,
      coordinator: fakeCoordinator(alert),
      sink,
      copilot: fakeCopilot({ subtitle: "should never be asked" }),
      board: fakeBoard({ title: "Card", spec: null }), // no spec either — truly nothing
      transcripts: fakeTranscripts([textEntry("assistant", "unreachable")]),
      resolvePath: neverResolvePath,
      statFor: noDiff,
    });
    expect(sink.renders).toEqual([]);
  });

  test("an agent-reported session id always wins over resolvePath", async () => {
    const sink = new RecordingSink();
    const alert = baseAlert({ agentSessionId: "s1", status: "blocked" });
    let resolvePathCalls = 0;
    await enrichNotification({
      alert,
      coordinator: fakeCoordinator(alert),
      sink,
      copilot: fakeCopilot({ subtitle: "ok" }),
      board: fakeBoard(null),
      transcripts: fakeTranscripts([textEntry("assistant", "the reported-session message")]),
      resolvePath: async () => {
        resolvePathCalls++;
        return "/should/not/be/used.jsonl";
      },
      statFor: noDiff,
    });
    expect(resolvePathCalls).toBe(0);
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
