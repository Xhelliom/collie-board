// What a card cost in tokens: the pure sum of a transcript, and the tracker that keeps it per session.
import { describe, expect, it } from "bun:test";

import { BUILTIN_ADAPTERS } from "./adapters.ts";
import { BoardDb } from "./db.ts";
import { CostTracker, foldCost, sumTranscript } from "./cost.ts";
import type { TranscriptSource } from "./transcript.ts";
import type { EngineSnapshot } from "./state-engine.ts";

const row = (model: string, u: [number, number, number, number], id?: string, extra: object = {}) =>
  JSON.stringify({
    type: "assistant",
    ...extra,
    message: {
      ...(id ? { id } : {}),
      model,
      usage: { input_tokens: u[0], output_tokens: u[1], cache_creation_input_tokens: u[2], cache_read_input_tokens: u[3] },
    },
  });

const LOG = [
  row("claude-opus-5-5", [10, 20, 30, 40], "m1"),
  row("claude-opus-5-5", [10, 25, 30, 40], "m1"), // same message streamed again: counted once, newest wins
  row("claude-sonnet-5-5", [1, 2, 3, 4], "m2", { isSidechain: true }), // a subagent turn costs too
  row("<synthetic>", [9, 9, 9, 9], "m3"), // not a model call
  "not json",
  JSON.stringify({ type: "user", message: { content: "hi" } }),
].join("\n");

describe("sumTranscript", () => {
  it("sums input / output / cache write / cache read per model, each message once", () => {
    const byModel = sumTranscript(LOG);
    expect(byModel).toEqual([
      { model: "claude-opus-5-5", tokens: { input: 10, output: 25, cacheWrite: 30, cacheRead: 40 } },
      { model: "claude-sonnet-5-5", tokens: { input: 1, output: 2, cacheWrite: 3, cacheRead: 4 } },
    ]);
  });
});

describe("foldCost", () => {
  it("merges sessions, and says unknown rather than 0 when nothing is known", () => {
    const a = sumTranscript(LOG);
    const c = foldCost([a, a], true);
    expect(c.known).toBe(true);
    expect(c.sessions).toBe(2);
    expect(c.tokens).toEqual({ input: 22, output: 54, cacheWrite: 66, cacheRead: 88 });
    expect(c.byModel[0]!.model).toBe("claude-opus-5-5");
    expect(c.byModel[0]!.label).toBe("Opus 5.5");
    expect(foldCost([], true)).toMatchObject({ known: false, sessions: 0 });
    expect(foldCost([a], false).known).toBe(false);
    expect(foldCost([a, null, a], true)).toMatchObject({ known: true, sessions: 3, counted: 2, partial: true });
    expect(foldCost([null], true)).toMatchObject({ known: false, sessions: 1, counted: 0 });
  });
});

function setup(files: Record<string, string>, complete = true) {
  const db = new BoardDb(":memory:");
  const source = {
    async resolve(id: string) {
      return files[id] !== undefined ? id : null;
    },
    async load(path: string) {
      return { text: files[path] ?? "", complete, size: 0, mtimeMs: 0 };
    },
  } as unknown as TranscriptSource;
  let now = 0;
  const t = new CostTracker(db, source, BUILTIN_ADAPTERS, () => now);
  const snap: EngineSnapshot = { agents: [], shellPanes: [], workspaces: [], tabs: [], bridge: "connected" };
  return { db, t, snap, tick: (ms: number) => (now += ms) };
}

describe("CostTracker", () => {
  it("serves a live session, then remembers it on the card when it finishes", async () => {
    const { db, t, snap, tick } = setup({ s1: LOG });
    const card = db.createCard({ title: "x" } as never);
    const s = db.openSession({ cardId: card.id, paneId: "p1", agentSessionId: "s1", agentKind: "claude" });
    await t.update(snap);
    expect(t.forCard(card.id).tokens.output).toBe(27);
    tick(60_000);
    db.closeSession(s.id, "done" as never);
    await t.update(snap);
    expect(db.listEventsOf(card.id, ["session.cost"])).toHaveLength(1);
    const fresh = new CostTracker(db, {} as never, BUILTIN_ADAPTERS); // a restart: the journal answers
    expect(fresh.forCard(card.id)).toMatchObject({ known: true, sessions: 1, tokens: { output: 27 } });
  });

  it("is unknown for an agent whose transcript was never verified", async () => {
    const { db, t, snap } = setup({ s1: LOG });
    const card = db.createCard({ title: "x" } as never);
    db.openSession({ cardId: card.id, paneId: "p1", agentSessionId: "s1", agentKind: "codex" });
    await t.update(snap);
    expect(t.forCard(card.id)).toMatchObject({ known: false });
  });

  it("counts a session with no figure instead of passing a low total as complete", async () => {
    const { db, t, snap } = setup({ s1: LOG });
    const card = db.createCard({ title: "x" } as never);
    db.openSession({ cardId: card.id, paneId: "p1", agentSessionId: "s1", agentKind: "claude" });
    db.openSession({ cardId: card.id, paneId: "p2", agentSessionId: "gone", agentKind: "claude" });
    await t.update(snap);
    expect(t.forCard(card.id)).toMatchObject({ known: true, partial: true, sessions: 2, counted: 1 });
  });

  it("re-resolves the transcript when the agent session id changes", async () => {
    const { db, t, snap, tick } = setup({ s1: LOG, s2: row("claude-opus-5-5", [0, 100, 0, 0], "z") });
    const card = db.createCard({ title: "x" } as never);
    const s = db.openSession({ cardId: card.id, paneId: "p1", agentSessionId: "s1", agentKind: "claude" });
    await t.update(snap);
    expect(t.forCard(card.id).tokens.output).toBe(27);
    db.patchSession(s.id, { agentSessionId: "s2" } as never);
    tick(60_000);
    await t.update(snap);
    expect(t.forCard(card.id).tokens.output).toBe(100);
  });

  it("does not count a head-clipped transcript, live or once finished", async () => {
    const { db, t, snap, tick } = setup({ s1: LOG }, false);
    const card = db.createCard({ title: "x" } as never);
    const s = db.openSession({ cardId: card.id, paneId: "p1", agentSessionId: "s1", agentKind: "claude" });
    await t.update(snap);
    expect(t.forCard(card.id)).toMatchObject({ known: false, partial: true, sessions: 1, counted: 0 });
    tick(60_000);
    db.closeSession(s.id, "done" as never);
    await t.update(snap);
    expect(db.listEventsOf(card.id, ["session.cost"])[0]!.payload).toMatchObject({ complete: false });
    const fresh = new CostTracker(db, {} as never, BUILTIN_ADAPTERS);
    expect(fresh.forCard(card.id)).toMatchObject({ known: false, partial: true, counted: 0 });
  });
});
