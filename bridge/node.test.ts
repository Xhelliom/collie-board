import { describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { digest, handleNodeRoute, loadNodeConfig, parseLaunch, parseNodeConfig, peerFor, type LaunchedPane, type LaunchRequest, type NodeConfig, type NodeRouteDeps } from "./node.ts";

const TOKEN_A = "a".repeat(40);
const TOKEN_B = "b".repeat(40);
const ENV_PATH = join(tmpdir(), "app");
const sha = (t: string) => digest(t).toString("hex");

const valid = {
  name: "arch-2",
  peers: [
    { name: "arch-1", token: TOKEN_A },
    { name: "win-cad", token: TOKEN_B },
  ],
  environments: [{ name: "arch-2", repo_path: ENV_PATH, agent: "claude" }],
};

describe("parseNodeConfig", () => {
  it("reads name, peers and environments", () => {
    expect(parseNodeConfig(valid)).toEqual({
      name: "arch-2",
      peers: [
        { name: "arch-1", sha256: sha(TOKEN_A) },
        { name: "win-cad", sha256: sha(TOKEN_B) },
      ],
      environments: [{ name: "arch-2", repoPath: ENV_PATH, agent: "claude" }],
    });
  });

  it("reads the hashed form the UI writes, with its login, date and launch grants", () => {
    const peer = { name: "arch-1", token_sha256: sha(TOKEN_A).toUpperCase(), login: "me@github", paired_at: "2026-10-26T10:00:00Z", launch: [] };
    expect(parseNodeConfig({ name: "arch-2", peers: [peer] })?.peers).toEqual([
      { name: "arch-1", sha256: sha(TOKEN_A), login: "me@github", pairedAt: "2026-10-26T10:00:00Z", launch: [] },
    ]);
  });

  it("is null without a peer: nothing to open", () => {
    expect(parseNodeConfig({ name: "arch-2" })).toBeNull();
    expect(parseNodeConfig({ name: "arch-2", peers: [] })).toBeNull();
  });

  it("refuses anything malformed rather than guess", () => {
    expect(() => parseNodeConfig({ peers: valid.peers })).toThrow("name");
    expect(() => parseNodeConfig({ ...valid, peers: [{ name: "x", token: "short" }] })).toThrow("shorter");
    expect(() => parseNodeConfig({ ...valid, peers: [{ token: TOKEN_A }] })).toThrow("peers[0].name");
    expect(() => parseNodeConfig({ ...valid, peers: [valid.peers[0], { name: "y", token: TOKEN_A }] })).toThrow("share a token");
    expect(() => parseNodeConfig({ ...valid, peers: [valid.peers[0], { name: "arch-1", token: TOKEN_B }] })).toThrow("share a name");
    expect(() => parseNodeConfig({ ...valid, peers: [{ name: "x", token_sha256: "abc" }] })).toThrow("SHA-256");
    expect(() => parseNodeConfig({ ...valid, peers: [{ name: "x", token: TOKEN_A, launch: "all" }] })).toThrow("launch");
    expect(() => parseNodeConfig({ ...valid, peers: { name: "x" } })).toThrow("array");
    expect(() => parseNodeConfig({ ...valid, environments: [{ name: "e", repo_path: "rel/path", agent: "claude" }] })).toThrow("absolute");
    expect(() => parseNodeConfig({ ...valid, environments: [{ name: "e", repo_path: ENV_PATH }] })).toThrow("agent");
    expect(() =>
      parseNodeConfig({ ...valid, environments: [valid.environments[0], valid.environments[0]] }),
    ).toThrow("share a name");
  });
});

describe("loadNodeConfig", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "collie-node-"));
  const toml = `name = "arch-2"\n[[peers]]\nname = "arch-1"\ntoken = "${TOKEN_A}"\n`;

  it("is null when there is no node.toml", () => {
    expect(loadNodeConfig(dir())).toBeNull();
  });

  it("is null on a syntax error", () => {
    const d = dir();
    writeFileSync(join(d, "node.toml"), "name = ", { mode: 0o600 });
    expect(loadNodeConfig(d)).toBeNull();
  });

  it("reads a 0600 file", () => {
    const d = dir();
    writeFileSync(join(d, "node.toml"), toml, { mode: 0o600 });
    expect(loadNodeConfig(d)?.peers).toEqual([{ name: "arch-1", sha256: sha(TOKEN_A) }]);
  });

  it.skipIf(process.platform === "win32")("refuses a file others can read", () => {
    const d = dir();
    writeFileSync(join(d, "node.toml"), toml);
    chmodSync(join(d, "node.toml"), 0o644);
    expect(loadNodeConfig(d)).toBeNull();
  });
});

describe("peerFor", () => {
  const peers = parseNodeConfig(valid)!.peers;
  it("names the peer whose token is presented", () => {
    expect(peerFor(`Bearer ${TOKEN_B}`, peers)).toBe("win-cad");
    expect(peerFor(`bearer ${TOKEN_A}`, peers)).toBe("arch-1");
  });

  it("is null for a missing, malformed or unknown token", () => {
    expect(peerFor(null, peers)).toBeNull();
    expect(peerFor("", peers)).toBeNull();
    expect(peerFor(TOKEN_A, peers)).toBeNull();
    expect(peerFor(`Basic ${TOKEN_A}`, peers)).toBeNull();
    expect(peerFor(`Bearer ${TOKEN_A}x`, peers)).toBeNull();
    expect(peerFor("Bearer ", [{ name: "empty", sha256: sha("") }])).toBeNull();
  });
});

describe("handleNodeRoute", () => {
  const node = parseNodeConfig(valid) as NodeConfig;
  const snap = { agents: [], shellPanes: [], workspaces: [], tabs: [], bridge: "disconnected" };

  function deps(over: Partial<NodeRouteDeps> = {}) {
    const audited: [string, string | null, Record<string, unknown>][] = [];
    const calls: unknown[][] = [];
    const d: NodeRouteDeps = {
      node,
      access: () => null,
      audit: (action, peer, detail) => audited.push([action, peer, detail]),
      snapshot: () => snap,
      readPane: async (id) => Response.json({ paneId: id }),
      text: (body, status) => new Response(body, { status }),
      json: (data, status) => Response.json(data, { status: status ?? 200 }),
      actions: {
        reply: async (...a) => (calls.push(["reply", ...a]), { ok: true, textDelivered: true }),
        keys: async (...a) => void calls.push(["keys", ...a]),
        close: async (...a) => void calls.push(["close", ...a]),
        diff: async (p, path) => ({ paneId: p.paneId, path }),
        launch: async (l: LaunchRequest) => {
          calls.push(["launch", l.env.repoPath, l.env.agent, l.prompt, l.branch]);
          return { paneId: "w9:p1", peer: l.peer, environment: l.env.name, branch: l.branch, checkoutPath: "/wt", base: "main" };
        },
      },
      autonomyOn: () => true,
      launched: new Map<string, LaunchedPane>(),
      ...over,
    };
    return { d, audited, calls };
  }
  const req = (path: string, token: string | null = TOKEN_A, method = "GET", body?: unknown) =>
    new Request(`http://peer${path}`, {
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const post = (path: string, body: unknown, d: NodeRouteDeps, token: string | null = TOKEN_A) => handleNodeRoute(path, req(path, token, "POST", body), d);
  const call = (path: string, d: NodeRouteDeps, r = req(path)) => handleNodeRoute(path, r, d);

  it("leaves every other path alone", async () => {
    expect(await call("/api/snapshot", deps().d)).toBeNull();
    expect(await call("/api/nodes", deps().d)).toBeNull();
  });

  it("is a 404 without a node config, even with a token", async () => {
    const { d, audited } = deps({ node: null });
    expect((await call("/api/node/snapshot", d))!.status).toBe(404);
    expect(audited).toEqual([]);
  });

  it("is a 401 without a valid token, and the refusal is audited", async () => {
    const { d, audited } = deps();
    expect((await call("/api/node/snapshot", d, req("/api/node/snapshot", null)))!.status).toBe(401);
    expect((await call("/api/node/snapshot", d, req("/api/node/snapshot", "z".repeat(40))))!.status).toBe(401);
    expect(audited).toEqual([
      ["node.denied", null, { route: "/api/node/snapshot" }],
      ["node.denied", null, { route: "/api/node/snapshot" }],
    ]);
  });

  it("refuses a token presented under another Tailscale login than the one seen at pairing", async () => {
    const bound = { ...node, peers: [{ ...node.peers[0]!, login: "me@github" }] };
    const { d } = deps({ node: bound });
    const as = (login?: string) =>
      new Request("http://peer/api/node/snapshot", { headers: { authorization: `Bearer ${TOKEN_A}`, ...(login ? { "tailscale-user-login": login } : {}) } });
    expect((await call("/api/node/snapshot", d, as("me@github")))!.status).toBe(200);
    expect((await call("/api/node/snapshot", d, as("eve@github")))!.status).toBe(401);
    expect((await call("/api/node/snapshot", d, as()))!.status).toBe(401);
  });

  it("keeps checkAccess in front of the token", async () => {
    const { d } = deps({ access: () => new Response("identity not trusted", { status: 403 }) });
    expect((await call("/api/node/snapshot", d))!.status).toBe(403);
  });

  it("serves the snapshot as is, disconnected included, and audits the peer", async () => {
    const { d, audited } = deps();
    const res = (await call("/api/node/snapshot", d))!;
    expect(await res.json()).toEqual(snap);
    expect(audited).toEqual([["node.read", "arch-1", { route: "/api/node/snapshot" }]]);
  });

  it("reads one pane", async () => {
    const res = (await call("/api/node/pane/w1%3Ap3", deps().d))!;
    expect(await res.json()).toEqual({ paneId: "w1:p3" });
  });

  it("lists the environments without their paths", async () => {
    const res = (await call("/api/node/environments", deps().d))!;
    expect(await res.json()).toEqual({ node: "arch-2", environments: [{ name: "arch-2", agent: "claude" }] });
  });

  it("keeps each verb to its routes and knows no other", async () => {
    expect((await call("/api/node/snapshot", deps().d, req("/api/node/snapshot", TOKEN_A, "POST")))!.status).toBe(405);
    expect((await call("/api/node/launch", deps().d))!.status).toBe(405);
    expect((await call("/api/node/nope", deps().d))!.status).toBe(404);
  });

  it("refuses every action without a token, before touching a pane", async () => {
    const { d, audited, calls } = deps();
    for (const r of ["reply", "keys", "launch", "end"]) expect((await post(`/api/node/${r}`, { paneId: "w1:p1" }, d, null))!.status).toBe(401);
    expect((await call("/api/node/diff?pane=w1:p1", d, req("/api/node/diff?pane=w1:p1", null)))!.status).toBe(401);
    expect(calls).toEqual([]);
    expect(audited.every(([a, p]) => a === "node.denied" && p === null)).toBe(true);
  });

  it("replies and sends keys to a local pane, tracing the peer", async () => {
    const { d, audited, calls } = deps();
    expect(await (await post("/api/node/reply", { paneId: "w1:p1", text: "go" }, d))!.json()).toEqual({ ok: true, textDelivered: true });
    expect(await (await post("/api/node/keys", { paneId: "w1:p1", keys: ["ctrl+c"] }, d, TOKEN_B))!.json()).toEqual({ ok: true });
    expect(calls).toEqual([["reply", "w1:p1", "go", true], ["keys", "w1:p1", ["ctrl+c"]]]);
    expect(audited.map(([a, p]) => [a, p])).toEqual([["node.reply", "arch-1"], ["node.keys", "win-cad"]]);
    expect((await post("/api/node/keys", { paneId: "w1:p1", keys: [] }, d))!.status).toBe(400);
    expect((await post("/api/node/reply", { text: "go" }, d))!.status).toBe(400);
  });

  it("launches in a declared environment through the injected launch, and remembers the pane", async () => {
    const { d, audited, calls } = deps();
    const res = (await post("/api/node/launch", { environment: "arch-2", prompt: "fix it", branch: "node/fix" }, d))!;
    expect(await res.json()).toEqual({ ok: true, paneId: "w9:p1", branch: "node/fix", environment: "arch-2" });
    expect(calls).toEqual([["launch", ENV_PATH, "claude", "fix it", "node/fix"]]);
    expect(d.launched.get("w9:p1")?.peer).toBe("arch-1");
    expect(audited.at(-1)).toEqual(["node.launch", "arch-1", { environment: "arch-2", branch: "node/fix", paneId: "w9:p1", prompt: "fix it" }]);
  });

  it("refuses a launch with a reason: undeclared environment, a path or a command, autonomy off", async () => {
    const { d, audited, calls } = deps();
    const undeclared = (await post("/api/node/launch", { environment: "other", prompt: "x" }, d))!;
    expect(undeclared.status).toBe(400);
    expect(((await undeclared.json()) as { error: string }).error).toContain("not declared");
    for (const extra of [{ repoPath: "/etc" }, { cwd: "/" }, { command: "rm -rf /" }, { agent: "sh" }, { args: ["--x"] }]) {
      expect((await post("/api/node/launch", { environment: "arch-2", prompt: "x", ...extra }, d))!.status).toBe(400);
    }
    const off = deps({ autonomyOn: (p) => p !== ENV_PATH });
    const r = (await post("/api/node/launch", { environment: "arch-2", prompt: "x" }, off.d))!;
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toContain("autonomy is off");
    expect(calls).toEqual([]);
    expect(off.calls).toEqual([]);
    expect(audited.every(([a, p, detail]) => a === "node.launch" && p === "arch-1" && "refused" in detail)).toBe(true);
  });

  it("diffs and ends only a pane launched for that peer", async () => {
    const { d, calls } = deps();
    expect((await call("/api/node/diff?pane=w1:p1", d, req("/api/node/diff?pane=w1:p1")))!.status).toBe(404);
    expect((await post("/api/node/end", { paneId: "w1:p1" }, d))!.status).toBe(404);
    await post("/api/node/launch", { environment: "arch-2", prompt: "x" }, d);
    const diff = (await call("/api/node/diff", d, req("/api/node/diff?pane=w9:p1&path=a.ts")))!;
    expect(await diff.json()).toEqual({ paneId: "w9:p1", path: "a.ts" });
    const bad = deps({ actions: { ...d.actions, diff: async () => ({ ok: false, error: "bad path" }) }, launched: d.launched });
    expect((await call("/api/node/diff", bad.d, req("/api/node/diff?pane=w9:p1&path=../x")))!.status).toBe(400);
    expect((await post("/api/node/end", { paneId: "w9:p1" }, d, TOKEN_B))!.status).toBe(404);
    expect((await post("/api/node/end", { paneId: "w9:p1" }, d))!.status).toBe(200);
    expect(calls.at(-1)).toEqual(["close", "w9:p1"]);
    expect(d.launched.size).toBe(0);
  });
});

describe("parseLaunch", () => {
  const node = parseNodeConfig(valid) as NodeConfig;
  it("resolves the environment by name and names a branch after the peer", () => {
    const r = parseLaunch({ environment: "arch-2", prompt: "go" }, node, "Arch 1", 36);
    expect(r).toEqual({ ok: true, value: { peer: "Arch 1", env: node.environments[0]!, prompt: "go", branch: "node/arch-1-10" } });
  });
  it("refuses an environment the peer was not granted", () => {
    const granted = { ...node, peers: [{ ...node.peers[0]!, launch: [] }] };
    const r = parseLaunch({ environment: "arch-2", prompt: "go" }, granted, "arch-1");
    expect(r.ok).toBe(false);
    expect(parseLaunch({ environment: "arch-2", prompt: "go" }, { ...granted, peers: [{ ...node.peers[0]!, launch: ["arch-2"] }] }, "arch-1").ok).toBe(true);
  });
  it("refuses an unsafe branch and an empty prompt", () => {
    for (const branch of ["-x", "../x", "a..b", "a//b", "a/", "x.lock", "a b", ""]) {
      expect(parseLaunch({ environment: "arch-2", prompt: "go", branch }, node, "p").ok).toBe(false);
    }
    expect(parseLaunch({ environment: "arch-2", prompt: " " }, node, "p").ok).toBe(false);
    expect(parseLaunch(["arch-2"], node, "p").ok).toBe(false);
  });
});
