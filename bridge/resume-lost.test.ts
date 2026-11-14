import { describe, expect, it } from "bun:test";

import { BoardDb } from "./db.ts";
import { ASLEEP_MS, classify, lastTurn, LostAgentResumer, recapLine, RESUMED_EVENT, verdictWhy } from "./resume-lost.ts";
import type { EngineSnapshot } from "./state-engine.ts";
import type { TranscriptSource } from "./transcript.ts";
import type { AgentView } from "./types.ts";

const T0 = Date.parse("2026-11-13T08:00:00Z");
const at = (ms: number) => new Date(ms).toISOString();
const user = (content: unknown, ms = T0, extra = {}) => JSON.stringify({ type: "user", timestamp: at(ms), message: { role: "user", content }, ...extra });
const assistant = (stop: string | null, blocks: string[], ms = T0) =>
  JSON.stringify({ type: "assistant", timestamp: at(ms), message: { role: "assistant", stop_reason: stop, content: blocks.map((type) => ({ type })) } });
const noise = JSON.stringify({ type: "cost-state", sessionId: "x" });
const log = (...lines: string[]) => lines.join("\n") + "\n";

describe("lastTurn — read off the transcript", () => {
  it("a turn the assistant closed", () => {
    expect(lastTurn(log(user("fais X"), assistant("end_turn", ["text"]), noise))).toEqual({ open: false, exited: false, at: T0 });
  });

  it("a tool running, a tool result unanswered, a prompt unanswered: open", () => {
    expect(lastTurn(log(user("fais X"), assistant("tool_use", ["tool_use"])))!.open).toBe(true);
    expect(lastTurn(log(assistant("tool_use", ["tool_use"]), user([{ type: "tool_result" }])))!.open).toBe(true);
    expect(lastTurn(log(assistant("end_turn", ["text"]), user("et maintenant Y")))!.open).toBe(true);
  });

  it("skips subagents, meta lines and local commands; /exit and Esc close the turn", () => {
    const sidechain = JSON.stringify({ type: "user", isSidechain: true, timestamp: at(T0), message: { content: "sub" } });
    expect(lastTurn(log(assistant("end_turn", ["text"]), sidechain, user("<local-command-stdout>ok</local-command-stdout>")))!.open).toBe(false);
    expect(lastTurn(log(user("fais X"), user("<command-name>/exit</command-name>")))).toEqual({ open: false, exited: true, at: T0 });
    expect(lastTurn(log(assistant("tool_use", ["tool_use"]), user([{ type: "text", text: "[Request interrupted by user]" }])))!.open).toBe(false);
  });

  it("no message at all, or a clipped first line", () => {
    expect(lastTurn(log(noise))).toBeNull();
    expect(lastTurn('pe":"assistant","message":{\n')).toBeNull();
  });
});

describe("classify", () => {
  const open = { open: true, exited: false, at: T0 };
  const closed = { open: false, exited: false, at: T0 };
  const now = T0 + 60_000;

  it("an open turn, or a live card, is resumed", () => {
    expect(classify({ turn: open, cardStatus: "working", bilan: false, now })).toBe("resume");
    expect(classify({ turn: open, cardStatus: "review", bilan: false, now })).toBe("resume");
    expect(classify({ turn: closed, cardStatus: "working", bilan: false, now })).toBe("resume");
    expect(classify({ turn: closed, cardStatus: null, bilan: false, now })).toBe("resume");
  });

  it("closed and filed, a bilan, or /exit: finished — even an agent that could not close itself", () => {
    expect(classify({ turn: closed, cardStatus: "review", bilan: false, now })).toBe("finished");
    expect(classify({ turn: closed, cardStatus: "done", bilan: false, now })).toBe("finished");
    expect(classify({ turn: open, cardStatus: "working", bilan: true, now })).toBe("finished");
    expect(classify({ turn: { ...closed, exited: true }, cardStatus: "working", bilan: false, now })).toBe("finished");
  });

  it("no message for longer than the threshold: asleep, even with its turn open", () => {
    expect(classify({ turn: open, cardStatus: "working", bilan: false, now: T0 + ASLEEP_MS + 1 })).toBe("asleep");
  });

  it("a night off is not sleep: the orchestrator and a card left overnight come back after a reboot", () => {
    const morning = T0 + 14 * 3_600_000;
    expect(classify({ turn: closed, cardStatus: null, bilan: false, now: morning })).toBe("resume");
    expect(classify({ turn: open, cardStatus: "working", bilan: false, now: morning })).toBe("resume");
  });

  it("the journal says why", () => {
    expect(verdictWhy("resume", { turn: open, cardStatus: "working", bilan: false, now })).toBe("tour ouvert");
    expect(verdictWhy("finished", { turn: closed, cardStatus: "review", bilan: false, now })).toBe("tour clos, carte en review");
    expect(verdictWhy("asleep", { turn: open, cardStatus: "working", bilan: false, now: T0 + 80 * 3_600_000 })).toBe("muet depuis 80 h");
  });
});

it("recapLine", () => {
  expect(recapLine({ resume: 3, finished: 2, asleep: 1 })).toBe("Terminaux perdus : 3 agents repris, 2 terminés laissés, 1 endormi laissé");
  expect(recapLine({ resume: 1, finished: 0, asleep: 0 })).toBe("Terminaux perdus : 1 agent repris");
});

describe("LostAgentResumer — one pass", () => {
  const shell = (paneId: string, cwd: string, extra: Partial<AgentView> = {}): AgentView => ({
    paneId, workspaceId: "hc", workspaceLabel: "hc", workspaceNumber: 1, tabId: "hc", agent: "shell", status: "unknown", cwd, focused: false, kind: "shell", ...extra,
  });
  const snap = (shellPanes: AgentView[]): EngineSnapshot => ({ agents: [], shellPanes, workspaces: [], tabs: [], bridge: "connected" });

  function setup() {
    const db = new BoardDb(":memory:");
    const now = Date.now() + 3_600_000;
    const card = (title: string, paneId: string, status: "working" | "review", agentSessionId?: string) => {
      const c = db.createCard({ title, repoPath: "/repo", baseRef: "main", status: "ready" });
      db.openSession({ cardId: c.id, paneId, agentKind: "claude", ...(agentSessionId ? { agentSessionId } : {}) });
      db.setStatus(c.id, status, "test");
      return c;
    };
    const logs: Record<string, string> = {
      "/p/aaaaaaaa-0000-4000-8000-000000000001.jsonl": log(user("fais X", now - 60_000), assistant("tool_use", ["tool_use"], now - 50_000)),
      "/p/aaaaaaaa-0000-4000-8000-000000000002.jsonl": log(user("fais Y", now - 60_000), assistant("end_turn", ["text"], now - 50_000)),
      "/p/aaaaaaaa-0000-4000-8000-000000000003.jsonl": log(user("fais Z", now - ASLEEP_MS - 120_000), assistant("tool_use", ["tool_use"], now - ASLEEP_MS - 60_000)),
    };
    const byCwd: Record<string, string> = { "/wt/a": "/p/aaaaaaaa-0000-4000-8000-000000000001.jsonl", "/repo": "/p/aaaaaaaa-0000-4000-8000-000000000003.jsonl" };
    const source = {
      resolve: async (id: string) => `/p/${id}.jsonl` in logs ? `/p/${id}.jsonl` : null,
      resolveByCwd: async (cwd: string) => byCwd[cwd] ?? null,
      load: async (path: string) => ({ text: logs[path]!, complete: true, size: 0, mtimeMs: 0 }),
    } as unknown as TranscriptSource;
    const starts: string[] = [];
    const herdr = {
      async startAgent(o: { paneId: string; kind: string; args?: string[] }) { starts.push(`${o.paneId} ${o.kind} ${(o.args ?? []).join(" ")}`); },
      async getAgent() { return { interactive_ready: true }; },
    } as never;
    const resumer = new LostAgentResumer(db, herdr, source, "claude", () => now, async () => {});
    return { db, card, resumer, starts };
  }

  it("resumes the one at work, leaves the finished and the sleeping, says so once, never twice", async () => {
    const { db, card, resumer, starts } = setup();
    const working = card("en cours", "t1", "working");
    card("fini", "t2", "review", "aaaaaaaa-0000-4000-8000-000000000002");
    const panes = [
      shell("t1", "/wt/a"),
      shell("t2", "/wt/b"),
      shell("t3", "/repo", { paneLabel: "orchestrator-repo" }),
      shell("t4", "/home"), // the operator's own shell: nothing known, untouched
      shell("w1:p1", "/wt/a"), // herdr 0.9 relaunches its own
    ];

    const out = await resumer.scan(snap(panes));
    expect(out).toEqual({ resume: ["en cours"], finished: ["fini"], asleep: [expect.stringMatching(/^orch-repo/)] });
    expect(starts).toEqual(["t1 claude --resume aaaaaaaa-0000-4000-8000-000000000001"]);
    expect(db.openSessionFor(working.id)!.agentSessionId).toBe("aaaaaaaa-0000-4000-8000-000000000001");
    const recaps = db.eventsAfter(0).filter((e) => e.type === RESUMED_EVENT);
    expect(recaps.map((e) => (e.payload as { line: string }).line)).toEqual(["Terminaux perdus : 1 agent repris, 1 terminé laissé, 1 endormi laissé"]);

    // Still a shell on the next pass (the snapshot has not caught up, or the relaunch failed): not again.
    expect(await resumer.scan(snap(panes))).toEqual({ resume: [], finished: [], asleep: [] });
    expect(starts).toHaveLength(1);
    expect(db.eventsAfter(0).filter((e) => e.type === RESUMED_EVENT)).toHaveLength(1);
  });

  it("a card just started is a shell waiting for its agent, not a lost one", async () => {
    const { db, starts } = setup();
    const c = db.createCard({ title: "neuve", repoPath: "/repo", baseRef: "main", status: "ready" });
    db.openSession({ cardId: c.id, paneId: "t1", agentKind: "claude" });
    const fresh = new LostAgentResumer(db, { startAgent: async () => starts.push("x") } as never, {} as TranscriptSource, "claude", () => Date.now());
    expect(await fresh.scan(snap([shell("t1", "/wt/a")]))).toEqual({ resume: [], finished: [], asleep: [] });
    expect(starts).toEqual([]);
  });
});
