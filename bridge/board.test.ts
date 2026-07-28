import { describe, expect, it } from "bun:test";

import {
  agentNameFor,
  isTransientHerdrError,
  branchFromTitle,
  cardViews,
  initialPrompt,
  reconcile,
  reconcileOne,
  startCard,
} from "./cards.ts";
import type { Config } from "./config.ts";
import { parseCardBody } from "./board-routes.ts";
import { BoardDb, type Card, type CardSession } from "./db.ts";
import type { EngineSnapshot } from "./state-engine.ts";
import type { AgentStatus, AgentView } from "./types.ts";

// The board's whole point is that a card outlives the pane that worked on it, so these tests are
// mostly about the two directions of that: a pane that disappears must orphan (not lose) its card,
// and a live pane must drive its card's column without any extra plumbing.

function db(): BoardDb {
  return new BoardDb(":memory:");
}

function pane(paneId: string, status: AgentStatus, extra: Partial<AgentView> = {}): AgentView {
  return {
    paneId,
    workspaceId: "w1",
    workspaceLabel: "demo",
    workspaceNumber: 1,
    tabId: "w1:t1",
    agent: "claude",
    status,
    cwd: "/repo",
    focused: false,
    kind: "agent",
    ...extra,
  };
}

function snapshot(panes: AgentView[], bridge: EngineSnapshot["bridge"] = "connected"): EngineSnapshot {
  return { agents: panes, shellPanes: [], workspaces: [], tabs: [], bridge };
}

describe("BoardDb", () => {
  it("round-trips a card, including its JSON acceptance list", () => {
    const store = db();
    const card = store.createCard({
      title: "add the diff view",
      spec: "# spec",
      acceptance: ["renders --stat", "taps into a file diff"],
      repoPath: "/repo",
      baseRef: "main",
    });
    const back = store.getCard(card.id)!;
    expect(back.title).toBe("add the diff view");
    expect(back.acceptance).toEqual(["renders --stat", "taps into a file diff"]);
    expect(back.status).toBe("backlog");
    expect(back.repoPath).toBe("/repo");
  });

  it("keeps archived cards out of the board list but not out of the database", () => {
    const store = db();
    const a = store.createCard({ title: "live" });
    const b = store.createCard({ title: "gone", status: "archived" });
    expect(store.listCards().map((c) => c.id)).toEqual([a.id]);
    expect(store.listCards({ includeArchived: true }).length).toBe(2);
    expect(store.getCard(b.id)).not.toBeNull();
  });

  it("journals every status change with its reason", () => {
    const store = db();
    const card = store.createCard({ title: "x" });
    store.setStatus(card.id, "working", "agent working");
    const types = store.listEvents(card.id).map((e) => e.type);
    expect(types).toContain("card.status");
    const evt = store.listEvents(card.id).find((e) => e.type === "card.status")!;
    expect(evt.payload).toEqual({ from: "backlog", to: "working", reason: "agent working" });
  });

  it("setStatus to the current status is a no-op — no duplicate journal entries", () => {
    const store = db();
    const card = store.createCard({ title: "x", status: "working" });
    store.setStatus(card.id, "working", "agent working");
    expect(store.listEvents(card.id).filter((e) => e.type === "card.status")).toHaveLength(0);
  });

  it("keeps at most one open session per card and chains them oldest-first", () => {
    const store = db();
    const card = store.createCard({ title: "x" });
    const first = store.openSession({ cardId: card.id, paneId: "w1:p1" });
    store.closeSession(first.id, "handoff");
    const second = store.openSession({ cardId: card.id, paneId: "w1:p2" });
    expect(store.openSessionFor(card.id)!.id).toBe(second.id);
    expect(store.listSessions(card.id).map((s) => s.paneId)).toEqual(["w1:p1", "w1:p2"]);
    expect(store.listOpenSessions().map((s) => s.id)).toEqual([second.id]);
  });

  it("closing an already-closed session does not rewrite its outcome", () => {
    const store = db();
    const card = store.createCard({ title: "x" });
    const s = store.openSession({ cardId: card.id, paneId: "w1:p1" });
    store.closeSession(s.id, "handoff");
    store.closeSession(s.id, "lost");
    expect(store.getSession(s.id)!.outcome).toBe("handoff");
  });

  it("deleteCard takes its sessions, reviews and journal with it", () => {
    const store = db();
    const card = store.createCard({ title: "x" });
    const s = store.openSession({ cardId: card.id, paneId: "w1:p1" });
    store.createReview({ cardId: card.id, sessionId: s.id, verdict: "complete" });
    store.deleteCard(card.id);
    expect(store.getCard(card.id)).toBeNull();
    expect(store.listSessions(card.id)).toEqual([]);
    expect(store.listReviews(card.id)).toEqual([]);
    expect(store.listEvents(card.id)).toEqual([]);
  });

});

describe("reconcileOne", () => {
  const card = (status: Card["status"]): Card => ({
    id: "c1",
    title: "x",
    spec: null,
    rawInput: null,
    acceptance: [],
    status,
    repoPath: null,
    baseRef: null,
    branch: null,
    workspaceId: null,
    agentKind: null,
    position: 0,
    createdAt: 0,
    updatedAt: 0,
  });
  const session = (startedAt: number, paneId: string | null = "w1:p1"): CardSession => ({
    id: "s1",
    cardId: "c1",
    paneId,
    agentSessionId: null,
    agentKind: null,
    ctxTokens: null,
    ctxPct: null,
    handoffMd: null,
    outcome: null,
    startedAt,
    endedAt: null,
  });

  it("holds off orphaning inside the grace window — the pane may just not be in the snapshot yet", () => {
    expect(reconcileOne(card("starting"), session(1_000), undefined, 5_000)).toBeNull();
  });

  it("orphans once the grace window has passed", () => {
    expect(reconcileOne(card("working"), session(0), undefined, 60_000)).toEqual({ kind: "orphan" });
  });

  it("never re-orphans an already-orphaned card", () => {
    expect(reconcileOne(card("orphaned"), session(0), undefined, 60_000)).toBeNull();
  });

  it("never orphans a session that has no pane id yet", () => {
    expect(reconcileOne(card("starting"), session(0, null), undefined, 60_000)).toBeNull();
  });

  it("maps agent status onto the column: working/idle → working, blocked → blocked, done → review", () => {
    expect(reconcileOne(card("starting"), session(0), pane("w1:p1", "working"), 60_000))
      .toEqual({ kind: "column", status: "working" });
    expect(reconcileOne(card("blocked"), session(0), pane("w1:p1", "idle"), 60_000))
      .toEqual({ kind: "column", status: "working" });
    expect(reconcileOne(card("working"), session(0), pane("w1:p1", "blocked"), 60_000))
      .toEqual({ kind: "column", status: "blocked" });
    expect(reconcileOne(card("working"), session(0), pane("w1:p1", "done"), 60_000))
      .toEqual({ kind: "column", status: "review" });
  });

  it("leaves the column alone on an unknown agent status", () => {
    expect(reconcileOne(card("working"), session(0), pane("w1:p1", "unknown"), 60_000)).toBeNull();
  });
});

describe("reconcile", () => {
  it("orphans a card whose pane vanished, and marks its session lost", () => {
    const store = db();
    const card = store.createCard({ title: "x", status: "working" });
    const s = store.openSession({ cardId: card.id, paneId: "w1:p1" });
    reconcile(store, snapshot([]), s.startedAt + 60_000);
    expect(store.getCard(card.id)!.status).toBe("orphaned");
    expect(store.getSession(s.id)!.outcome).toBe("lost");
    expect(store.openSessionFor(card.id)).toBeNull();
  });

  it("IGNORES a disconnected snapshot — a socket blip must not orphan the whole board", () => {
    const store = db();
    const card = store.createCard({ title: "x", status: "working" });
    const s = store.openSession({ cardId: card.id, paneId: "w1:p1" });
    reconcile(store, snapshot([], "disconnected"), s.startedAt + 60_000);
    expect(store.getCard(card.id)!.status).toBe("working");
    expect(store.getSession(s.id)!.outcome).toBeNull();
  });

  it("moves a card into its pane's column without being asked", () => {
    const store = db();
    const card = store.createCard({ title: "x", status: "starting" });
    store.openSession({ cardId: card.id, paneId: "w1:p1" });
    reconcile(store, snapshot([pane("w1:p1", "blocked")]));
    expect(store.getCard(card.id)!.status).toBe("blocked");
  });

  it("copies the agent's own session id onto the card session so the transcript stays findable", () => {
    const store = db();
    const card = store.createCard({ title: "x", status: "working" });
    const s = store.openSession({ cardId: card.id, paneId: "w1:p1" });
    reconcile(store, snapshot([pane("w1:p1", "working", { agentSessionId: "uuid-1" })]));
    expect(store.getSession(s.id)!.agentSessionId).toBe("uuid-1");
  });
});

describe("cardViews", () => {
  it("merges live pane state into the card, and reports null runtime when there is no pane", () => {
    const store = db();
    const live = store.createCard({ title: "live", status: "working" });
    store.openSession({ cardId: live.id, paneId: "w1:p1" });
    const idle = store.createCard({ title: "backlog" });

    const views = cardViews(store, snapshot([pane("w1:p1", "blocked")]));
    const liveView = views.find((v) => v.id === live.id)!;
    const idleView = views.find((v) => v.id === idle.id)!;

    expect(liveView.runtime).toEqual({
      paneId: "w1:p1",
      agent: "claude",
      agentStatus: "blocked",
      cwd: "/repo",
      workspaceId: "w1",
      workspaceLabel: "demo",
    });
    expect(liveView.sessionCount).toBe(1);
    expect(idleView.runtime).toBeNull();
    expect(idleView.session).toBeNull();
  });
});

describe("parseCardBody", () => {
  it("requires a non-blank title on create", () => {
    expect(parseCardBody({}, { requireTitle: true })).toEqual({ ok: false, error: "title required" });
    expect(parseCardBody({ title: "   " }, { requireTitle: true })).toEqual({
      ok: false,
      error: "title required",
    });
  });

  it("accepts an empty patch", () => {
    expect(parseCardBody({}, { requireTitle: false })).toEqual({ ok: true, value: {} });
  });

  it("rejects an unknown status rather than writing it", () => {
    expect(parseCardBody({ status: "in-progress" }, { requireTitle: false })).toEqual({
      ok: false,
      error: "bad status",
    });
  });

  it("rejects a non-string acceptance entry", () => {
    expect(parseCardBody({ acceptance: ["ok", 3] }, { requireTitle: false })).toEqual({
      ok: false,
      error: "bad acceptance",
    });
  });

  it("normalises blank optional strings to null and trims the rest", () => {
    const parsed = parseCardBody({ title: " ship ", spec: "  ", repoPath: " /repo " }, { requireTitle: true });
    expect(parsed).toEqual({ ok: true, value: { title: "ship", spec: null, repoPath: "/repo" } });
  });

  it("ignores unknown keys instead of writing them", () => {
    expect(parseCardBody({ title: "x", paneId: "w1:p1" }, { requireTitle: true })).toEqual({
      ok: true,
      value: { title: "x" },
    });
  });
});

describe("branchFromTitle", () => {
  it("slugs a dictated title into something git will accept", () => {
    expect(branchFromTitle("Add a diff view, scoped to the branch")).toBe(
      "board/add-a-diff-view-scoped-to-the-branch",
    );
  });

  it("folds accents rather than dropping the letters", () => {
    expect(branchFromTitle("Réécrire la télémétrie")).toBe("board/reecrire-la-telemetrie");
  });

  it("strips every character git rejects in a ref name", () => {
    // ~ ^ : ? * [ \ .. and spaces are all illegal in a ref; none may survive.
    const branch = branchFromTitle("fix~this^that:now?maybe*[x]\\ok..done");
    expect(branch).toBe("board/fix-this-that-now-maybe-x-ok-done");
    expect(branch).not.toMatch(/[~^:?*[\]\\ ]|\.\./);
  });

  it("never emits a trailing or doubled separator", () => {
    expect(branchFromTitle("  spaces   everywhere  ")).toBe("board/spaces-everywhere");
    expect(branchFromTitle("trailing punctuation!!!")).toBe("board/trailing-punctuation");
  });

  it("falls back to a usable name when the title slugs to nothing", () => {
    expect(branchFromTitle("!!! ???")).toBe("board/card");
  });

  it("clips long titles without leaving a dangling dash", () => {
    const branch = branchFromTitle("a".repeat(20) + " " + "b".repeat(60));
    expect(branch.startsWith("board/")).toBe(true);
    expect(branch.endsWith("-")).toBe(false);
    expect(branch.length).toBeLessThanOrEqual("board/".length + 48);
  });

  it("honours a custom prefix", () => {
    expect(branchFromTitle("ship it", "wip/")).toBe("wip/ship-it");
  });
});

describe("initialPrompt", () => {
  const base = {
    id: "c1",
    title: "ship it",
    rawInput: null,
    status: "ready" as const,
    repoPath: null,
    baseRef: null,
    branch: null,
    workspaceId: null,
    agentKind: null,
    position: 0,
    createdAt: 0,
    updatedAt: 0,
  };

  it("uses the spec, with the acceptance criteria spelled out as a checklist", () => {
    const text = initialPrompt({ ...base, spec: "Rewrite the parser.", acceptance: ["tests pass", "no new deps"] });
    expect(text).toContain("Rewrite the parser.");
    expect(text).toContain("- tests pass");
    expect(text).toContain("- no new deps");
  });

  it("falls back to the title when there is no spec", () => {
    expect(initialPrompt({ ...base, spec: null, acceptance: [] })).toBe("ship it");
  });
});

// A fake herdr that records what it was asked to do. `fail` makes the named method throw, which is
// how the start sequence's partial-failure branches get exercised without a live server.
function fakeHerdr(fail: Set<string> = new Set(), readyAfter?: number) {
  const calls: string[] = [];
  const client = {
    async createWorktree(opts: { branch: string }) {
      calls.push("createWorktree");
      if (fail.has("createWorktree")) throw new Error("existe déjà");
      return {
        checkoutPath: `/wt/${opts.branch}`,
        branch: opts.branch,
        workspaceId: "wZ",
        workspaceLabel: opts.branch,
        tabId: "wZ:t1",
        paneId: "wZ:p1",
        alreadyOpen: false,
      };
    },
    async openWorktree(opts: { branch: string }) {
      calls.push("openWorktree");
      if (fail.has("openWorktree")) throw new Error("no such worktree");
      return {
        checkoutPath: `/wt/${opts.branch}`,
        branch: opts.branch,
        workspaceId: "wZ",
        workspaceLabel: opts.branch,
        tabId: "wZ:t1",
        paneId: "wZ:p1",
        alreadyOpen: true,
      };
    },
    async getAgent() {
      calls.push("getAgent");
      // Ready only once the caller has polled at least once — mirrors herdr, where agent.start
      // returns long before `interactive_ready` flips.
      const polls = calls.filter((c) => c === "getAgent").length;
      if (fail.has("neverReady")) return { interactive_ready: false };
      return { interactive_ready: polls >= (readyAfter ?? 1) };
    },
    async startAgent() {
      calls.push("startAgent");
      if (fail.has("startAgent")) throw new Error("agent never became ready");
      // "busy:N" makes the first N attempts fail the way a still-booting shell does.
      const busy = [...fail].find((f) => f.startsWith("busy:"));
      if (busy && calls.filter((c) => c === "startAgent").length <= Number(busy.slice(5))) {
        throw new Error("herdr agent.start: agent_pane_busy: pane is not an available shell");
      }
    },
    async promptAgent() {
      calls.push("promptAgent");
      if (fail.has("promptAgent")) throw new Error("prompt rejected");
      // "notready:N" makes the first N prompts fail the way herdr does while the agent registers.
      const nr = [...fail].find((f) => f.startsWith("notready:"));
      if (nr && calls.filter((c) => c === "promptAgent").length <= Number(nr.slice(9))) {
        throw new Error("herdr agent.prompt: agent_not_ready: not an active named agent");
      }
    },
  };
  return { client, calls };
}

const startCfg = { boardAgentKind: "claude", boardMaxAgents: 2, boardBranchPrefix: "board/" } as Config;

describe("startCard", () => {
  it("creates the worktree, launches the agent, sends the spec, and opens a session", async () => {
    const store = db();
    const card = store.createCard({ title: "ship it", repoPath: "/repo", baseRef: "main", status: "ready" });
    const { client, calls } = fakeHerdr();
    const res = await startCard(store, client as never, startCfg, card.id);

    expect(res.ok).toBe(true);
    expect(calls).toEqual(["createWorktree", "startAgent", "getAgent", "promptAgent"]);
    const after = store.getCard(card.id)!;
    expect(after.status).toBe("starting");
    expect(after.branch).toBe("board/ship-it");
    expect(after.workspaceId).toBe("wZ");
    expect(store.openSessionFor(card.id)!.paneId).toBe("wZ:p1");
  });

  it("falls back to opening the worktree when the checkout already exists (the relaunch path)", async () => {
    const store = db();
    const card = store.createCard({ title: "ship it", repoPath: "/repo", branch: "board/ship-it" });
    const { client, calls } = fakeHerdr(new Set(["createWorktree"]));
    const res = await startCard(store, client as never, startCfg, card.id);

    expect(res.ok).toBe(true);
    expect(calls).toEqual(["createWorktree", "openWorktree", "startAgent", "getAgent", "promptAgent"]);
  });

  it("refuses a card with no repo path instead of guessing one", async () => {
    const store = db();
    const card = store.createCard({ title: "ship it" });
    const { client, calls } = fakeHerdr();
    const res = await startCard(store, client as never, startCfg, card.id);

    expect(res).toMatchObject({ ok: false, error: { kind: "no-repo" } });
    expect(calls).toEqual([]);
  });

  it("refuses to start a card that is already running", async () => {
    const store = db();
    const card = store.createCard({ title: "ship it", repoPath: "/repo" });
    store.openSession({ cardId: card.id, paneId: "wZ:p1" });
    const { client } = fakeHerdr();
    const res = await startCard(store, client as never, startCfg, card.id);
    expect(res).toMatchObject({ ok: false, error: { kind: "already-running" } });
  });

  it("enforces the concurrency semaphore from the DATABASE, so a restart doesn't forget", async () => {
    const store = db();
    for (let i = 0; i < 2; i++) {
      const busy = store.createCard({ title: `busy ${i}`, repoPath: "/repo" });
      store.openSession({ cardId: busy.id, paneId: `wZ:p${i}` });
    }
    const card = store.createCard({ title: "third", repoPath: "/repo" });
    const { client, calls } = fakeHerdr();
    const res = await startCard(store, client as never, startCfg, card.id);

    expect(res).toMatchObject({ ok: false, error: { kind: "busy" } });
    expect(calls).toEqual([]);
  });

  it("remembers the worktree even when agent.start fails, so a retry doesn't re-create it", async () => {
    const store = db();
    const card = store.createCard({ title: "ship it", repoPath: "/repo" });
    const { client } = fakeHerdr(new Set(["startAgent"]));
    const res = await startCard(store, client as never, startCfg, card.id);

    expect(res.ok).toBe(false);
    const after = store.getCard(card.id)!;
    expect(after.workspaceId).toBe("wZ");
    expect(after.branch).toBe("board/ship-it");
    expect(store.listEvents(card.id).some((e) => e.type === "card.start_failed")).toBe(true);
  });

  it("a failed agent.start leaves the card RETRYABLE — it must not wedge on a live shell pane", async () => {
    const store = db();
    const card = store.createCard({ title: "ship it", repoPath: "/repo" });
    const failing = fakeHerdr(new Set(["startAgent"]));
    await startCard(store, failing.client as never, startCfg, card.id);

    // The session is closed and the card is startable again — the pane is a bare shell, so
    // reconciliation would never orphan it and "already running" would be permanent.
    expect(store.openSessionFor(card.id)).toBeNull();
    expect(store.getCard(card.id)!.status).toBe("ready");

    const retry = fakeHerdr(new Set(["createWorktree"]));
    const res = await startCard(store, retry.client as never, startCfg, card.id);
    expect(res.ok).toBe(true);
    expect(retry.calls).toContain("openWorktree");
  });

  it("keeps the session when only the prompt fails — the agent is up and drivable by hand", async () => {
    const store = db();
    const card = store.createCard({ title: "ship it", repoPath: "/repo" });
    const { client } = fakeHerdr(new Set(["promptAgent"]));
    const res = await startCard(store, client as never, startCfg, card.id);

    expect(res.ok).toBe(false);
    expect(store.openSessionFor(card.id)).not.toBeNull();
  });

  it("reports the CREATE error, not the open error, when both fail", async () => {
    const store = db();
    const card = store.createCard({ title: "ship it", repoPath: "/repo" });
    const { client } = fakeHerdr(new Set(["createWorktree", "openWorktree"]));
    const res = await startCard(store, client as never, startCfg, card.id);
    expect(res).toMatchObject({ ok: false, error: { kind: "herdr", message: "existe déjà" } });
  });
});

describe("agentNameFor", () => {
  it("drops the branch prefix — herdr rejects a name containing '/'", () => {
    expect(agentNameFor("board/add-a-diff-view")).toBe("add-a-diff-view");
  });

  it("forces a leading lowercase letter", () => {
    expect(agentNameFor("board/2fa-login")).toBe("fa-login");
    expect(agentNameFor("board/-leading-dash")).toBe("leading-dash");
  });

  it("clips to herdr's 32-character ceiling without a trailing separator", () => {
    const name = agentNameFor(`board/${"ab-".repeat(20)}`);
    expect(name.length).toBeLessThanOrEqual(32);
    expect(name).toMatch(/^[a-z][a-z0-9_-]*$/);
    expect(name.endsWith("-")).toBe(false);
  });

  it("always returns something herdr will accept, even from an unusable branch", () => {
    expect(agentNameFor("board/123")).toBe("card");
    expect(agentNameFor("")).toBe("card");
  });
});

describe("startCard — the pane isn't a shell yet", () => {
  it("retries agent.start while herdr says agent_pane_busy (a shell still sourcing its rc)", async () => {
    const store = db();
    const card = store.createCard({ title: "ship it", repoPath: "/repo" });
    const { client, calls } = fakeHerdr(new Set(["busy:2"]));
    const res = await startCard(store, client as never, startCfg, card.id, { sleep: async () => {} });

    expect(res.ok).toBe(true);
    expect(calls.filter((c) => c === "startAgent")).toHaveLength(3);
  });

  it("gives up after the attempt budget rather than retrying forever", async () => {
    const store = db();
    const card = store.createCard({ title: "ship it", repoPath: "/repo" });
    const { client, calls } = fakeHerdr(new Set(["busy:99"]));
    const res = await startCard(store, client as never, startCfg, card.id, { sleep: async () => {} });

    expect(res).toMatchObject({ ok: false, error: { kind: "herdr" } });
    expect(calls.filter((c) => c === "startAgent")).toHaveLength(6);
  });

  it("does NOT retry a real failure — only agent_pane_busy is transient", async () => {
    const store = db();
    const card = store.createCard({ title: "ship it", repoPath: "/repo" });
    const { client, calls } = fakeHerdr(new Set(["startAgent"]));
    const res = await startCard(store, client as never, startCfg, card.id, { sleep: async () => {} });

    expect(res.ok).toBe(false);
    expect(calls.filter((c) => c === "startAgent")).toHaveLength(1);
  });
});

describe("isTransientHerdrError", () => {
  it("recognises the two 'not yet' codes and nothing else", () => {
    expect(isTransientHerdrError(new Error("herdr agent.start: agent_pane_busy: …"))).toBe(true);
    expect(isTransientHerdrError(new Error("herdr agent.prompt: agent_not_ready: …"))).toBe(true);
    expect(isTransientHerdrError(new Error("herdr agent.start: invalid_agent_name: …"))).toBe(false);
    expect(isTransientHerdrError(new Error("timed out after 5000ms"))).toBe(false);
    expect(isTransientHerdrError("agent_not_ready")).toBe(false);
  });
});

describe("startCard — the agent isn't a prompt target yet", () => {
  it("retries agent.prompt while herdr says agent_not_ready", async () => {
    const store = db();
    const card = store.createCard({ title: "ship it", repoPath: "/repo" });
    const { client, calls } = fakeHerdr(new Set(["notready:2"]));
    const res = await startCard(store, client as never, startCfg, card.id, { sleep: async () => {} });

    expect(res.ok).toBe(true);
    expect(calls.filter((c) => c === "promptAgent")).toHaveLength(3);
  });
});

describe("waitForAgentReady (through startCard)", () => {
  it("polls agent.get until interactive_ready before prompting — agent.start does not wait", async () => {
    const store = db();
    const card = store.createCard({ title: "ship it", repoPath: "/repo" });
    const { client, calls } = fakeHerdr(new Set(), 3);
    const res = await startCard(store, client as never, startCfg, card.id, { sleep: async () => {} });

    expect(res.ok).toBe(true);
    expect(calls.filter((c) => c === "getAgent")).toHaveLength(3);
    // The prompt must come AFTER the readiness polls, never interleaved with them.
    expect(calls.lastIndexOf("getAgent")).toBeLessThan(calls.indexOf("promptAgent"));
  });

  it("fails the start when the agent never becomes ready, instead of prompting into the void", async () => {
    const store = db();
    const card = store.createCard({ title: "ship it", repoPath: "/repo" });
    const { client, calls } = fakeHerdr(new Set(["neverReady"]));
    const res = await startCard(store, client as never, startCfg, card.id, { sleep: async () => {} });

    expect(res).toMatchObject({ ok: false, error: { kind: "herdr" } });
    expect(calls).not.toContain("promptAgent");
    // And the card is left retryable, not wedged (same rule as a failed agent.start).
    expect(store.openSessionFor(card.id)).toBeNull();
    expect(store.getCard(card.id)!.status).toBe("ready");
  });
});
