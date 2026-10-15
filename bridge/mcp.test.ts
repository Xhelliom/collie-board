import { describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gitFreeEnv } from "../scripts/test-env.ts";
import { handleBoardRoute } from "./board-routes.ts";
import { BoardDb } from "./db.ts";
import { createMcp, type McpEnv } from "./mcp.ts";

// A fake bridge: records every request, answers from a route table.
type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };
function setup(env: McpEnv, routes: Record<string, { status?: number; body?: unknown; text?: string }> = {}) {
  const calls: Call[] = [];
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    const h: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (h[k] = v));
    const u = new URL(url);
    calls.push({ method: init?.method ?? "GET", url: u.pathname + u.search, headers: h, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = routes[`${init?.method ?? "GET"} ${u.pathname}`] ?? { body: {} };
    const status = r.status ?? 200;
    return new Response(r.text ?? JSON.stringify(r.body ?? {}), { status });
  }) as unknown as typeof fetch;
  const mcp = createMcp(env, fakeFetch);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })) as {
      result: { content: { text: string }[]; isError?: boolean };
    };
    return { text: res.result.content[0]!.text, isError: res.result.isError === true };
  };
  return { calls, call, mcp };
}

describe("mcp: protocol", () => {
  it("initialize + tools/list; actions are not read-only", async () => {
    const { mcp } = setup({});
    const init = (await mcp.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })) as { result: { capabilities: { tools: unknown } } };
    expect(init.result.capabilities.tools).toBeDefined();
    expect(await mcp.handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    const list = (await mcp.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" })) as {
      result: { tools: { name: string; description: string; annotations: { readOnlyHint: boolean; destructiveHint?: boolean } }[] };
    };
    const tools = Object.fromEntries(list.result.tools.map((t) => [t.name, t]));
    for (const n of ["list_projects", "project_status", "get_card", "whats_blocking", "recent_notifications"]) expect(tools[n]!.annotations.readOnlyHint).toBe(true);
    for (const n of ["reply_to_agent", "create_card", "launch_lot", "notify", "finish_card"]) expect(tools[n]!.annotations.readOnlyHint).toBe(false);
    for (const n of ["launch_lot", "finish_card"]) expect(tools[n]!.annotations.destructiveHint).toBe(true);
    for (const t of Object.values(tools)) expect(t.description.length).toBeGreaterThan(10);
  });
});

describe("mcp: the pane header (an agent stays an agent)", () => {
  it("relays HERDR_PANE_ID as x-collie-pane on every call", async () => {
    const { calls, call } = setup({ HERDR_PANE_ID: "w1:p2" }, { "GET /api/repos": { body: { repos: [] } } });
    await call("list_projects");
    await call("launch_lot", { runId: "r1" });
    expect(calls.length).toBe(2);
    for (const c of calls) expect(c.headers["x-collie-pane"]).toBe("w1:p2");
  });
  it("sends none without HERDR_PANE_ID: the operator's call", async () => {
    const { calls, call } = setup({});
    await call("launch_lot", { runId: "r1" });
    expect(calls[0]!.headers["x-collie-pane"]).toBeUndefined();
  });
  it("a launch refused for an agent pane says so in one sentence", async () => {
    const { call } = setup({ HERDR_PANE_ID: "w1:p2" }, { "POST /api/runs/r1/launch": { status: 403, text: "launching is the operator's gesture" } });
    const r = await call("launch_lot", { runId: "r1" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/réservé à l'opérateur/);
    expect(r.text.split("\n").length).toBe(1);
  });
});

describe("mcp: configuration", () => {
  it("defaults to loopback 8788, honours COLLIE_BOARD_PORT and COLLIE_BOARD_URL", async () => {
    const a = setup({});
    await a.call("list_projects");
    const urls: string[] = [];
    const m = createMcp({ COLLIE_BOARD_PORT: "9001" }, (async (u: string) => (urls.push(u), new Response("{}"))) as unknown as typeof fetch);
    await m.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_projects", arguments: {} } });
    expect(urls[0]).toBe("http://127.0.0.1:9001/api/repos");
    const urls2: string[] = [];
    const m2 = createMcp({ COLLIE_BOARD_URL: "http://127.0.0.1:1234/" }, (async (u: string) => (urls2.push(u), new Response("{}"))) as unknown as typeof fetch);
    await m2.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_projects", arguments: {} } });
    expect(urls2[0]).toBe("http://127.0.0.1:1234/api/repos");
  });
  it("sends the device header when configured", async () => {
    const { calls, call } = setup({ COLLIE_BOARD_DEVICE_HEADER: "x-device", COLLIE_BOARD_DEVICE: "laptop" });
    await call("list_projects");
    expect(calls[0]!.headers["x-device"]).toBe("laptop");
  });
});

describe("mcp: errors", () => {
  it("403 and 409 become one readable sentence, 404 too; a down bridge as well", async () => {
    const { call } = setup({}, {
      "POST /api/pane/p1/reply": { status: 403, text: "device is read-only" },
      "POST /api/runs/r1/launch": { status: 409, text: "already launched" },
      "GET /api/cards/zz": { status: 404, text: "not found" },
    });
    expect((await call("reply_to_agent", { paneId: "p1", text: "oui" })).text).toMatch(/refusé/);
    expect((await call("launch_lot", { runId: "r1" })).text).toMatch(/déjà|conflit/i);
    expect((await call("get_card", { cardId: "zz" })).isError).toBe(true);
    const down = createMcp({}, (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch);
    const res = (await down.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_projects", arguments: {} } })) as { result: { isError: boolean; content: { text: string }[] } };
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0]!.text).toMatch(/injoignable/);
  });
});

describe("mcp: tools", () => {
  it("whats_blocking: blocked agents with their recent pane output, compact", async () => {
    const { call, calls } = setup({}, {
      "GET /api/snapshot": { body: { bridge: "connected", agents: [
        { paneId: "w:p1", status: "blocked", workspaceLabel: "Loquivox", cwd: "/r" },
        { paneId: "w:p2", status: "working", workspaceLabel: "Autre", cwd: "/s" },
      ] } },
      "GET /api/pane/w%3Ap1": { body: { paneId: "w:p1", text: "\u001b[1mVeux-tu continuer ?\u001b[0m\r\n(oui/non)\r\n" } },
    });
    const r = await call("whats_blocking");
    expect(r.text).toContain("w:p1");
    expect(r.text).toContain("Veux-tu continuer ?");
    expect(r.text).not.toContain("\u001b");
    expect(r.text).not.toContain("w:p2");
    expect(calls.some((c) => c.url.includes("w:p2"))).toBe(false);
  });
  it("whats_blocking does not claim 'nothing blocks' when herdr is disconnected", async () => {
    const { call } = setup({}, { "GET /api/snapshot": { body: { bridge: "disconnected", agents: [] } } });
    const r = await call("whats_blocking");
    expect(r.text).toMatch(/coupé/);
    expect(r.text).not.toMatch(/rien ne bloque/i);
  });
  it("whats_blocking says so when nothing waits", async () => {
    const { call } = setup({}, { "GET /api/snapshot": { body: { agents: [] } } });
    expect((await call("whats_blocking")).text).toMatch(/rien/i);
  });
  it("project_status: phases, lots, active cards, open PRs, blocked + reason; no spec", async () => {
    const { call } = setup({}, {
      "GET /api/phases": { body: { phases: [{ id: "ph1", name: "Phase A", closedAt: null }] } },
      "GET /api/runs": { body: { runs: [{ id: "r1", name: "Lot 1", phaseId: "ph1", launchedAt: null, cardIds: ["c1"] }] } },
      "GET /api/cards": { body: { cards: [
        { id: "c1", title: "Carte un", status: "working", repoPath: "/r", phaseId: "ph1", specLine: "SECRET-SPEC" },
        { id: "c2", title: "Carte deux", status: "blocked", repoPath: "/r", phaseId: "ph1" },
        { id: "c3", title: "Autre dépôt", status: "working", repoPath: "/z" },
      ] } },
      "GET /api/board/prs": { body: { prs: [{ card: { id: "c1", title: "Carte un", repoPath: "/r" }, url: "https://x/pull/1" }] } },
      "GET /api/project/facts": { body: { facts: [{ cardId: "c2", lead: { decision: "prompt", reason: "tests rouges" }, gate: null, pr: null }] } },
    });
    const r = await call("project_status", { repoPath: "/r" });
    expect(r.text).toContain("Phase A");
    expect(r.text).toContain("Lot 1");
    expect(r.text).toContain("Carte un");
    expect(r.text).toContain("tests rouges");
    expect(r.text).toContain("pull/1");
    expect(r.text).not.toContain("Autre dépôt");
    expect(r.text).not.toContain("SECRET-SPEC");
  });
  it("get_card: spec and a short journal, not the whole card", async () => {
    const events = Array.from({ length: 30 }, (_, i) => 29 - i).map((i) => ({ id: i, type: "card.status", payload: { to: `etape${i}x` }, ts: i })); // récent d'abord, comme db.listEvents
    const { call } = setup({}, { "GET /api/cards/c1": { body: { card: { id: "c1", title: "T", status: "review", spec: "Faire X.", acceptance: ["a", "b"], rawInput: "RAW" }, events } } });
    const r = await call("get_card", { cardId: "c1" });
    expect(r.text).toContain("Faire X.");
    expect(r.text).not.toContain("RAW");
    expect(r.text).toContain("etape29x");
    expect(r.text).not.toContain("etape0x");
    expect(r.text.split("\n").length).toBeLessThan(25);
  });
  it("recent_notifications: last entries only", async () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({ id: i, ts: i, status: "done", subtitle: `s${i}`, cardTitle: `t${i}` }));
    const { call } = setup({}, { "GET /api/notifications/log": { body: { entries } } });
    const r = await call("recent_notifications", { limit: 3 });
    expect(r.text.split("\n").length).toBe(3);
  });
  it("create_card posts title, spec, repoPath, phaseId — and nothing claiming provenance", async () => {
    const { call, calls } = setup({}, { "POST /api/cards": { body: { card: { id: "n1", title: "T" } } } });
    const r = await call("create_card", { repoPath: "/r", title: "T", spec: "S", phaseId: "ph1" });
    expect(calls[0]!.body).toEqual({ repoPath: "/r", title: "T", spec: "S", phaseId: "ph1" });
    expect(r.text).toContain("n1");
  });
  it("reply_to_agent posts text to the pane; notify posts message", async () => {
    const { call, calls } = setup({ HERDR_PANE_ID: "w:p9" });
    await call("reply_to_agent", { paneId: "w:p1", text: "oui" });
    expect(calls[0]!.url).toBe("/api/pane/w%3Ap1/reply");
    expect(calls[0]!.body).toEqual({ text: "oui" });
    await call("notify", { message: "salut" });
    expect(calls[1]!.url).toBe("/api/board/notify");
    expect(calls[1]!.body).toEqual({ message: "salut" });
  });
  it("launch_lot without a runId launches the repo's next planned lot, by position", async () => {
    const { call, calls } = setup({}, {
      "GET /api/runs": { body: { runs: [
        { id: "old", position: 0, launchedAt: 5, repoPath: "/r" },
        { id: "b", position: 2, launchedAt: null, repoPath: "/r" },
        { id: "a", position: 1, launchedAt: null, repoPath: "/r" },
      ] } },
    });
    await call("launch_lot", { repoPath: "/r" });
    expect(calls.at(-1)!.url).toBe("/api/runs/a/launch");
  });
});

describe("mcp: finish_card — the card screen's buttons, by the same request", () => {
  const card = (status = "review") => ({ "GET /api/cards/c1": { body: { card: { id: "c1", title: "Ma carte", status } } } });
  it("pr (default) and merge post the button's body; done is the « Classer → Terminé » PATCH", async () => {
    const { call, calls } = setup({}, { ...card(), "POST /api/cards/c1/integration": { body: { ok: true, url: "https://x/pull/7", base: "main" } } });
    expect((await call("finish_card", { cardId: "c1" })).text).toMatch(/PR ouverte et suivie.*pull\/7.*fusionnée/);
    expect(calls[1]!.body).toEqual({ action: "pr", andDone: true });
    expect((await call("finish_card", { card_id: "c1", mode: "merge" })).text).toMatch(/fusionnée dans main et classée terminée/);
    expect(calls[3]!.body).toEqual({ action: "merge", andDone: true });
    await call("finish_card", { cardId: "c1", mode: "done" });
    expect(calls[5]).toMatchObject({ method: "PATCH", url: "/api/cards/c1", body: { status: "done" } });
  });
  it("a card already filed gets the integration alone, like the buttons' `filing`", async () => {
    const { call, calls } = setup({}, { ...card("done"), "POST /api/cards/c1/integration": { body: { ok: true, base: "main" } } });
    expect((await call("finish_card", { cardId: "c1", mode: "merge" })).text).not.toMatch(/classée/);
    expect(calls[1]!.body).toEqual({ action: "merge", andDone: false });
  });
  it("every refusal is one plain sentence, never a JSON body or a throw", async () => {
    for (const [kind, status, re] of [
      ["in-progress", 409, /déjà en cours/],
      ["conflict", 409, /Conflit de fusion.*rien n'a été modifié/],
      ["refused", 409, /Refusé.*no branch/],
      ["git", 502, /Échec \(git\)/],
    ] as const) {
      const { call } = setup({}, { ...card(), "POST /api/cards/c1/integration": { status, body: { ok: false, error: "this card has no branch", kind } } });
      const r = await call("finish_card", { cardId: "c1", mode: "merge" });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(re);
      expect(r.text).not.toContain("{");
    }
    const { call } = setup({});
    expect((await call("finish_card", { cardId: "c1", mode: "squash" })).text).toMatch(/Mode inconnu/);
  });
});

// The real route, real git: the acceptance criteria are about what the BRIDGE does with the request.
describe("mcp: finish_card end to end, against the bridge's own route", () => {
  function git(cwd: string, ...args: string[]): string {
    const r = Bun.spawnSync(["git", ...args], { cwd, env: gitFreeEnv });
    if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
    return r.stdout.toString().trim();
  }
  function world() {
    const root = mkdtempSync(join(tmpdir(), "collie-mcp-"));
    const repo = join(root, "repo");
    git(root, "init", "-q", "-b", "main", repo);
    for (const [k, v] of [["user.name", "t"], ["user.email", "t@t"], ["commit.gpgsign", "false"]]) git(repo, "config", k!, v!);
    writeFileSync(join(repo, "README"), "x\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "init");
    git(root, "clone", "-q", "--bare", repo, join(root, "origin.git"));
    git(repo, "remote", "add", "origin", join(root, "origin.git"));
    git(repo, "fetch", "-q", "origin");
    git(repo, "checkout", "-q", "-b", "board/x");
    writeFileSync(join(repo, "x.ts"), "export {};\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "x");
    git(repo, "checkout", "-q", "main");
    const store = new BoardDb(":memory:");
    const c = store.createCard({ title: "x", repoPath: repo, baseRef: "main", status: "review" });
    store.patchCard(c.id, { branch: "board/x" });
    const ctx = {
      db: store, herdr: {}, engine: { current: () => ({ bridge: "connected", agents: [] }) },
      copilot: { busy: () => new Set<string>(), reformulate: () => {} }, cfg: {}, audit: { record: () => {} },
      session: "default", guard: () => null, device: null,
      json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
      text: (body: string, status: number) => new Response(body, { status }),
    } as never;
    const bridge = (async (url: string, init?: RequestInit) =>
      (await handleBoardRoute(new URL(url).pathname, new Request(url, init), ctx)) ?? new Response("no route", { status: 404 })) as unknown as typeof fetch;
    return { root, repo, store, id: c.id, mcp: createMcp({}, bridge) };
  }
  const call = async (mcp: ReturnType<typeof createMcp>, args: Record<string, unknown>) =>
    ((await mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "finish_card", arguments: args } })) as {
      result: { content: { text: string }[]; isError?: boolean };
    }).result;

  it("merge lands the branch in main and files the card, as « Merge et terminé »", async () => {
    const { repo, store, id, mcp } = world();
    const r = await call(mcp, { cardId: id, mode: "merge" });
    expect(r.content[0]!.text).toMatch(/fusionnée dans main et classée terminée/);
    expect(git(repo, "ls-tree", "--name-only", "main")).toContain("x.ts");
    expect(store.getCard(id)!.status).toBe("done");
  });

  it("pr opens the PR and journals card.pr_follow, without filing the card", async () => {
    const { root, store, id, mcp } = world();
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "gh"), "#!/bin/sh\necho https://github.com/o/r/pull/1\n");
    chmodSync(join(bin, "gh"), 0o755);
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    try {
      const r = await call(mcp, { cardId: id });
      expect(r.content[0]!.text).toMatch(/PR ouverte et suivie.*pull\/1/);
    } finally {
      process.env.PATH = path;
    }
    expect(store.listEvents(id).some((e) => e.type === "card.pr_follow")).toBe(true);
    expect(store.getCard(id)!.status).toBe("review");
  });

  it("a merge conflict is refused in plain words, the card left as it was", async () => {
    const { repo, store, id, mcp } = world();
    writeFileSync(join(repo, "x.ts"), "clash\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "clash on main");
    const r = await call(mcp, { cardId: id, mode: "merge" });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/^Conflit de fusion/);
    expect(store.getCard(id)!.status).toBe("review");
  });
});
