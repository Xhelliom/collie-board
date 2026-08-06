import { describe, expect, test } from "bun:test";

import { notifySubtitlePrompt, toNotifySubtitle } from "./copilot.ts";
import { enrichNotification } from "./notify-subtitle.ts";
import type { Alert, FiredAlert, HerdSummary, NotifySink } from "./notifications.ts";
import type { TranscriptEntry } from "./transcript.ts";

// enrichNotification is the second, silent push: it only ever fires after the plain one, so every
// test starts from an alert that has already been rendered once (the base case NotificationCoordinator
// itself covers). What's under test here is purely the enrichment decision — ask or don't, render or
// drop — driven by fakes so no real copilot pane or transcript file is involved.

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

function fakeTranscripts(entries: TranscriptEntry[]) {
  return { page: async (_id: string, _opts: { limit: number }) => ({ entries }) };
}

const neverStat = async (_cardId: string) => "(unused)";

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
      statFor: neverStat,
    });
    expect(copilot.calls).toBe(0);
    expect(sink.renders).toEqual([]);
  });

  test("skips the copilot turn when there's nothing beyond the bare card title", async () => {
    const sink = new RecordingSink();
    const copilot = fakeCopilot({ subtitle: "should never be asked" });
    // `blocked`, so no diff stat is even fetched — leaves no spec, no transcript, no diff at all.
    const alert = baseAlert({ status: "blocked", cardId: "c1" });
    await enrichNotification({
      alert,
      coordinator: fakeCoordinator(alert),
      sink,
      copilot,
      board: fakeBoard({ title: "Card", spec: null }),
      transcripts: null,
      statFor: neverStat,
    });
    expect(copilot.calls).toBe(0);
    expect(sink.renders).toEqual([]);
  });

  test("a hand-launched pane (no card, no session) has nothing to enrich from", async () => {
    const sink = new RecordingSink();
    const copilot = fakeCopilot({ subtitle: "should never be asked" });
    await enrichNotification({
      alert: baseAlert(),
      coordinator: fakeCoordinator(baseAlert()),
      sink,
      copilot,
      board: fakeBoard(null),
      transcripts: null,
      statFor: neverStat,
    });
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
      statFor: async (_id) => {
        statCalls++;
        return "stat";
      },
    });
    expect(statCalls).toBe(0);
  });
});

describe("enrichNotification — the silent update", () => {
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
      statFor: neverStat,
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
      statFor: neverStat,
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
      statFor: neverStat,
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
      statFor: neverStat,
    });
    expect(sink.renders).toEqual([]);
  });

  test("pulls the agent's last transcript message in without a card at all", async () => {
    const sink = new RecordingSink();
    const alert = baseAlert({ agentSessionId: "s1" }); // no cardId
    await enrichNotification({
      alert,
      coordinator: fakeCoordinator(alert),
      sink,
      copilot: fakeCopilot({ subtitle: "fixed the flaky test" }),
      board: fakeBoard(null),
      transcripts: fakeTranscripts([textEntry("assistant", "Fixed it, the mock was racing the timer.")]),
      statFor: neverStat,
    });
    expect(sink.renders[0]?.body).toBe("demo · fixed the flaky test");
  });

  test("the last ASSISTANT text turn wins, skipping trailing user/tool rows", async () => {
    const sink = new RecordingSink();
    const alert = baseAlert({ agentSessionId: "s1" });
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
      statFor: neverStat,
    });
    expect(seenPrompt).toContain("the real closing message");
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
