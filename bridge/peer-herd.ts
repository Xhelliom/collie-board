// One herd (decision 77740d3b point 3): the agents of the peers this machine drives, read from their
// `/api/node/snapshot` and served beside the local ones, each marked with its peer. Hung off
// `engine.onUpdate`, NO timer of its own: a peer is read at most every READ_EVERY_MS, one call in
// flight per peer. In memory only — runtime state, never persisted. Reading, answering and keys on a
// remote pane are relayed to its `/api/node/pane|reply|keys` through remote-launch's `call()`; the
// token stays in `peers.toml`, the browser only ever names the peer.

import type { OutboundPeer } from "./pairing.ts";
import { call, ok, peerRefusal, type Call } from "./remote-launch.ts";
import type { EngineSnapshot } from "./state-engine.ts";

export const READ_EVERY_MS = 5_000;

/** One peer's herd as last read. `disconnected`: unreachable, refused, or its herdr is down — this peer only. */
export interface PeerHerdView {
  peer: string;
  state: "pending" | "connected" | "disconnected";
  error: string | null;
  /** Its panes, each with `peer` set; empty while not connected. */
  agents: Record<string, unknown>[];
  shellPanes: Record<string, unknown>[];
  /** When the last answer (or failure) came back; null before the first. */
  at: number | null;
}

/** What one `/api/node/snapshot` call says of a peer. Pure. */
export function herdOf(peer: string, r: Call): Pick<PeerHerdView, "state" | "error" | "agents" | "shellPanes"> {
  const down = (error: string) => ({ state: "disconnected" as const, error, agents: [], shellPanes: [] });
  if (!ok(r)) return down(peerRefusal(peer, "snapshot", r));
  if (r.body.bridge === "disconnected") return down(`${peer}: its herdr is disconnected`);
  const tag = (v: unknown) =>
    (Array.isArray(v) ? v : []).filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null).map((p) => ({ ...p, peer }));
  return { state: "connected", error: null, agents: tag(r.body.agents), shellPanes: tag(r.body.shellPanes) };
}

interface Slot extends PeerHerdView {
  busy: boolean;
  lastRead: number;
}

export interface PeerHerdDeps {
  fetch: typeof fetch;
  outbound: () => readonly OutboundPeer[];
}

export class PeerHerd {
  private readonly slots = new Map<string, Slot>();

  constructor(
    private readonly d: PeerHerdDeps,
    private readonly now: () => number = Date.now,
  ) {}

  /** The `engine.onUpdate` consumer. Resolves once the reads this tick started are back. */
  async update(snap: EngineSnapshot): Promise<void> {
    if (snap.bridge === "disconnected") return;
    const peers = this.d.outbound();
    for (const name of this.slots.keys()) if (!peers.some((p) => p.name === name)) this.slots.delete(name);
    await Promise.all(peers.map((p) => this.read(p)));
  }

  private async read(peer: OutboundPeer): Promise<void> {
    let s = this.slots.get(peer.name);
    if (!s) this.slots.set(peer.name, (s = { peer: peer.name, state: "pending", error: null, agents: [], shellPanes: [], at: null, busy: false, lastRead: -Infinity }));
    const now = this.now();
    if (s.busy || now - s.lastRead < READ_EVERY_MS) return;
    s.busy = true;
    s.lastRead = now;
    try {
      Object.assign(s, herdOf(peer.name, await call(this.d, peer, "/api/node/snapshot")), { at: this.now() });
    } finally {
      s.busy = false;
    }
  }

  /** Every paired peer, in `peers.toml` order; one never read yet is `pending`. */
  view(): PeerHerdView[] {
    return this.d.outbound().map((p) => {
      const s = this.slots.get(p.name);
      return s
        ? { peer: s.peer, state: s.state, error: s.error, agents: s.agents, shellPanes: s.shellPanes, at: s.at }
        : { peer: p.name, state: "pending", error: null, agents: [], shellPanes: [], at: null };
    });
  }
}

export interface HerdRouteDeps {
  herd: PeerHerd;
  outbound: () => readonly OutboundPeer[];
  fetch: typeof fetch;
  /** Same guard as the local pane routes: read for a read, write (+ device) for reply/keys. */
  guard: (level: "read" | "write") => Response | null;
  device: () => string | null;
  audit: (action: string, paneId: string, device: string | null, detail: Record<string, unknown>) => void;
  json: (data: unknown, status?: number) => Response;
  text: (body: string, status: number) => Response;
}

const HERD_PANE_ROUTE = /^\/api\/herd\/([^/]+)\/pane\/([^/]+?)(?:\/(reply|keys))?$/;

/** `GET /api/herd` and `/api/herd/<peer>/pane/<paneId>[/reply|/keys]`. Null for any other path. */
export async function handleHerdRoute(pathname: string, req: Request, d: HerdRouteDeps): Promise<Response | null> {
  if (pathname === "/api/herd") {
    const denied = d.guard("read");
    if (denied) return denied;
    return req.method === "GET" ? d.json({ peers: d.herd.view() }) : d.text("method not allowed", 405);
  }
  if (!pathname.startsWith("/api/herd/")) return null;
  const m = HERD_PANE_ROUTE.exec(pathname);
  if (!m) return d.text("not found", 404);
  const action = m[3];
  const denied = d.guard(action ? "write" : "read");
  if (denied) return denied;
  const peerName = decodeURIComponent(m[1]!);
  const paneId = decodeURIComponent(m[2]!);
  const peer = d.outbound().find((p) => p.name === peerName);
  if (!peer) return d.json({ ok: false, error: `${peerName} is not a paired peer of this machine` }, 404);
  const relay = (r: Call) => ("error" in r ? d.json({ ok: false, error: peerRefusal(peer.name, "pane", r) }, 502) : d.json(r.body ?? { ok: false, error: `HTTP ${r.status}` }, r.status));

  if (!action) {
    if (req.method !== "GET") return d.text("method not allowed", 405);
    return relay(await call(d, peer, `/api/node/pane/${encodeURIComponent(paneId)}${new URL(req.url).search}`));
  }
  if (req.method !== "POST") return d.text("method not allowed", 405);
  let b: { text?: unknown; submit?: unknown; keys?: unknown };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return d.text("bad body", 400);
  }
  if (typeof b !== "object" || b === null) return d.text("bad body", 400);
  const device = d.device();
  if (action === "reply") {
    if (b.text !== undefined && typeof b.text !== "string") return d.text("text must be a string", 400);
    const body = { paneId, text: (b.text as string | undefined) ?? "", submit: b.submit !== false };
    const r = await call(d, peer, "/api/node/reply", { body });
    d.audit("herd.reply", paneId, device, { peer: peer.name, text: body.text, submit: body.submit, status: "error" in r ? "unreachable" : r.status });
    return relay(r);
  }
  const keys = Array.isArray(b.keys) ? b.keys.filter((k): k is string => typeof k === "string") : [];
  if (keys.length === 0) return d.text("no keys", 400);
  const r = await call(d, peer, "/api/node/keys", { body: { paneId, keys } });
  d.audit("herd.keys", paneId, device, { peer: peer.name, keys, status: "error" in r ? "unreachable" : r.status });
  return relay(r);
}
