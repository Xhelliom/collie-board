import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  agentNameFor,
  isTransientHerdrError,
  promptAndConfirm,
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
import {
  adapterFor,
  BUILTIN_ADAPTERS,
  loadAdapters,
  mergeAdapters,
} from "./adapters.ts";
import { contextPercent } from "./context.ts";
import {
  Copilot,
  parseJsonish,
  reformulatePrompt,
  reviewPrompt,
  slugBranch,
  toReformulation,
  toReviewResult,
} from "./copilot.ts";
import {
  isSafeDiffPath,
  parseNumstat,
  parseUntracked,
  parseWorktreeList,
  type GitRunner,
} from "./git.ts";
import {
  continuationPrompt,
  HandoffCoordinator,
  HANDOFF_REL_PATH,
  handoffPrompt,
  requestHandoff,
} from "./handoff.ts";
import {
  basename,
  defaultBranchOf,
  listRepos,
  mergeRepoChoices,
  repoRootOf,
  scanRootsFor,
} from "./repos.ts";
import { latestUsage } from "./transcript.ts";
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
    handoffRequestedAt: null,
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
    async sendPaneKeys() {
      calls.push("sendPaneKeys");
    },
    async getAgent() {
      calls.push("getAgent");
      // Ready only once the caller has polled at least once — mirrors herdr, where agent.start
      // returns long before `interactive_ready` flips.
      const polls = calls.filter((c) => c === "getAgent").length;
      if (fail.has("neverReady")) return { interactive_ready: false };
      // `promptSwallowed` reproduces herdr's real behaviour: the prompt lands in the input box but
      // is never submitted, so the agent stays idle and needs an Enter.
      const agent_status = fail.has("promptSwallowed") ? "idle" : "working";
      return { interactive_ready: polls >= (readyAfter ?? 1), agent_status };
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
    const res = await startCard(store, client as never, startCfg, card.id, { sleep: async () => {} });

    expect(res.ok).toBe(true);
    // The trailing getAgent is promptAndConfirm checking the prompt actually got submitted.
    expect(calls).toEqual(["createWorktree", "startAgent", "getAgent", "promptAgent", "getAgent"]);
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
    const res = await startCard(store, client as never, startCfg, card.id, { sleep: async () => {} });

    expect(res.ok).toBe(true);
    expect(calls).toEqual([
      "createWorktree",
      "openWorktree",
      "startAgent",
      "getAgent",
      "promptAgent",
      "getAgent",
    ]);
  });

  it("refuses a card with no repo path instead of guessing one", async () => {
    const store = db();
    const card = store.createCard({ title: "ship it" });
    const { client, calls } = fakeHerdr();
    const res = await startCard(store, client as never, startCfg, card.id, { sleep: async () => {} });

    expect(res).toMatchObject({ ok: false, error: { kind: "no-repo" } });
    expect(calls).toEqual([]);
  });

  it("refuses to start a card that is already running", async () => {
    const store = db();
    const card = store.createCard({ title: "ship it", repoPath: "/repo" });
    store.openSession({ cardId: card.id, paneId: "wZ:p1" });
    const { client } = fakeHerdr();
    const res = await startCard(store, client as never, startCfg, card.id, { sleep: async () => {} });
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
    const res = await startCard(store, client as never, startCfg, card.id, { sleep: async () => {} });

    expect(res).toMatchObject({ ok: false, error: { kind: "busy" } });
    expect(calls).toEqual([]);
  });

  it("remembers the worktree even when agent.start fails, so a retry doesn't re-create it", async () => {
    const store = db();
    const card = store.createCard({ title: "ship it", repoPath: "/repo" });
    const { client } = fakeHerdr(new Set(["startAgent"]));
    const res = await startCard(store, client as never, startCfg, card.id, { sleep: async () => {} });

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
    await startCard(store, failing.client as never, startCfg, card.id, { sleep: async () => {} });

    // The session is closed and the card is startable again — the pane is a bare shell, so
    // reconciliation would never orphan it and "already running" would be permanent.
    expect(store.openSessionFor(card.id)).toBeNull();
    expect(store.getCard(card.id)!.status).toBe("ready");

    const retry = fakeHerdr(new Set(["createWorktree"]));
    const res = await startCard(store, retry.client as never, startCfg, card.id, { sleep: async () => {} });
    expect(res.ok).toBe(true);
    expect(retry.calls).toContain("openWorktree");
  });

  it("keeps the session when only the prompt fails — the agent is up and drivable by hand", async () => {
    const store = db();
    const card = store.createCard({ title: "ship it", repoPath: "/repo" });
    const { client } = fakeHerdr(new Set(["promptAgent"]));
    const res = await startCard(store, client as never, startCfg, card.id, { sleep: async () => {} });

    expect(res.ok).toBe(false);
    expect(store.openSessionFor(card.id)).not.toBeNull();
  });

  it("reports the CREATE error, not the open error, when both fail", async () => {
    const store = db();
    const card = store.createCard({ title: "ship it", repoPath: "/repo" });
    const { client } = fakeHerdr(new Set(["createWorktree", "openWorktree"]));
    const res = await startCard(store, client as never, startCfg, card.id, { sleep: async () => {} });
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
    // 3 readiness polls, then the prompt, then promptAndConfirm's own check.
    expect(calls).toEqual([
      "createWorktree",
      "startAgent",
      "getAgent",
      "getAgent",
      "getAgent",
      "promptAgent",
      "getAgent",
    ]);
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

describe("git — worktree resolution and diff parsing", () => {
  it("parses `git worktree list --porcelain` into (path, branch) pairs", () => {
    const out = [
      "worktree /home/me/repo",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /home/me/.herdr/worktrees/repo/board-x",
      "HEAD def456",
      "branch refs/heads/board/x",
      "",
    ].join("\n");
    expect(parseWorktreeList(out)).toEqual([
      { path: "/home/me/repo", branch: "main" },
      { path: "/home/me/.herdr/worktrees/repo/board-x", branch: "board/x" },
    ]);
  });

  it("reports a detached worktree with a null branch rather than dropping it", () => {
    const out = ["worktree /tmp/det", "HEAD abc123", "detached", ""].join("\n");
    expect(parseWorktreeList(out)).toEqual([{ path: "/tmp/det", branch: null }]);
  });

  it("parses numstat, treating a binary file's '-' counts as zero", () => {
    const out = "12\t3\tsrc/a.ts\n-\t-\tassets/logo.png\n";
    expect(parseNumstat(out)).toEqual([
      { path: "src/a.ts", added: 12, removed: 3, kind: "text" },
      { path: "assets/logo.png", added: 0, removed: 0, kind: "binary" },
    ]);
  });

  it("keeps a path containing a tab intact", () => {
    expect(parseNumstat("1\t0\tweird\tname.ts\n")[0]!.path).toBe("weird\tname.ts");
  });

  it("picks untracked files out of status --porcelain and ignores tracked changes", () => {
    const out = " M src/a.ts\n?? src/new.ts\n?? docs/\nA  src/added.ts\n";
    expect(parseUntracked(out)).toEqual(["src/new.ts", "docs/"]);
  });
});

describe("isSafeDiffPath", () => {
  it("accepts a path inside the checkout", () => {
    expect(isSafeDiffPath("/wt/card", "src/a.ts")).toBe(true);
  });

  it("rejects traversal out of the checkout", () => {
    expect(isSafeDiffPath("/wt/card", "../../etc/passwd")).toBe(false);
    expect(isSafeDiffPath("/wt/card", "/etc/passwd")).toBe(false);
  });

  it("rejects an option-looking argument even though call sites also use `--`", () => {
    expect(isSafeDiffPath("/wt/card", "--output=/tmp/x")).toBe(false);
    expect(isSafeDiffPath("/wt/card", "-p")).toBe(false);
  });

  it("rejects an empty path and an embedded NUL", () => {
    expect(isSafeDiffPath("/wt/card", "")).toBe(false);
    expect(isSafeDiffPath("/wt/card", "a\0b")).toBe(false);
  });

  it("does not let a sibling directory that shares the prefix through", () => {
    expect(isSafeDiffPath("/wt/card", "../card-evil/x")).toBe(false);
  });
});

describe("latestUsage", () => {
  const row = (o: Record<string, unknown>) => JSON.stringify(o);

  it("sums input + cache_creation + cache_read on the newest assistant turn", () => {
    const log = [
      row({ type: "assistant", message: { usage: { input_tokens: 1, cache_read_input_tokens: 10 } } }),
      row({
        type: "assistant",
        message: {
          usage: {
            input_tokens: 2,
            cache_creation_input_tokens: 1458,
            cache_read_input_tokens: 397568,
            output_tokens: 1054,
          },
        },
      }),
    ].join("\n");
    expect(latestUsage(log)).toEqual({ tokens: 399_028, outputTokens: 1054 });
  });

  it("SKIPS sidechains — a subagent's small window would read as a nearly-empty session", () => {
    const log = [
      row({ type: "assistant", message: { usage: { cache_read_input_tokens: 180_000 } } }),
      row({
        type: "assistant",
        isSidechain: true,
        message: { usage: { cache_read_input_tokens: 4_000 } },
      }),
    ].join("\n");
    expect(latestUsage(log)!.tokens).toBe(180_000);
  });

  it("takes the NEWEST turn, not the largest — /compact really does shrink the window", () => {
    const log = [
      row({ type: "assistant", message: { usage: { cache_read_input_tokens: 190_000 } } }),
      row({ type: "assistant", message: { usage: { cache_read_input_tokens: 12_000 } } }),
    ].join("\n");
    expect(latestUsage(log)!.tokens).toBe(12_000);
  });

  it("returns null for a log with no assistant usage at all (level 3)", () => {
    expect(latestUsage("")).toBeNull();
    expect(latestUsage(row({ type: "user", message: { content: "hi" } }))).toBeNull();
  });

  it("survives the clipped first line of a tail read and other junk", () => {
    const log = [
      '{"type":"assistant","message":{"usage":{"cache_re',
      row({ type: "assistant", message: { usage: { cache_read_input_tokens: 5 } } }),
    ].join("\n");
    expect(latestUsage(log)!.tokens).toBe(5);
  });

  it("ignores a usage block that sums to zero rather than reporting 0 %", () => {
    const log = [
      row({ type: "assistant", message: { usage: { cache_read_input_tokens: 900 } } }),
      row({ type: "assistant", message: { usage: { output_tokens: 40 } } }),
    ].join("\n");
    expect(latestUsage(log)!.tokens).toBe(900);
  });
});

describe("contextPercent", () => {
  it("rounds to a whole percent", () => {
    expect(contextPercent(100_000, 200_000)).toBe(50);
    expect(contextPercent(399_028, 1_000_000)).toBe(40);
  });

  it("clamps above the window rather than showing 130 %", () => {
    expect(contextPercent(260_000, 200_000)).toBe(100);
  });

  it("returns null for nonsense inputs instead of NaN", () => {
    expect(contextPercent(0, 200_000)).toBeNull();
    expect(contextPercent(1000, 0)).toBeNull();
  });
});

describe("handoff prompts", () => {
  const card: Card = {
    id: "c1",
    title: "rewrite the parser",
    spec: "Rewrite the parser to be streaming.",
    rawInput: null,
    acceptance: ["handles a 2GB file", "no new deps"],
    status: "working",
    repoPath: "/repo",
    baseRef: "main",
    branch: "board/rewrite",
    workspaceId: "wZ",
    agentKind: "claude",
    position: 0,
    createdAt: 0,
    updatedAt: 0,
  };

  it("asks for decisions-and-why, not a file list git already has", () => {
    const p = handoffPrompt();
    expect(p).toContain(HANDOFF_REL_PATH);
    expect(p).toMatch(/AND WHY/);
    expect(p).toMatch(/next step/i);
  });

  it("opens the incoming agent on the note, the spec and the acceptance criteria", () => {
    const p = continuationPrompt(card);
    expect(p).toContain(HANDOFF_REL_PATH);
    expect(p).toContain("Rewrite the parser to be streaming.");
    expect(p).toContain("- handles a 2GB file");
  });

  it("falls back to the title when a card has no spec", () => {
    expect(continuationPrompt({ ...card, spec: null, acceptance: [] })).toContain("rewrite the parser");
  });
});

describe("requestHandoff", () => {
  const noSleep = async () => {};
  const herdrOk = {
    async promptAgent() {},
    async getAgent() {
      return { agent_status: "working" };
    },
    async sendPaneKeys() {},
  };

  it("refuses a card with no running agent", async () => {
    const store = db();
    const card = store.createCard({ title: "x" });
    const res = await requestHandoff(store, herdrOk as never, card.id, noSleep);
    expect(res).toMatchObject({ ok: false, error: { kind: "no-session" } });
  });

  it("stamps the request on the session so it survives a bridge restart", async () => {
    const store = db();
    const card = store.createCard({ title: "x", status: "working" });
    const s = store.openSession({ cardId: card.id, paneId: "w1:p1" });
    const res = await requestHandoff(store, herdrOk as never, card.id, noSleep);

    expect(res.ok).toBe(true);
    expect(store.getSession(s.id)!.handoffRequestedAt).not.toBeNull();
    expect(store.listEvents(card.id).some((e) => e.type === "handoff.requested")).toBe(true);
  });

  it("refuses a second request while one is in flight", async () => {
    const store = db();
    const card = store.createCard({ title: "x", status: "working" });
    store.openSession({ cardId: card.id, paneId: "w1:p1" });
    await requestHandoff(store, herdrOk as never, card.id, noSleep);
    const again = await requestHandoff(store, herdrOk as never, card.id, noSleep);
    expect(again).toMatchObject({ ok: false, error: { kind: "already-requested" } });
  });

  it("does NOT stamp the session when the prompt itself fails", async () => {
    const store = db();
    const card = store.createCard({ title: "x", status: "working" });
    const s = store.openSession({ cardId: card.id, paneId: "w1:p1" });
    const failing = {
      async promptAgent() {
        throw new Error("socket closed");
      },
    };
    const res = await requestHandoff(store, failing as never, card.id, noSleep);
    expect(res).toMatchObject({ ok: false, error: { kind: "herdr" } });
    expect(store.getSession(s.id)!.handoffRequestedAt).toBeNull();
  });
});

describe("HandoffCoordinator", () => {
  /** A coordinator whose clock we control, over a card with a requested handoff. */
  function setup(requestedAgoMs: number) {
    const store = db();
    const card = store.createCard({ title: "x", status: "working", repoPath: "/repo" });
    const session = store.openSession({ cardId: card.id, paneId: "w1:p1" });
    const t0 = 1_000_000;
    store.patchSession(session.id, { handoffRequestedAt: t0 });
    const now = () => t0 + requestedAgoMs;
    const calls: string[] = [];
    const herdr = {
      async createTab() {
        calls.push("createTab");
        return { paneId: "w1:p2", workspaceId: "wZ", tabId: "wZ:t2", cwd: "/wt" };
      },
      async closePane() {
        calls.push("closePane");
      },
      async startAgent() {
        calls.push("startAgent");
      },
      async promptAgent() {
        calls.push("promptAgent");
      },
      async getAgent() {
        return { interactive_ready: true };
      },
    };
    const co = new HandoffCoordinator(store, herdr as never, startCfg, now);
    return { store, card, session, co, calls };
  }

  it("ignores the idle state the agent was in when it was prompted (the settle window)", () => {
    const { store, session, co, calls } = setup(2_000);
    co.update(snapshot([pane("w1:p1", "idle")]));
    expect(calls).toEqual([]);
    expect(store.getSession(session.id)!.handoffRequestedAt).not.toBeNull();
  });

  it("never swaps the pane of a BLOCKED agent — that would throw its question away", () => {
    const { co, calls } = setup(60_000);
    co.update(snapshot([pane("w1:p1", "blocked")]));
    expect(calls).toEqual([]);
  });

  it("waits while the agent is still working", () => {
    const { co, calls } = setup(60_000);
    co.update(snapshot([pane("w1:p1", "working")]));
    expect(calls).toEqual([]);
  });

  it("gives up on a handoff the agent never wrote, rather than firing it days later", () => {
    const { store, card, session, co, calls } = setup(31 * 60 * 1000);
    co.update(snapshot([pane("w1:p1", "idle")]));
    expect(calls).toEqual([]);
    expect(store.getSession(session.id)!.handoffRequestedAt).toBeNull();
    expect(store.listEvents(card.id).some((e) => e.type === "handoff.expired")).toBe(true);
  });

  it("does nothing at all on a disconnected snapshot", () => {
    const { co, calls } = setup(60_000);
    co.update(snapshot([pane("w1:p1", "idle")], "disconnected"));
    expect(calls).toEqual([]);
  });
});

describe("promptAndConfirm", () => {
  it("does nothing extra when the prompt visibly landed (the agent went to work)", async () => {
    const store = db();
    const card = store.createCard({ title: "x", repoPath: "/repo" });
    const { client, calls } = fakeHerdr();
    await startCard(store, client as never, startCfg, card.id, { sleep: async () => {} });
    expect(calls).not.toContain("sendPaneKeys");
  });

  it("sends one Enter when the agent is still idle — herdr's prompt does not always submit", async () => {
    const store = db();
    const card = store.createCard({ title: "x", repoPath: "/repo" });
    const { client, calls } = fakeHerdr(new Set(["promptSwallowed"]));
    await startCard(store, client as never, startCfg, card.id, { sleep: async () => {} });
    expect(calls.filter((c) => c === "sendPaneKeys")).toHaveLength(1);
    expect(calls.indexOf("promptAgent")).toBeLessThan(calls.indexOf("sendPaneKeys"));
  });
});

describe("copilot output contract", () => {
  it("parses a bare JSON answer", () => {
    expect(parseJsonish('{"title":"x"}')).toEqual({ title: "x" });
  });

  it("accepts a fenced ```json block — the one deviation agents actually make", () => {
    expect(parseJsonish('```json\n{"title":"x"}\n```')).toEqual({ title: "x" });
    expect(parseJsonish('```\n{"title":"x"}\n```')).toEqual({ title: "x" });
  });

  it("returns null on prose, an empty file, or a half-written one", () => {
    expect(parseJsonish("Sure! Here is the JSON:")).toBeNull();
    expect(parseJsonish("")).toBeNull();
    expect(parseJsonish('{"title":"x"')).toBeNull();
  });

  it("keeps only well-formed fields of a reformulation, in either casing", () => {
    expect(
      toReformulation({
        title: " Ship it ",
        spec: "do the thing",
        acceptance: ["a", "", 3, " b "],
        branch_name: "Ship It!",
        split_suggestion: [],
      }),
    ).toEqual({ title: "Ship it", spec: "do the thing", acceptance: ["a", "b"], branchName: "Ship It!" });
  });

  it("rejects a non-object answer rather than half-applying it", () => {
    expect(toReformulation(["a"])).toBeNull();
    expect(toReformulation("nope")).toBeNull();
    expect(toReformulation({ unrelated: 1 })).toBeNull();
  });

  it("keeps only well-formed fields of a review", () => {
    expect(toReviewResult({ verdict: "drift", notes: "  ", todos: ["fix the parser"] })).toEqual({
      verdict: "drift",
      todos: ["fix the parser"],
    });
  });

  it("sanitises a model-suggested branch name — it lands in `git worktree add`", () => {
    expect(slugBranch("Ship It!")).toBe("ship-it");
    expect(slugBranch("réécrire~le/parseur")).toBe("reecrire-le-parseur");
    expect(slugBranch("!!!")).toBe("card");
  });
});

describe("copilot prompts", () => {
  it("tells the reformulator NOT to do the work — a coding agent otherwise starts editing", () => {
    const p = reformulatePrompt("make the parser streaming", ".board/out/ab12.json");
    expect(p).toMatch(/do NOT do the work/i);
    expect(p).toContain(".board/out/ab12.json");
    expect(p).toContain("make the parser streaming");
  });

  it("reviews from the STAT, never the full diff — that is the quota decision", () => {
    const p = reviewPrompt({
      title: "ship it",
      spec: "spec here",
      acceptance: ["tests pass"],
      statSummary: "src/a.ts | +12 -3",
      handoffMd: "we chose X because Y",
      outPath: ".board/out/cd34.json",
    });
    expect(p).toContain("git diff --stat");
    expect(p).toContain("src/a.ts | +12 -3");
    expect(p).toContain("we chose X because Y");
    expect(p).toContain("- tests pass");
    expect(p).toContain(".board/out/cd34.json");
  });
});

describe("agent adapters", () => {
  it("ships claude as the only agent claiming a readable transcript", () => {
    expect(BUILTIN_ADAPTERS.claude).toEqual({
      kind: "claude",
      clear: "/clear",
      context: true,
      sessionId: true,
    });
    // Everything else is explicitly false rather than guessed — a confident wrong percentage is
    // worse than no gauge (see bridge/context.ts).
    for (const [kind, a] of Object.entries(BUILTIN_ADAPTERS)) {
      if (kind !== "claude") expect(a.context).toBe(false);
    }
  });

  it("assumes nothing about an agent nobody described", () => {
    const a = adapterFor(BUILTIN_ADAPTERS, "someagent");
    expect(a).toEqual({ kind: "someagent", clear: "", context: false, sessionId: false });
  });

  it("merges per FIELD, so overriding one line doesn't silently drop the rest", () => {
    const merged = mergeAdapters(BUILTIN_ADAPTERS, { agent: { claude: { clear: "/reset" } } });
    expect(merged.claude).toEqual({
      kind: "claude",
      clear: "/reset",
      context: true,
      sessionId: true,
    });
  });

  it("accepts a new agent the built-ins never heard of", () => {
    const merged = mergeAdapters(BUILTIN_ADAPTERS, {
      agent: { droid: { clear: "/new", session_id: true } },
    });
    expect(merged.droid).toEqual({ kind: "droid", clear: "/new", context: false, sessionId: true });
  });

  it("accepts either spelling of session_id", () => {
    expect(mergeAdapters({}, { agent: { x: { sessionId: true } } }).x!.sessionId).toBe(true);
    expect(mergeAdapters({}, { agent: { x: { session_id: true } } }).x!.sessionId).toBe(true);
  });

  it("ignores junk rather than corrupting the table", () => {
    expect(mergeAdapters(BUILTIN_ADAPTERS, null)).toEqual(BUILTIN_ADAPTERS);
    expect(mergeAdapters(BUILTIN_ADAPTERS, { agent: "nope" })).toEqual(BUILTIN_ADAPTERS);
    expect(mergeAdapters(BUILTIN_ADAPTERS, { agent: { claude: 3 } })).toEqual(BUILTIN_ADAPTERS);
    // A wrong-typed field falls back to the current value instead of poisoning it.
    expect(mergeAdapters(BUILTIN_ADAPTERS, { agent: { claude: { context: "yes" } } }).claude!.context).toBe(
      true,
    );
  });

  it("parses the shipped table without losing claude's capabilities", () => {
    const shipped = loadAdapters([new URL("../adapters/agents.toml", import.meta.url).pathname]);
    expect(shipped.claude).toEqual({ kind: "claude", clear: "/clear", context: true, sessionId: true });
    expect(shipped.codex!.context).toBe(false);
  });

  it("survives a missing file and a broken one", () => {
    expect(loadAdapters(["/nonexistent/agents.toml"])).toEqual(BUILTIN_ADAPTERS);
  });
});

describe("repo picker", () => {
  it("takes the last path segment as the display name", () => {
    expect(basename("/home/me/code/collie-board")).toBe("collie-board");
    expect(basename("/home/me/code/collie-board/")).toBe("collie-board");
    expect(basename("/")).toBe("/");
  });

  it("orders cards by most-recently-used, then the herd, then the scan", () => {
    const merged = mergeRepoChoices(
      [
        { path: "/r/old", lastUsedAt: 100 },
        { path: "/r/new", lastUsedAt: 900 },
      ],
      ["/r/open"],
      ["/r/found"],
    );
    expect(merged.map((r) => r.path)).toEqual(["/r/new", "/r/old", "/r/open", "/r/found"]);
    expect(merged.map((r) => r.source)).toEqual(["card", "card", "herd", "scan"]);
  });

  it("de-duplicates, and a carded repo stays 'card' even when it's also open", () => {
    const merged = mergeRepoChoices([{ path: "/r/a", lastUsedAt: 1 }], ["/r/a"], ["/r/a"]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.source).toBe("card");
  });

  it("resolves a repo root from a SUBDIRECTORY — a pane's cwd drifts as the agent works", async () => {
    const git: GitRunner = async (args, cwd) => {
      expect(cwd).toBe("/repo/src/deep");
      if (args.includes("--show-toplevel")) return { ok: true, stdout: "/repo\n", stderr: "" };
      return { ok: true, stdout: "/repo/.git\n", stderr: "" };
    };
    expect(await repoRootOf("/repo/src/deep", git)).toBe("/repo");
  });

  it("collapses a CARD'S WORKTREE onto its source repo, not a repo of its own", async () => {
    // Live-verified shape: a linked worktree reports its own toplevel but the SHARED git dir.
    const git: GitRunner = async (args) => {
      if (args.includes("--show-toplevel")) {
        return { ok: true, stdout: "/home/me/.herdr/worktrees/proj/board-x\n", stderr: "" };
      }
      return { ok: true, stdout: "/home/me/code/proj/.git\n", stderr: "" };
    };
    expect(await repoRootOf("/home/me/.herdr/worktrees/proj/board-x", git)).toBe("/home/me/code/proj");
  });

  it("falls back to the toplevel when the git dir isn't a plain <root>/.git", async () => {
    const git: GitRunner = async (args) => {
      if (args.includes("--show-toplevel")) return { ok: true, stdout: "/repo\n", stderr: "" };
      return { ok: true, stdout: "/elsewhere/gitdirs/repo\n", stderr: "" };
    };
    expect(await repoRootOf("/repo", git)).toBe("/repo");
  });

  it("returns null for a directory that isn't in a repo", async () => {
    const git: GitRunner = async () => ({ ok: false, stdout: "", stderr: "not a git repository" });
    expect(await repoRootOf("/tmp", git)).toBeNull();
  });

  it("prefers origin/HEAD for the default branch, not whatever is checked out", async () => {
    // The repo is ON a board branch — taking HEAD would fork the next card off the previous card's
    // work, silently chaining unrelated changes.
    const git: GitRunner = async (args) => {
      if (args[1] === "--short") return { ok: true, stdout: "origin/main\n", stderr: "" };
      return { ok: true, stdout: "board/previous-card\n", stderr: "" };
    };
    expect(await defaultBranchOf("/repo", git)).toBe("main");
  });

  it("falls back to main/master when there is no remote", async () => {
    const git: GitRunner = async (args) => {
      if (args[1] === "--short") return { ok: false, stdout: "", stderr: "no origin" };
      if (args[0] === "rev-parse" && args.includes("refs/heads/main")) {
        return { ok: true, stdout: "abc123\n", stderr: "" };
      }
      return { ok: false, stdout: "", stderr: "" };
    };
    expect(await defaultBranchOf("/repo", git)).toBe("main");
  });

  it("falls back to the current branch for a repo with no remote and no main/master", async () => {
    const git: GitRunner = async (args) => {
      if (args[1] === "--short") return { ok: false, stdout: "", stderr: "" };
      if (args.includes("--verify")) return { ok: false, stdout: "", stderr: "" };
      return { ok: true, stdout: "trunk\n", stderr: "" };
    };
    expect(await defaultBranchOf("/repo", git)).toBe("trunk");
  });

  it("reports no default branch for a detached HEAD rather than the literal 'HEAD'", async () => {
    const git: GitRunner = async (args) => {
      if (args[1] === "--short" || args.includes("--verify")) return { ok: false, stdout: "", stderr: "" };
      return { ok: true, stdout: "HEAD\n", stderr: "" };
    };
    expect(await defaultBranchOf("/repo", git)).toBeUndefined();
  });

  it("asks git ONCE per distinct cwd, not once per pane", async () => {
    const store = db();
    const seen: string[] = [];
    const git: GitRunner = async (args, cwd) => {
      if (args.includes("--show-toplevel")) {
        seen.push(cwd);
        return { ok: true, stdout: "/repo\n", stderr: "" };
      }
      if (args.includes("--git-common-dir")) return { ok: true, stdout: "/repo/.git\n", stderr: "" };
      return { ok: true, stdout: "main\n", stderr: "" };
    };
    // Four panes, one directory.
    const panes = ["w1:p1", "w1:p2", "w1:p3", "w1:p4"].map((id) => pane(id, "idle", { cwd: "/repo" }));
    const repos = await listRepos(store, snapshot(panes), [], git);

    expect(seen).toEqual(["/repo"]);
    expect(repos.map((r) => r.path)).toEqual(["/repo"]);
    expect(repos[0]!.defaultBranch).toBe("main");
  });

  it("surfaces a carded repo even when nothing is open in the herd", async () => {
    const store = db();
    store.createCard({ title: "x", repoPath: "/repo/carded" });
    const git: GitRunner = async () => ({ ok: false, stdout: "", stderr: "" });
    const repos = await listRepos(store, snapshot([]), [], git);
    expect(repos.map((r) => `${r.source}:${r.path}`)).toEqual(["card:/repo/carded"]);
  });
});

describe("scanRootsFor", () => {
  const exists = (p: string) => ["/home/me/git", "/home/me/code"].includes(p);

  it("falls back to the conventional roots that exist — this is the cold start", () => {
    expect(scanRootsFor([], "/home/me", exists)).toEqual(["/home/me/git", "/home/me/code"]);
  });

  it("REPLACES the defaults with the operator's roots rather than adding to them", () => {
    // Someone who names their roots has said where to look; also walking ~/code ignores them.
    expect(scanRootsFor(["/srv/repos"], "/home/me", exists)).toEqual(["/srv/repos"]);
  });

  it("returns nothing when no conventional root exists, instead of walking missing dirs", () => {
    expect(scanRootsFor([], "/home/me", () => false)).toEqual([]);
  });
});

describe("repo preferences", () => {
  it("stores a hidden repo and reports it back", () => {
    const store = db();
    expect(store.hiddenRepos().size).toBe(0);
    store.setRepoHidden("/repo/noisy", true);
    expect([...store.hiddenRepos()]).toEqual(["/repo/noisy"]);
  });

  it("un-hiding DELETES the row rather than storing 'visible' forever", () => {
    const store = db();
    store.setRepoHidden("/repo/a", true);
    store.setRepoHidden("/repo/a", false);
    expect(store.hiddenRepos().size).toBe(0);
    // The default IS visible, so a row saying so carries no information and must not accumulate.
    store.setRepoHidden("/repo/never-hidden", false);
    expect(store.hiddenRepos().size).toBe(0);
  });

  it("hiding twice is idempotent", () => {
    const store = db();
    store.setRepoHidden("/repo/a", true);
    store.setRepoHidden("/repo/a", true);
    expect([...store.hiddenRepos()]).toEqual(["/repo/a"]);
  });

  it("marks a hidden repo in the listing instead of dropping it — the route decides", async () => {
    const store = db();
    store.createCard({ title: "x", repoPath: "/repo/kept" });
    store.createCard({ title: "y", repoPath: "/repo/noisy" });
    store.setRepoHidden("/repo/noisy", true);
    const git: GitRunner = async () => ({ ok: true, stdout: "main\n", stderr: "" });
    const repos = await listRepos(store, snapshot([]), [], git);

    expect(repos.find((r) => r.path === "/repo/noisy")?.hidden).toBe(true);
    expect(repos.find((r) => r.path === "/repo/kept")?.hidden).toBeUndefined();
  });

  it("does not resolve a default branch for a hidden repo — it is never offered", async () => {
    const store = db();
    store.createCard({ title: "y", repoPath: "/repo/noisy" });
    store.setRepoHidden("/repo/noisy", true);
    let branchCalls = 0;
    const git: GitRunner = async (args) => {
      if (args[0] === "symbolic-ref") branchCalls++;
      return { ok: true, stdout: "main\n", stderr: "" };
    };
    await listRepos(store, snapshot([]), [], git);
    expect(branchCalls).toBe(0);
  });

  it("survives a hidden repo that no longer exists anywhere — the row is simply inert", async () => {
    const store = db();
    store.setRepoHidden("/repo/deleted-long-ago", true);
    const git: GitRunner = async () => ({ ok: false, stdout: "", stderr: "" });
    expect(await listRepos(store, snapshot([]), [], git)).toEqual([]);
  });
});

describe("promptAndConfirm — a prompt swallowed by a first-run modal", () => {
  /**
   * Claude Code's trust dialog is up, herdr reports `interactive_ready` anyway, and the prompt is
   * eaten whole: nothing typed, nothing runs, and its Enter answers the dialog. Live-verified.
   */
  function swallowingHerdr(promptsEaten: number) {
    const calls: string[] = [];
    let prompts = 0;
    let status: AgentStatus = "idle";
    return {
      calls,
      client: {
        async promptAgent() {
          calls.push("promptAgent");
          prompts++;
          // A prompt past the modal actually starts the agent.
          if (prompts > promptsEaten) status = "working";
        },
        async sendPaneKeys() {
          calls.push("sendPaneKeys"); // dismisses the dialog; the agent stays idle
        },
        async getAgent() {
          return { agent_status: status };
        },
      },
    };
  }

  it("re-sends once when the first prompt after a launch left the agent idle", async () => {
    const { client, calls } = swallowingHerdr(1);
    await promptAndConfirm(client as never, "w1:p1", "do the thing", async () => {}, {
      firstAfterLaunch: true,
    });
    expect(calls).toEqual(["promptAgent", "sendPaneKeys", "promptAgent"]);
  });

  it("does NOT re-send a follow-up prompt — the agent would do the work twice", async () => {
    const { client, calls } = swallowingHerdr(99);
    await promptAndConfirm(client as never, "w1:p1", "do the thing", async () => {});
    expect(calls).toEqual(["promptAgent", "sendPaneKeys"]);
  });

  it("stops at the first attempt when the prompt plainly landed", async () => {
    const { client, calls } = swallowingHerdr(0);
    await promptAndConfirm(client as never, "w1:p1", "x", async () => {}, { firstAfterLaunch: true });
    expect(calls).toEqual(["promptAgent"]);
  });

  it("stops after the Enter nudge when that was enough (the unsubmitted paste)", async () => {
    const calls: string[] = [];
    let status: AgentStatus = "idle";
    const client = {
      async promptAgent() {
        calls.push("promptAgent");
      },
      async sendPaneKeys() {
        calls.push("sendPaneKeys");
        status = "working"; // the draft was submitted
      },
      async getAgent() {
        return { agent_status: status };
      },
    };
    await promptAndConfirm(client as never, "w1:p1", "x", async () => {}, { firstAfterLaunch: true });
    expect(calls).toEqual(["promptAgent", "sendPaneKeys"]);
  });
});

describe("Copilot.ensurePane — adoption", () => {
  // A real (empty, throwaway) directory: ensurePane mkdirs its work dir before anything else.
  const WD = mkdtempSync(join(tmpdir(), "copilot-test-"));

  function copilotWith(snap: EngineSnapshot, fail: Set<string> = new Set()) {
    const calls: string[] = [];
    const herdr = {
      async createWorkspace() {
        calls.push("createWorkspace");
        if (fail.has("createWorkspace")) throw new Error("nope");
        return { paneId: "wNEW:p1", workspaceId: "wNEW", tabId: "wNEW:t1", cwd: WD };
      },
      async startAgent() {
        calls.push("startAgent");
        if (fail.has("startAgent")) throw new Error("herdr agent.start: agent_name_taken: …");
      },
      async getAgent() {
        return { interactive_ready: true, agent_status: "working" as AgentStatus };
      },
      async promptAgent() {
        calls.push("promptAgent");
      },
      async sendPaneKeys() {
        calls.push("sendPaneKeys");
      },
    };
    const cfg = { boardCopilot: true, boardAgentKind: "claude", boardCopilotKind: "" } as Config;
    // Tiny deadline: these tests are about which panes get adopted, not about waiting for an answer
    // file the fake agent never writes.
    return {
      calls,
      copilot: new Copilot(herdr as never, cfg, WD, () => snap, {}, { timeoutMs: 30, pollMs: 10 }),
    };
  }

  it("adopts an agent already running in its directory — a restart must not build a second one", async () => {
    // Herdr agent names are globally unique, so a second `board` agent fails outright; and the
    // attempt leaves an orphan workspace behind first.
    const { calls, copilot } = copilotWith(snapshot([pane("wOLD:p1", "idle", { cwd: WD })]));
    await copilot.ask(() => "hi");
    expect(calls).not.toContain("createWorkspace");
    expect(calls).not.toContain("startAgent");
    expect(calls).toContain("promptAgent");
  });

  it("relaunches into a leftover SHELL in its directory rather than stacking a workspace", async () => {
    const snap: EngineSnapshot = {
      agents: [],
      shellPanes: [pane("wOLD:p1", "unknown", { cwd: WD, kind: "shell" })],
      workspaces: [],
      tabs: [],
      bridge: "connected",
    };
    const { calls, copilot } = copilotWith(snap);
    await copilot.ask(() => "hi");
    expect(calls).not.toContain("createWorkspace");
    expect(calls[0]).toBe("startAgent");
  });

  it("creates a workspace only when nothing of ours is in the herd", async () => {
    const { calls, copilot } = copilotWith(snapshot([pane("wX:p1", "idle", { cwd: "/somewhere/else" })]));
    await copilot.ask(() => "hi");
    expect(calls[0]).toBe("createWorkspace");
    expect(calls[1]).toBe("startAgent");
  });

  it("returns null and drops the pane when the launch fails, so the next request retries", async () => {
    const { copilot } = copilotWith(snapshot([]), new Set(["startAgent"]));
    expect(await copilot.ask(() => "hi")).toBeNull();
  });
});
