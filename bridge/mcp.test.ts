import { describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gitFreeEnv } from "../scripts/test-env.ts";
import { handleBoardRoute } from "./board-routes.ts";
import { BoardDb } from "./db.ts";
import { createMcp, type McpEnv } from "./mcp.ts";
import { createTools, invalidArgs } from "../web/src/lib/board-tools.ts";

// A fake bridge: records every request, answers from a route table.
type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };
function setup(env: McpEnv, routes: Record<string, { status?: number; body?: unknown; text?: string }> = {}) {
  const calls: Call[] = [];
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    const h: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (h[k] = v));
    const u = new URL(url);
    calls.push({ method: init?.method ?? "GET", url: u.pathname + u.search, headers: h, body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body });
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
    const { mcp } = setup({ HERDR_PANE_ID: "w:p1" });
    const init = (await mcp.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })) as { result: { capabilities: { tools: unknown } } };
    expect(init.result.capabilities.tools).toBeDefined();
    expect(await mcp.handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    const list = (await mcp.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" })) as {
      result: { tools: { name: string; description: string; annotations: { readOnlyHint: boolean; destructiveHint?: boolean } }[] };
    };
    const tools = Object.fromEntries(list.result.tools.map((t) => [t.name, t]));
    for (const n of ["list_projects", "project_status", "get_card", "whats_blocking", "recent_notifications", "list_deliverables", "read_deliverable"]) expect(tools[n]!.annotations.readOnlyHint).toBe(true);
    for (const n of ["reply_to_agent", "create_card", "launch_lot", "notify", "finish_card", "message_orchestrator", "publish_file"]) expect(tools[n]!.annotations.readOnlyHint).toBe(false);
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

describe("mcp: message_orchestrator + notify", () => {
  it("types « [vocal] texte » in the live orchestrator's pane", async () => {
    const { call, calls } = setup({}, { "GET /api/orchestrator": { body: { paneId: "w:p7", running: true } } });
    const r = await call("message_orchestrator", { repoPath: "/r/", text: "fais X" });
    expect(r.isError).toBe(false);
    expect(calls[0]!.url).toBe("/api/orchestrator?repo=%2Fr");
    expect(calls[1]!.url).toBe("/api/pane/w%3Ap7/reply");
    expect(calls[1]!.body).toEqual({ text: "[vocal] fais X" });
  });
  it("refuses clearly and starts nothing when no orchestrator lives", async () => {
    const { call, calls } = setup({}, { "GET /api/orchestrator": { body: { paneId: null, running: false } } });
    const r = await call("message_orchestrator", { repoPath: "/r", text: "x" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/aucun orchestrateur/i);
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });
  it("notify is offered only to a client with a pane", async () => {
    const names = async (env: McpEnv) => {
      const l = (await setup(env).mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" })) as { result: { tools: { name: string }[] } };
      return l.result.tools.map((t) => t.name);
    };
    expect(await names({})).not.toContain("notify");
    expect(await names({ HERDR_PANE_ID: "w:p1" })).toContain("notify");
    const r = (await setup({}).mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "notify", arguments: { message: "x" } } })) as { error?: unknown };
    expect(r.error).toBeDefined();
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
    expect((await call("finish_card", { card_id: "c1", mode: "merge" })).text).toMatch(/fusionnée dans main par sa PR .*pull\/7 et classée terminée/);
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

// The real deliverables route: what reaches the store is what the agent's file holds.
describe("mcp: deliverables end to end, against the bridge's own route", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  function world(env: McpEnv = { HERDR_PANE_ID: "w:p9" }) {
    const root = mkdtempSync(join(tmpdir(), "collie-mcp-deliv-"));
    const store = new BoardDb(":memory:");
    const card = store.createCard({ title: "Rendu", repoPath: "/r/game" });
    const other = store.createCard({ title: "Autre", repoPath: "/r/else" });
    const ctx = {
      db: store, engine: { current: () => ({ bridge: "connected", agents: [], shellPanes: [] }) }, copilot: { busy: () => new Set<string>() },
      cfg: { stateDir: root }, audit: { record: () => {} }, session: "default", guard: () => null, device: null,
      json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
      text: (body: string, status: number) => new Response(body, { status }),
    } as never;
    // /api/snapshot is server.ts's, not the board handler's: the one line of it publish_file reads.
    const bridge = (async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      if (path === "/api/snapshot") return Response.json({ bridge: "connected", agents: [{ paneId: "w:p9", cardId: card.id }] });
      return (await handleBoardRoute(path, new Request(url, init), ctx)) ?? new Response("no route", { status: 404 });
    }) as unknown as typeof fetch;
    const mcp = createMcp(env, bridge);
    const call = async (name: string, args: Record<string, unknown>) =>
      ((await mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })) as {
        result: { content: { type: string; text?: string; data?: string; mimeType?: string }[]; isError?: boolean };
      }).result;
    return { root, store, card, other, call };
  }

  it("publish_file sends the file's bytes to the pane's own card, with no card id, marked agent", async () => {
    const { root, store, card, call } = world();
    writeFileSync(join(root, "chart.png"), PNG);
    const r = await call("publish_file", { path: join(root, "chart.png") });
    expect(r.isError).toBeUndefined();
    expect(r.content[0]!.text).toContain("chart.png");
    const ev = store.listEvents(card.id).find((e) => e.type === "deliverable.published")!;
    expect(ev.payload).toMatchObject({ name: "chart.png", size: PNG.length, by: "agent", pane: "w:p9" });
  });

  it("publish_file refuses clearly: no pane and no cardId, a missing file", async () => {
    const { root, call } = world({});
    expect((await call("publish_file", { path: join(root, "x.png") })).content[0]!.text).toMatch(/cardId/);
    const w = world();
    const r = await w.call("publish_file", { path: join(w.root, "nope.png") });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/introuvable/);
  });

  it("list_deliverables by project, read_deliverable shows an image as an image and Markdown as text", async () => {
    const { root, card, call } = world();
    writeFileSync(join(root, "chart.png"), PNG);
    writeFileSync(join(root, "report.md"), "# Bilan\nok");
    writeFileSync(join(root, "data.xlsx"), "PK");
    for (const f of ["chart.png", "report.md", "data.xlsx"]) await call("publish_file", { path: join(root, f) });
    const list = (await call("list_deliverables", { repoPath: "/r/game/" })).content[0]!.text!;
    expect(list.split("\n").length).toBe(3);
    expect(list).toContain("« Rendu »");
    expect((await call("list_deliverables", { repoPath: "/r/else" })).content[0]!.text).toBe("Aucun livrable publié.");
    const img = (await call("read_deliverable", { cardId: card.id, name: "chart.png" })).content[0]!;
    expect(img).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(Buffer.from(img.data!, "base64")).toEqual(Buffer.from(PNG));
    expect((await call("read_deliverable", { cardId: card.id, name: "report.md" })).content[0]!.text).toBe("# Bilan\nok");
    const meta = (await call("read_deliverable", { cardId: card.id, name: "data.xlsx" })).content[0]!.text!;
    expect(meta).toMatch(/^data\.xlsx — application\/octet-stream.*un agent/);
    expect((await call("read_deliverable", { cardId: card.id, name: "gone.png" })).isError).toBe(true);
  });
});

describe("mcp: the catalog is the buttons' catalog (ADR 0042)", () => {
  it("tools/list is createTools, schemas included", async () => {
    const { mcp } = setup({ HERDR_PANE_ID: "w:p1" });
    const list = (await mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" })) as { result: { tools: { name: string; inputSchema: { properties: unknown } }[] } };
    const catalog = createTools(async () => ({}));
    // Plus the two that read bytes, which a browser button cannot (they live in mcp.ts only).
    expect(list.result.tools.map((t) => t.name)).toEqual([...catalog.map((t) => t.name), "publish_file", "read_deliverable"]);
    for (const t of catalog) expect(list.result.tools.find((x) => x.name === t.name)!.inputSchema.properties).toEqual(t.props);
    // Typing into another agent's pane is never a button.
    expect(catalog.filter((t) => t.button === false).map((t) => t.name)).toEqual(["reply_to_agent", "notify"]);
  });
  it("invalidArgs checks required, unknown keys, types and enums", () => {
    const fin = createTools(async () => ({})).find((t) => t.name === "finish_card")!;
    expect(invalidArgs(fin, { cardId: "c", mode: "merge" })).toBeNull();
    expect(invalidArgs(fin, { mode: "merge" })).toContain("cardId");
    expect(invalidArgs(fin, { cardId: "c", mode: "yolo" })).toContain("mode");
    expect(invalidArgs(fin, { cardId: 3 })).toContain("string");
    expect(invalidArgs(fin, { cardId: "c", rm: true })).toContain("rm");
    expect(invalidArgs(fin, [])).not.toBeNull();
  });
});
