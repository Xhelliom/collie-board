import { describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleNodeRoute, loadNodeConfig, parseNodeConfig, peerFor, type NodeConfig, type NodeRouteDeps } from "./node.ts";

const TOKEN_A = "a".repeat(40);
const TOKEN_B = "b".repeat(40);
const ENV_PATH = join(tmpdir(), "app");

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
      peers: valid.peers,
      environments: [{ name: "arch-2", repoPath: ENV_PATH, agent: "claude" }],
    });
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
    expect(loadNodeConfig(d)?.peers).toEqual([{ name: "arch-1", token: TOKEN_A }]);
  });

  it.skipIf(process.platform === "win32")("refuses a file others can read", () => {
    const d = dir();
    writeFileSync(join(d, "node.toml"), toml);
    chmodSync(join(d, "node.toml"), 0o644);
    expect(loadNodeConfig(d)).toBeNull();
  });
});

describe("peerFor", () => {
  it("names the peer whose token is presented", () => {
    expect(peerFor(`Bearer ${TOKEN_B}`, valid.peers)).toBe("win-cad");
    expect(peerFor(`bearer ${TOKEN_A}`, valid.peers)).toBe("arch-1");
  });

  it("is null for a missing, malformed or unknown token", () => {
    expect(peerFor(null, valid.peers)).toBeNull();
    expect(peerFor("", valid.peers)).toBeNull();
    expect(peerFor(TOKEN_A, valid.peers)).toBeNull();
    expect(peerFor(`Basic ${TOKEN_A}`, valid.peers)).toBeNull();
    expect(peerFor(`Bearer ${TOKEN_A}x`, valid.peers)).toBeNull();
    expect(peerFor("Bearer ", [{ name: "empty", token: "" }])).toBeNull();
  });
});

describe("handleNodeRoute", () => {
  const node = parseNodeConfig(valid) as NodeConfig;
  const snap = { agents: [], shellPanes: [], workspaces: [], tabs: [], bridge: "disconnected" };

  function deps(over: Partial<NodeRouteDeps> = {}) {
    const audited: [string | null, string][] = [];
    const d: NodeRouteDeps = {
      node,
      access: () => null,
      audit: (peer, route) => audited.push([peer, route]),
      snapshot: () => snap,
      readPane: async (id) => Response.json({ paneId: id }),
      json: (data) => Response.json(data),
      text: (body, status) => new Response(body, { status }),
      ...over,
    };
    return { d, audited };
  }
  const req = (path: string, token: string | null = TOKEN_A, method = "GET") =>
    new Request(`http://peer${path}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {} });
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
      [null, "/api/node/snapshot"],
      [null, "/api/node/snapshot"],
    ]);
  });

  it("keeps checkAccess in front of the token", async () => {
    const { d } = deps({ access: () => new Response("identity not trusted", { status: 403 }) });
    expect((await call("/api/node/snapshot", d))!.status).toBe(403);
  });

  it("serves the snapshot as is, disconnected included, and audits the peer", async () => {
    const { d, audited } = deps();
    const res = (await call("/api/node/snapshot", d))!;
    expect(await res.json()).toEqual(snap);
    expect(audited).toEqual([["arch-1", "/api/node/snapshot"]]);
  });

  it("reads one pane", async () => {
    const res = (await call("/api/node/pane/w1%3Ap3", deps().d))!;
    expect(await res.json()).toEqual({ paneId: "w1:p3" });
  });

  it("lists the environments without their paths", async () => {
    const res = (await call("/api/node/environments", deps().d))!;
    expect(await res.json()).toEqual({ node: "arch-2", environments: [{ name: "arch-2", agent: "claude" }] });
  });

  it("is read-only and knows no other route", async () => {
    expect((await call("/api/node/snapshot", deps().d, req("/api/node/snapshot", TOKEN_A, "POST")))!.status).toBe(405);
    expect((await call("/api/node/launch", deps().d))!.status).toBe(404);
  });
});
