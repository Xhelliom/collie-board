import { describe, expect, it } from "bun:test";

import type { OutboundPeer } from "./pairing.ts";
import { handleHerdRoute, herdOf, PeerHerd, READ_EVERY_MS, type HerdRouteDeps } from "./peer-herd.ts";
import type { EngineSnapshot } from "./state-engine.ts";

const DEV: OutboundPeer = { name: "dev", url: "https://dev.example.ts.net", token: "t".repeat(43), pairedAt: "" };
const WIN: OutboundPeer = { name: "win", url: "https://win.example.ts.net", token: "w".repeat(43), pairedAt: "" };
const LOCAL: EngineSnapshot = { agents: [], shellPanes: [], workspaces: [], tabs: [], bridge: "connected" };
const SNAP = { bridge: "connected", agents: [{ paneId: "w1:p1", status: "blocked" }], shellPanes: [{ paneId: "w1:p2" }] };

type Seen = { url: string; init: RequestInit };
function fakeFetch(answer: (url: string) => Response | Promise<Response> | Error): { fetch: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const f = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    const a = await answer(url);
    if (a instanceof Error) throw a;
    return a;
  }) as unknown as typeof fetch;
  return { fetch: f, seen };
}

describe("herdOf", () => {
  it("marks every pane with its peer", () => {
    const h = herdOf("dev", { status: 200, body: SNAP });
    expect(h.state).toBe("connected");
    expect(h.agents).toEqual([{ paneId: "w1:p1", status: "blocked", peer: "dev" }]);
    expect(h.shellPanes).toEqual([{ paneId: "w1:p2", peer: "dev" }]);
  });
  it("is disconnected when unreachable, refused, or its herdr is down", () => {
    expect(herdOf("dev", { error: "timeout" })).toMatchObject({ state: "disconnected", agents: [] });
    expect(herdOf("dev", { status: 401, body: null }).error).toContain("token");
    expect(herdOf("dev", { status: 200, body: { bridge: "disconnected", agents: [] } })).toMatchObject({ state: "disconnected", error: "dev: its herdr is disconnected" });
  });
});

describe("PeerHerd", () => {
  it("raises a remote blocked in the herd's slot and retracts it when the peer stops saying it", async () => {
    let t = 0;
    let answer: unknown = SNAP;
    const { fetch } = fakeFetch(() => (answer instanceof Error ? answer : Response.json(answer)));
    const log: string[] = [];
    const alerts = { arm: (k: string, a: { status: string; paneId?: string }) => log.push(`arm ${k} ${a.status} ${a.paneId}`), retract: (k: string) => log.push(`retract ${k}`) };
    const herd = new PeerHerd({ fetch, outbound: () => [DEV], alerts: () => alerts }, () => t);
    await herd.update(LOCAL);
    t += READ_EVERY_MS;
    await herd.update(LOCAL); // still blocked: armed once, not re-armed
    expect(log).toEqual(["arm w1:p1@dev blocked w1:p1@dev"]);
    answer = { ...SNAP, agents: [{ paneId: "w1:p1", status: "working" }] };
    t += READ_EVERY_MS;
    await herd.update(LOCAL);
    expect(log.at(-1)).toBe("retract w1:p1@dev");
    answer = SNAP;
    t += READ_EVERY_MS;
    await herd.update(LOCAL);
    answer = new Error("timeout"); // unreachable: we can no longer read it, so it goes
    t += READ_EVERY_MS;
    await herd.update(LOCAL);
    expect(log.slice(2)).toEqual(["arm w1:p1@dev blocked w1:p1@dev", "retract w1:p1@dev"]);
  });

  it("reads each peer at most every READ_EVERY_MS", async () => {
    let t = 0;
    const { fetch, seen } = fakeFetch(() => Response.json(SNAP));
    const herd = new PeerHerd({ fetch, outbound: () => [DEV] }, () => t);
    await herd.update(LOCAL);
    t = READ_EVERY_MS - 1;
    await herd.update(LOCAL);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe(`${DEV.url}/api/node/snapshot`);
    t = READ_EVERY_MS;
    await herd.update(LOCAL);
    expect(seen).toHaveLength(2);
  });

  it("keeps one call in flight per peer", async () => {
    let t = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { fetch, seen } = fakeFetch(async () => (await gate, Response.json(SNAP)));
    const herd = new PeerHerd({ fetch, outbound: () => [DEV] }, () => t);
    const first = herd.update(LOCAL);
    t = 10 * READ_EVERY_MS;
    await herd.update(LOCAL);
    expect(seen).toHaveLength(1);
    release();
    await first;
    expect(herd.view()[0]!.state).toBe("connected");
  });

  it("an unreachable peer is disconnected alone — the others stay", async () => {
    const { fetch } = fakeFetch((url) => (url.startsWith(WIN.url) ? new Error("connection refused") : Response.json(SNAP)));
    const herd = new PeerHerd({ fetch, outbound: () => [DEV, WIN] });
    await herd.update(LOCAL);
    const [dev, win] = herd.view();
    expect(dev).toMatchObject({ peer: "dev", state: "connected" });
    expect(dev!.agents).toHaveLength(1);
    expect(win).toMatchObject({ peer: "win", state: "disconnected", agents: [] });
    expect(win!.error).toContain("connection refused");
  });

  it("bails on a disconnected local snapshot, and shows a peer never read as pending", async () => {
    const { fetch, seen } = fakeFetch(() => Response.json(SNAP));
    const herd = new PeerHerd({ fetch, outbound: () => [DEV] });
    await herd.update({ ...LOCAL, bridge: "disconnected" });
    expect(seen).toHaveLength(0);
    expect(herd.view()).toEqual([{ peer: "dev", state: "pending", error: null, agents: [], shellPanes: [], at: null }]);
  });

  it("forgets a peer no longer paired", async () => {
    let peers = [DEV, WIN];
    const { fetch } = fakeFetch(() => Response.json(SNAP));
    const herd = new PeerHerd({ fetch, outbound: () => peers });
    await herd.update(LOCAL);
    peers = [DEV];
    await herd.update(LOCAL);
    expect(herd.view().map((v) => v.peer)).toEqual(["dev"]);
  });
});

describe("handleHerdRoute", () => {
  function deps(fetch: typeof globalThis.fetch, over: Partial<HerdRouteDeps> = {}) {
    const audited: unknown[] = [];
    const d: HerdRouteDeps = {
      herd: new PeerHerd({ fetch, outbound: () => [DEV] }),
      outbound: () => [DEV],
      fetch,
      guard: () => null,
      device: () => null,
      audit: (action, paneId, _device, detail) => audited.push({ action, paneId, ...detail }),
      json: (data, status) => Response.json(data, { status: status ?? 200 }),
      text: (body, status) => new Response(body, { status }),
      ...over,
    };
    return { d, audited };
  }
  const post = (path: string, body: unknown) => new Request(`http://x${path}`, { method: "POST", body: JSON.stringify(body) });

  it("relays a pane read to the peer, token in the header and never in the answer", async () => {
    const { fetch, seen } = fakeFetch(() => Response.json({ paneId: "w1:p1", lines: ["hi"] }));
    const res = await handleHerdRoute("/api/herd/dev/pane/w1%3Ap1", new Request("http://x/api/herd/dev/pane/w1%3Ap1?lines=50"), deps(fetch).d);
    expect(res!.status).toBe(200);
    expect(seen[0]!.url).toBe(`${DEV.url}/api/node/pane/w1%3Ap1?lines=50`);
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${DEV.token}`);
    expect(JSON.stringify(await res!.json())).not.toContain(DEV.token);
  });

  it("relays a reply and keys to /api/node/reply|keys, audited with the peer", async () => {
    const { fetch, seen } = fakeFetch(() => Response.json({ ok: true, textDelivered: true }));
    const { d, audited } = deps(fetch);
    expect((await handleHerdRoute("/api/herd/dev/pane/w1:p1/reply", post("/", { text: "yes" }), d))!.status).toBe(200);
    expect((await handleHerdRoute("/api/herd/dev/pane/w1:p1/keys", post("/", { keys: ["Enter"] }), d))!.status).toBe(200);
    expect(seen.map((s) => [s.url, JSON.parse(s.init.body as string)])).toEqual([
      [`${DEV.url}/api/node/reply`, { paneId: "w1:p1", text: "yes", submit: true }],
      [`${DEV.url}/api/node/keys`, { paneId: "w1:p1", keys: ["Enter"] }],
    ]);
    expect(audited).toEqual([
      { action: "herd.reply", paneId: "w1:p1", peer: "dev", text: "yes", submit: true, status: 200 },
      { action: "herd.keys", paneId: "w1:p1", peer: "dev", keys: ["Enter"], status: 200 },
    ]);
  });

  it("guards like the local routes: write for an action, read for a read", async () => {
    const levels: string[] = [];
    const { fetch, seen } = fakeFetch(() => Response.json({}));
    const { d } = deps(fetch, { guard: (l) => (levels.push(l), new Response("no", { status: 403 })) });
    expect((await handleHerdRoute("/api/herd/dev/pane/p/keys", post("/", { keys: ["Enter"] }), d))!.status).toBe(403);
    expect((await handleHerdRoute("/api/herd/dev/pane/p", new Request("http://x/"), d))!.status).toBe(403);
    expect((await handleHerdRoute("/api/herd", new Request("http://x/"), d))!.status).toBe(403);
    expect(levels).toEqual(["write", "read", "read"]);
    expect(seen).toHaveLength(0);
  });

  it("refuses an unknown peer, no keys, and says 502 when the peer is unreachable", async () => {
    const { fetch } = fakeFetch(() => new Error("down"));
    const { d } = deps(fetch);
    expect((await handleHerdRoute("/api/herd/nope/pane/p", new Request("http://x/"), d))!.status).toBe(404);
    expect((await handleHerdRoute("/api/herd/dev/pane/p/keys", post("/", { keys: [] }), d))!.status).toBe(400);
    expect((await handleHerdRoute("/api/herd/dev/pane/p/reply", post("/", { text: "x" }), d))!.status).toBe(502);
    expect(await handleHerdRoute("/api/snapshot", new Request("http://x/"), d)).toBeNull();
  });
});
