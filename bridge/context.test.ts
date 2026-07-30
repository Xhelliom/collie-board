// ContextTracker's iteration rule, which UI_AUDIT.md G3 changed: it walks the SNAPSHOT's agent panes,
// not the board's open sessions — so a pane launched by hand gets a gauge — while the durable write
// stays card-only ("`card` durable, `session` ephemeral", CLAUDE.md).
import { describe, expect, it } from "bun:test";

import { BUILTIN_ADAPTERS } from "./adapters.ts";
import { ContextTracker } from "./context.ts";
import { BoardDb } from "./db.ts";
import type { HerdrClient } from "./herdr-client.ts";
import type { EngineSnapshot } from "./state-engine.ts";
import type { TranscriptSource } from "./transcript.ts";
import type { AgentView } from "./types.ts";

const WINDOW = 200_000;

/** One assistant row carrying usage — the only shape `latestUsage()` looks at. */
function log(tokens: number): string {
  return JSON.stringify({
    type: "assistant",
    message: { usage: { input_tokens: tokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  });
}

/** A source where every session id / cwd maps to its own canned transcript. `reads` is the meter. */
function fakeSource(byPath: Record<string, string>) {
  const reads: string[] = [];
  const source: TranscriptSource = {
    async resolve(sessionId) {
      return byPath[`id:${sessionId}`] !== undefined ? `id:${sessionId}` : null;
    },
    async resolveForProcess(cwd) {
      return byPath[`cwd:${cwd}`] !== undefined ? `cwd:${cwd}` : null;
    },
    async resolveByCwd(cwd) {
      return byPath[`cwd:${cwd}`] !== undefined ? `cwd:${cwd}` : null;
    },
    async load(path) {
      reads.push(path);
      return { text: byPath[path] ?? "", complete: true, size: 0, mtimeMs: 0 };
    },
  };
  return { source, reads };
}

/** Enough of a herdr client for the tracker: the metadata push, and the pid lookup it may try. */
function fakeHerdr() {
  const reported: { paneId: string; ctx: string }[] = [];
  const client = {
    async reportPaneMetadata(opts: { paneId: string; tokens: Record<string, string> }) {
      reported.push({ paneId: opts.paneId, ctx: opts.tokens.ctx! });
    },
    async paneProcess() {
      return null;
    },
  } as unknown as HerdrClient;
  return { client, reported };
}

function pane(paneId: string, extra: Partial<AgentView> = {}): AgentView {
  return {
    paneId,
    workspaceId: "w1",
    workspaceLabel: "demo",
    workspaceNumber: 1,
    tabId: "w1:t1",
    agent: "claude",
    status: "working",
    cwd: "/repo",
    focused: false,
    kind: "agent",
    ...extra,
  };
}

function snapshot(agents: AgentView[], bridge: EngineSnapshot["bridge"] = "connected"): EngineSnapshot {
  return { agents, shellPanes: [], workspaces: [], tabs: [], bridge };
}

/** A tracker over an in-memory board, with a clock the test drives. */
function tracker(byPath: Record<string, string>, now: () => number = () => 0) {
  const db = new BoardDb(":memory:");
  const { source, reads } = fakeSource(byPath);
  const { client, reported } = fakeHerdr();
  return {
    db,
    reads,
    reported,
    t: new ContextTracker(db, client, source, WINDOW, BUILTIN_ADAPTERS, now),
  };
}

describe("ContextTracker", () => {
  it("gauges a pane launched by hand, and writes nothing to the board for it", async () => {
    const { db, t } = tracker({ "id:s-1": log(100_000) });

    await t.update(snapshot([pane("w1:p1", { agentSessionId: "s-1" })]));

    // The number is served with the snapshot…
    expect(t.enrich([pane("w1:p1")])[0]!.ctxPct).toBe(50);
    expect(t.enrich([pane("w1:p1")])[0]!.ctxTokens).toBe(100_000);
    // …and the durable store is untouched: no card, no session, nothing persisted.
    expect(db.listOpenSessions()).toEqual([]);
  });

  it("still writes the figure onto the card session when the pane backs one", async () => {
    const { db, t } = tracker({ "id:s-1": log(120_000) });
    const card = db.createCard({ title: "x" });
    const session = db.openSession({ cardId: card.id, paneId: "w1:p1" });

    await t.update(snapshot([pane("w1:p1", { agentSessionId: "s-1" })]));

    const stored = db.listOpenSessions().find((s) => s.id === session.id)!;
    expect(stored.ctxPct).toBe(60);
    expect(stored.ctxTokens).toBe(120_000);
  });

  it("reports the same number to herdr for a pane with no card", async () => {
    const { t, reported } = tracker({ "id:s-1": log(100_000) });
    await t.update(snapshot([pane("w1:p1", { agentSessionId: "s-1" })]));
    expect(reported).toEqual([{ paneId: "w1:p1", ctx: "50%" }]);
  });

  it("re-reads a pane's transcript once per refresh window, not once per poll", async () => {
    let clock = 0;
    const { t, reads } = tracker({ "id:s-1": log(100_000) }, () => clock);
    const snap = snapshot([pane("w1:p1", { agentSessionId: "s-1" })]);

    await t.update(snap);
    clock = 29_000; // the snapshot poll has ticked ~19 times by now
    await t.update(snap);
    expect(reads).toHaveLength(1);

    clock = 30_000;
    await t.update(snap);
    expect(reads).toHaveLength(2);
  });

  it("records the token count on the card but shows no gauge when it yields no percentage", async () => {
    const { db, t, reported } = tracker({ "id:s-1": log(0) });
    const card = db.createCard({ title: "x" });
    db.openSession({ cardId: card.id, paneId: "w1:p1" });

    await t.update(snapshot([pane("w1:p1", { agentSessionId: "s-1" })]));

    // The card keeps the raw figure it was given; the gauge stays absent rather than reading "0 %",
    // and nothing is pushed to herdr's sidebar either.
    expect(db.listOpenSessions()[0]!.ctxPct).toBeNull();
    expect(t.enrich([pane("w1:p1")])[0]!.ctxPct).toBeUndefined();
    expect(reported).toEqual([]);
  });

  it("never reads an agent whose transcript format we can't parse", async () => {
    const { t, reads } = tracker({ "cwd:/repo": log(100_000) });
    // `codex` is context:false in the shipped table — level 3, and no wasted scan either.
    await t.update(snapshot([pane("w1:p1", { agent: "codex" })]));
    expect(reads).toEqual([]);
    expect(t.enrich([pane("w1:p1")])[0]!.ctxPct).toBeUndefined();
  });

  it("ignores a disconnected snapshot, and forgets a pane once it is gone", async () => {
    const { t, reads } = tracker({ "id:s-1": log(100_000) });
    const alive = pane("w1:p1", { agentSessionId: "s-1" });

    await t.update(snapshot([alive], "disconnected"));
    expect(reads).toEqual([]); // a socket blip must never look like "the herd vanished"

    await t.update(snapshot([alive]));
    expect(t.enrich([alive])[0]!.ctxPct).toBe(50);

    await t.update(snapshot([]));
    expect(t.enrich([alive])[0]!.ctxPct).toBeUndefined();
  });
});
