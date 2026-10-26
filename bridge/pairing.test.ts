import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleNodeRoute, peerFor, type NodeRouteDeps } from "./node.ts";
import { formatCode, handlePeerRoute, INVITE_TTL_MS, normalizeCode, peerOrigin, PeerStore, type PeerRouteDeps } from "./pairing.ts";

const dir = () => mkdtempSync(join(tmpdir(), "collie-pair-"));

/** One machine: its store, its routes, its audit — `fetch` reaches the other machines by origin. */
function machine(name: string, machines: Map<string, PeerRouteDeps>, clock = { t: 1_000_000 }) {
  const stateDir = dir();
  writeFileSync(join(stateDir, "node.toml"), `name = "${name}"\n`, { mode: 0o600 });
  const audited: [string, Record<string, unknown>][] = [];
  const d: PeerRouteDeps = {
    store: new PeerStore(stateDir, () => clock.t),
    access: () => null,
    audit: (a, detail) => audited.push([a, detail]),
    json: (data, status) => Response.json(data, { status: status ?? 200 }),
    text: (body, status) => new Response(body, { status }),
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const target = machines.get(url.origin);
      if (!target) throw new Error("connection refused");
      const req = new Request(url, init);
      return (await handlePeerRoute(url.pathname, req, target)) ?? (await handleNodeRoute(url.pathname, req, nodeDeps(target)))!;
    }) as typeof fetch,
    knownRepos: async () => ["/home/me/git/app"],
    agents: () => ["claude", "codex"],
  };
  machines.set(`https://${name}.ts.net`, d);
  return { d, stateDir, audited, clock };
}

const nodeDeps = (t: PeerRouteDeps): NodeRouteDeps => ({
  node: t.store.node(),
  access: () => null,
  audit: () => {},
  snapshot: () => ({ bridge: "connected", agents: [{}, {}], shellPanes: [{}], workspaces: [], tabs: [] }),
  readPane: async () => new Response(),
  json: t.json,
  text: t.text,
  actions: {} as NodeRouteDeps["actions"],
  autonomyOn: () => false,
  launched: new Map(),
  version: "9.9.9",
});

const call = (d: PeerRouteDeps, path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) =>
  handlePeerRoute(path, new Request(`http://local${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), d).then((r) => r!);

const pair = (d: PeerRouteDeps, body: unknown, login?: string) =>
  call(d, "/api/node/pair", "POST", body, login ? { "tailscale-user-login": login } : {});

describe("codes and urls", () => {
  it("forgives dashes, case and Crockford's look-alikes", () => {
    expect(normalizeCode("abcd-efgh")).toBe("ABCDEFGH");
    expect(normalizeCode("0OIL 1234")).toBe("00111234");
    expect(normalizeCode("ABCD-EFG")).toBeNull();
    expect(normalizeCode("ABCD-EFGU")).toBeNull();
    expect(formatCode("ABCDEFGH")).toBe("ABCD-EFGH");
  });
  it("takes https, or http on loopback only", () => {
    expect(peerOrigin("https://b.ts.net/x?y")).toBe("https://b.ts.net");
    expect(peerOrigin("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
    expect(peerOrigin("http://b.ts.net")).toBeNull();
    expect(peerOrigin("https://u:p@b.ts.net")).toBeNull();
    expect(peerOrigin("file:///etc/passwd")).toBeNull();
  });
});

describe("POST /api/node/pair", () => {
  it("is a 404 without an invitation, and after one expires", async () => {
    const b = machine("b", new Map());
    expect((await pair(b.d, { code: "ABCD-EFGH", name: "a" })).status).toBe(404);
    const { code } = b.d.store.invite();
    b.clock.t += INVITE_TTL_MS;
    expect((await pair(b.d, { code, name: "a" })).status).toBe(404);
    expect(b.d.store.node()).toBeNull();
  });

  it("is spent by a wrong code: one attempt, then the right code is a 404 too", async () => {
    const b = machine("b", new Map());
    const { code } = b.d.store.invite();
    expect((await pair(b.d, { code: code === "00000000" ? "11111111" : "00000000", name: "a" }, "eve@gh")).status).toBe(404);
    expect(b.d.store.view().invitation).toMatchObject({ state: "burned", login: "eve@gh" });
    expect((await pair(b.d, { code, name: "a" })).status).toBe(404);
    expect(b.audited.map(([a]) => a)).toEqual(["peers.pair.burned"]);
  });

  it("takes the invitation before any await: of two simultaneous attempts, one is a 404", async () => {
    const b = machine("b", new Map());
    const { code } = b.d.store.invite();
    const [r1, r2] = await Promise.all([pair(b.d, { code, name: "a" }), pair(b.d, { code, name: "c" })]);
    expect([r1.status, r2.status].sort()).toEqual([200, 404]);
  });

  it("refuses a body that declares more than its name, and a taken name", async () => {
    const b = machine("b", new Map());
    let { code } = b.d.store.invite();
    expect((await pair(b.d, { code, name: "a", repoPath: "/" })).status).toBe(400);
    ({ code } = b.d.store.invite());
    expect((await pair(b.d, { code, name: "../x" })).status).toBe(400);
    ({ code } = b.d.store.invite());
    expect((await pair(b.d, { code, name: "a" })).status).toBe(200);
    ({ code } = b.d.store.invite());
    expect((await pair(b.d, { code, name: "a" })).status).toBe(409);
  });

  it("stores the token hashed, with the login seen, no launch grant, in a 0600 file", async () => {
    const b = machine("b", new Map());
    const { code } = b.d.store.invite();
    const { token, node } = (await (await pair(b.d, { code: formatCode(code).toLowerCase(), name: "a" }, "me@gh")).json()) as { token: string; node: string };
    expect(node).toBe("b");
    const file = readFileSync(join(b.stateDir, "node.toml"), "utf8");
    expect(file).not.toContain(token);
    expect(file).toContain('login = "me@gh"');
    expect(file).toContain("launch = []");
    if (process.platform !== "win32") expect(statSync(join(b.stateDir, "node.toml")).mode & 0o777).toBe(0o600);
    expect(peerFor(`Bearer ${token}`, b.d.store.node()!.peers)).toBe("a");
    expect(b.d.store.view().invitation).toMatchObject({ state: "used", name: "a" });
  });
});

describe("the operator's routes", () => {
  it("are refused to an agent pane, reads included", async () => {
    const b = machine("b", new Map());
    const pane = { "x-collie-pane": "w1:p1" };
    for (const [path, method] of [["/api/peers", "GET"], ["/api/peers/invite", "POST"], ["/api/peers/invite", "DELETE"], ["/api/peers/add", "POST"], ["/api/peers/revoke", "POST"], ["/api/peers/forget", "POST"], ["/api/peers/test", "POST"], ["/api/peers/environments", "POST"]] as const) {
      expect((await call(b.d, path, method, method === "POST" ? {} : undefined, pane)).status).toBe(403);
    }
    expect(b.d.store.view().invitation).toBeNull();
    expect(b.d.store.view().environments).toEqual([]);
  });

  it("keep checkAccess in front", async () => {
    const b = machine("b", new Map());
    b.d.access = () => new Response("no", { status: 403 });
    expect((await call(b.d, "/api/peers/invite", "POST")).status).toBe(403);
  });

  it("refuse to overwrite a node.toml edited by hand since the load", async () => {
    const b = machine("b", new Map());
    writeFileSync(join(b.stateDir, "node.toml"), `name = "b"\n# mine\n`, { mode: 0o600 });
    expect((await call(b.d, "/api/peers/invite", "POST")).status).toBe(409);
  });
});

describe("pairing end to end", () => {
  it("A adds B by code: the token never reaches the browser, A drives B, and B's revoke kills it at once", async () => {
    const machines = new Map<string, PeerRouteDeps>();
    const a = machine("a", machines);
    const b = machine("b", machines);

    const inv = (await (await call(b.d, "/api/peers/invite", "POST")).json()) as { code: string };
    const added = await call(a.d, "/api/peers/add", "POST", { url: "https://b.ts.net/", code: formatCode(inv.code) });
    const text = await added.text();
    expect(added.status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({ ok: true, peer: { name: "b", url: "https://b.ts.net" }, test: { state: "ok", node: "b", version: "9.9.9", panes: 3, environments: [], seenAs: { peer: "a", login: null } } });

    const token = a.d.store.outbound()[0]!.token;
    expect(text).not.toContain(token);
    expect(JSON.stringify((await (await call(a.d, "/api/peers")).json()))).not.toContain(token);
    expect(JSON.stringify((await (await call(b.d, "/api/peers")).json()))).not.toContain(token);
    expect(readFileSync(join(a.stateDir, "peers.toml"), "utf8")).toContain(token);
    if (process.platform !== "win32") expect(statSync(join(a.stateDir, "peers.toml")).mode & 0o777).toBe(0o600);
    expect(((await (await call(b.d, "/api/peers")).json()) as { inbound: unknown[] }).inbound).toEqual([
      { name: "a", login: null, pairedAt: expect.any(String), launch: [] },
    ]);

    // Revocation needs no restart: B's next answer to A is a 401.
    expect((await call(b.d, "/api/peers/revoke", "POST", { name: "a" })).status).toBe(200);
    expect(((await (await call(a.d, "/api/peers/test", "POST", { name: "b" })).json()) as { test: unknown }).test).toEqual({ state: "closed" });

    expect((await call(a.d, "/api/peers/forget", "POST", { name: "b" })).status).toBe(200);
    expect(a.d.store.outbound()).toEqual([]);
  });

  it("a wrong code burns B's invitation and A says why, writing nothing", async () => {
    const machines = new Map<string, PeerRouteDeps>();
    const a = machine("a", machines);
    const b = machine("b", machines);
    const { code } = b.d.store.invite();
    const res = await call(a.d, "/api/peers/add", "POST", { url: "https://b.ts.net", code: code === "00000000" ? "11111111" : "00000000" });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain("code refused");
    expect(a.d.store.outbound()).toEqual([]);
    expect(b.d.store.view().invitation?.state).toBe("burned");
  });

  it("a malformed code is refused at A, before B's invitation is spent", async () => {
    const machines = new Map<string, PeerRouteDeps>();
    const a = machine("a", machines);
    const b = machine("b", machines);
    b.d.store.invite();
    expect((await call(a.d, "/api/peers/add", "POST", { url: "https://b.ts.net", code: "ABC" })).status).toBe(400);
    expect((await call(a.d, "/api/peers/add", "POST", { url: "http://b.ts.net", code: "ABCD-EFGH" })).status).toBe(400);
    expect(b.d.store.view().invitation?.state).toBe("open");
  });
});

describe("environments, chosen, never typed", () => {
  const env = (d: PeerRouteDeps, body: unknown) => call(d, "/api/peers/environments", "POST", body);

  it("declares one from a known repo and agent, live on /api/node/environments without a restart", async () => {
    const machines = new Map<string, PeerRouteDeps>();
    const a = machine("a", machines);
    const b = machine("b", machines);
    const { code } = b.d.store.invite();
    await call(a.d, "/api/peers/add", "POST", { url: "https://b.ts.net", code });

    expect((await env(b.d, { action: "add", name: "app", repo: "/home/me/git/app", agent: "codex" })).status).toBe(200);
    expect(readFileSync(join(b.stateDir, "node.toml"), "utf8")).toContain('repo_path = "/home/me/git/app"');
    const test = ((await (await call(a.d, "/api/peers/test", "POST", { name: "b" })).json()) as { test: unknown }).test;
    expect(test).toMatchObject({ state: "ok", environments: [{ name: "app", agent: "codex" }] });
    expect(JSON.stringify(test)).not.toContain("/home/me");
  });

  it("refuses a typed path, an unknown agent, a bad or taken name", async () => {
    const b = machine("b", new Map());
    expect((await env(b.d, { action: "add", name: "x", repo: "/etc", agent: "claude" })).status).toBe(400);
    expect((await env(b.d, { action: "add", name: "x", repo: "/home/me/git/app", agent: "sh" })).status).toBe(400);
    expect((await env(b.d, { action: "add", name: "../x", repo: "/home/me/git/app", agent: "claude" })).status).toBe(400);
    expect((await env(b.d, { action: "add", name: "x", repo: "/home/me/git/app", agent: "claude" })).status).toBe(200);
    expect((await env(b.d, { action: "add", name: "x", repo: "/home/me/git/app", agent: "claude" })).status).toBe(409);
    expect(b.d.store.view().environments).toEqual([{ name: "x", repoPath: "/home/me/git/app", agent: "claude" }]);
  });

  it("renames and removes, and a peer's launch grant follows", async () => {
    const machines = new Map<string, PeerRouteDeps>();
    const a = machine("a", machines);
    const b = machine("b", machines);
    const { code } = b.d.store.invite();
    await call(a.d, "/api/peers/add", "POST", { url: "https://b.ts.net", code });
    await env(b.d, { action: "add", name: "app", repo: "/home/me/git/app", agent: "claude" });
    // A grant, as the operator will give it: written by hand into the in-memory config's file.
    const cfg = b.d.store.node()!;
    cfg.peers[0]!.launch = ["app"];

    expect((await env(b.d, { action: "rename", name: "app", to: "web" })).status).toBe(200);
    expect(b.d.store.view().environments.map((e) => e.name)).toEqual(["web"]);
    expect(b.d.store.view().inbound[0]!.launch).toEqual(["web"]);
    expect((await env(b.d, { action: "rename", name: "nope", to: "x" })).status).toBe(404);
    expect((await env(b.d, { action: "remove", name: "web" })).status).toBe(200);
    expect(b.d.store.view().environments).toEqual([]);
    expect(b.d.store.view().inbound[0]!.launch).toEqual([]);
  });
});

describe("« Tester la connexion »", () => {
  it("says 401 when the surface is open but the token is not B's, and unreachable when B is down", async () => {
    const machines = new Map<string, PeerRouteDeps>();
    const a = machine("a", machines);
    const b = machine("b", machines);
    const c = machine("c", machines);
    const { code } = b.d.store.invite();
    await call(a.d, "/api/peers/add", "POST", { url: "https://b.ts.net", code });
    const c2 = c.d.store.invite();
    await call(b.d, "/api/peers/add", "POST", { url: "https://c.ts.net", code: c2.code });
    // A's token for b, pointed at c: c's surface is open (b paired), the token is not c's.
    a.d.store.addOutbound({ ...a.d.store.outbound()[0]!, name: "c", url: "https://c.ts.net" });
    expect(((await (await call(a.d, "/api/peers/test", "POST", { name: "c" })).json()) as { test: unknown }).test).toEqual({ state: "refused" });
    machines.delete("https://b.ts.net");
    expect(((await (await call(a.d, "/api/peers/test", "POST", { name: "b" })).json()) as { test: unknown }).test).toEqual({ state: "unreachable", error: "connection refused" });
  });
});
