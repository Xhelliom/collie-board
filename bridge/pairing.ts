import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { PANE_HEADER } from "./board-routes.ts";
import { digest, parseNodeFile, readSecretToml, type NodeConfig } from "./node.ts";

// Pairing by code, from the settings screen (ADR 0049). B (driven) opens a 10-minute, single-use
// invitation; A (driving) sends B's URL and the code to its OWN bridge, which calls B's
// `POST /api/node/pair` once. B answers with a fresh token, stored hashed in its `node.toml`; A stores
// it in clear in its `peers.toml`. The token travels server to server only — no route reads it back.
// Both files are rewritten whole by the operator's routes, then replace the config in memory:
// reloaded on write, no watcher, no loop.

/** A peer name: the same alphabet as an environment's, nothing a path or a TOML key could hide in. */
export const PEER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const INVITE_TTL_MS = 10 * 60_000;
const PAIR_BODY_MAX = 512;
const PAIR_FIELDS = new Set(["code", "name"]);
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const CALL_TIMEOUT_MS = 8_000;

/** 8 Crockford base32 characters, 40 bits. */
export function newCode(): string {
  return Array.from({ length: 8 }, () => CROCKFORD[randomInt(32)]).join("");
}

/** A typed code, forgiving dashes, spaces, case and Crockford's look-alikes; null when it cannot be one. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  return c.length === 8 && [...c].every((ch) => CROCKFORD.includes(ch)) ? c : null;
}

export const formatCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;

/** A machine this one drives (ADR 0048 §4's `peers.toml`): the clear token never leaves this file. */
export interface OutboundPeer {
  name: string;
  url: string;
  token: string;
  pairedAt: string;
}

export function parsePeersFile(raw: unknown): OutboundPeer[] {
  const peers = (raw as { peers?: unknown }).peers ?? [];
  if (!Array.isArray(peers)) throw new Error("peers must be an array of tables");
  const out = peers.map((p: Record<string, unknown>, i) => {
    for (const k of ["name", "url", "token"]) if (typeof p?.[k] !== "string" || p[k] === "") throw new Error(`peers[${i}].${k} must be a non-empty string`);
    return { name: p.name as string, url: p.url as string, token: p.token as string, pairedAt: typeof p.paired_at === "string" ? p.paired_at : "" };
  });
  if (new Set(out.map((p) => p.name)).size !== out.length) throw new Error("two peers share a name");
  return out;
}

// A JSON string is a valid TOML basic string.
const q = JSON.stringify;
const HEADER = "# Written by Collie's settings → Peers (ADR 0049). Hand edits are taken at restart; comments are not kept.\n";

export function nodeToml(cfg: NodeConfig): string {
  let s = `${HEADER}name = ${q(cfg.name)}\n`;
  for (const p of cfg.peers) {
    s += `\n[[peers]]\nname = ${q(p.name)}\ntoken_sha256 = ${q(p.sha256)}\n`;
    if (p.login) s += `login = ${q(p.login)}\n`;
    if (p.pairedAt) s += `paired_at = ${q(p.pairedAt)}\n`;
    if (p.launch) s += `launch = [${p.launch.map((e) => q(e)).join(", ")}]\n`;
  }
  for (const e of cfg.environments) s += `\n[[environments]]\nname = ${q(e.name)}\nrepo_path = ${q(e.repoPath)}\nagent = ${q(e.agent)}\n`;
  return s;
}

export function peersToml(peers: OutboundPeer[]): string {
  return HEADER + peers.map((p) => `\n[[peers]]\nname = ${q(p.name)}\nurl = ${q(p.url)}\ntoken = ${q(p.token)}\npaired_at = ${q(p.pairedAt)}\n`).join("");
}

/** A refused config write, with the status the route answers. */
export class PeerError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type Invitation =
  | { state: "open"; code: string; expiresAt: number }
  | { state: "burned"; at: number; login: string | null }
  | { state: "used"; at: number; name: string };

/** What the settings screen sees: never a token, nor a prefix of one. */
export interface PeersView {
  name: string;
  invitation: Invitation | null;
  inbound: { name: string; login: string | null; pairedAt: string | null; launch: string[] | null }[];
  outbound: { name: string; url: string; pairedAt: string }[];
  error: string | null;
}

/** `node.toml` and `peers.toml`, as last read or written, plus the one invitation in memory. */
export class PeerStore {
  private nodeFile!: { cfg: NodeConfig | null; text: string | null; error?: string };
  private outFile!: { peers: OutboundPeer[]; text: string | null; error?: string };
  private invitation: Invitation | null = null;

  constructor(
    private readonly stateDir: string,
    private readonly now: () => number = Date.now,
  ) {
    const n = readSecretToml(this.nodePath, parseNodeFile);
    this.nodeFile = { cfg: n.value, text: n.text, ...(n.error ? { error: n.error } : {}) };
    if (n.error) console.warn(`[node] ${n.error}; /api/node/* stays off`);
    const o = readSecretToml(this.peersPath, parsePeersFile);
    this.outFile = { peers: o.value ?? [], text: o.text, ...(o.error ? { error: o.error } : {}) };
    if (o.error) console.warn(`[peers] ${o.error}`);
  }

  private get nodePath() {
    return join(this.stateDir, "node.toml");
  }
  private get peersPath() {
    return join(this.stateDir, "peers.toml");
  }

  /** The surface `/api/node/*` serves: null (a 404) while no peer is declared. */
  node(): NodeConfig | null {
    const cfg = this.nodeFile.cfg;
    return cfg && cfg.peers.length > 0 ? cfg : null;
  }

  ownName(): string {
    return this.nodeFile.cfg?.name ?? (hostname().replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 64) || "collie");
  }

  outbound(): readonly OutboundPeer[] {
    return this.outFile.peers;
  }

  view(): PeersView {
    return {
      name: this.ownName(),
      invitation: this.currentInvitation(),
      inbound: (this.nodeFile.cfg?.peers ?? []).map((p) => ({ name: p.name, login: p.login ?? null, pairedAt: p.pairedAt ?? null, launch: p.launch ?? null })),
      outbound: this.outFile.peers.map(({ name, url, pairedAt }) => ({ name, url, pairedAt })),
      error: this.nodeFile.error ?? this.outFile.error ?? null,
    };
  }

  private currentInvitation(): Invitation | null {
    const i = this.invitation;
    return i?.state === "open" && i.expiresAt <= this.now() ? null : i;
  }

  invite(): { code: string; expiresAt: number } {
    this.writable(this.nodePath, this.nodeFile); // refuse now, not after the other machine spent the code
    const inv = { state: "open" as const, code: newCode(), expiresAt: this.now() + INVITE_TTL_MS };
    this.invitation = inv;
    return { code: inv.code, expiresAt: inv.expiresAt };
  }

  cancelInvitation(): void {
    this.invitation = null;
  }

  /**
   * Take the open invitation, synchronously: whatever the attempt turns out to be, the code is spent
   * (ADR 0049 §3). Null when none is open — the route is then a 404.
   */
  takeInvitation(login: string | null): string | null {
    const i = this.currentInvitation();
    if (i?.state !== "open") return null;
    this.invitation = { state: "burned", at: this.now(), login };
    return i.code;
  }

  /** Record a new peer of this machine under the code just taken; returns the clear token, once. */
  pair(name: string, login: string | null): string {
    const cfg = this.nodeFile.cfg ?? { name: this.ownName(), peers: [], environments: [] };
    if (cfg.peers.some((p) => p.name === name)) throw new PeerError(`"${name}" is already a peer of ${cfg.name} — revoke it there first, then invite again`, 409);
    const token = randomBytes(32).toString("base64url");
    const at = new Date(this.now()).toISOString();
    const peer = { name, sha256: digest(token).toString("hex"), ...(login ? { login } : {}), pairedAt: at, launch: [] };
    this.writeNode({ ...cfg, peers: [...cfg.peers, peer] });
    this.invitation = { state: "used", at: this.now(), name };
    return token;
  }

  /** The token is dead at the return: the in-memory config is the one just written. */
  revoke(name: string): void {
    const cfg = this.nodeFile.cfg;
    if (!cfg?.peers.some((p) => p.name === name)) throw new PeerError(`no peer named "${name}"`, 404);
    this.writeNode({ ...cfg, peers: cfg.peers.filter((p) => p.name !== name) });
  }

  /** Store a machine this one drives; a second pairing with the same name replaces the first. */
  addOutbound(peer: OutboundPeer): void {
    this.writePeers([...this.outFile.peers.filter((p) => p.name !== peer.name), peer]);
  }

  /** Check that a write would not clobber a hand edit, before anything is spent on it. */
  checkOutboundWritable(): void {
    this.writable(this.peersPath, this.outFile);
  }

  forget(name: string): void {
    if (!this.outFile.peers.some((p) => p.name === name)) throw new PeerError(`no peer named "${name}"`, 404);
    this.writePeers(this.outFile.peers.filter((p) => p.name !== name));
  }

  private writeNode(cfg: NodeConfig): void {
    const text = nodeToml(cfg);
    this.write(this.nodePath, this.nodeFile, text);
    this.nodeFile = { cfg, text };
  }

  private writePeers(peers: OutboundPeer[]): void {
    const text = peersToml(peers);
    this.write(this.peersPath, this.outFile, text);
    this.outFile = { peers, text };
  }

  private writable(path: string, loaded: { text: string | null; error?: string }): void {
    if (loaded.error) throw new PeerError(`${loaded.error} — fix it by hand and restart the bridge`, 409);
    let disk: string | null;
    try {
      disk = readFileSync(path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      disk = null;
    }
    // Comparing the texts is comparing their digests: a hand edit since the load is never overwritten.
    if (disk !== loaded.text) throw new PeerError(`${path} was edited by hand — restart the bridge to take it`, 409);
  }

  /** Whole file, 0600 temp file then rename: a reader never sees half of it. */
  private write(path: string, loaded: { text: string | null; error?: string }, text: string): void {
    this.writable(path, loaded);
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, text, { mode: 0o600 });
    chmodSync(tmp, 0o600); // a stale temp file keeps its old mode through writeFileSync
    renameSync(tmp, path);
  }
}

/** B's origin as the operator typed it: https, or http on loopback (two bridges on one machine). */
export function peerOrigin(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  const loopback = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  return u.protocol === "https:" || (u.protocol === "http:" && loopback) ? u.origin : null;
}

/** A response body, cut at `max` bytes: a peer's answer is validated, never trusted to be small. */
async function readCapped(res: Request | Response, max: number): Promise<string | null> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export type TestResult =
  | { state: "ok"; node: string; environments: { name: string; agent: string }[] }
  | { state: "refused" }
  | { state: "closed" }
  | { state: "unreachable"; error: string };

/** « Tester la connexion »: one call, never retried, never scheduled — a button. */
export async function testPeer(fetchFn: typeof fetch, p: OutboundPeer): Promise<TestResult> {
  try {
    const res = await fetchFn(`${p.url}/api/node/environments`, {
      headers: { authorization: `Bearer ${p.token}` },
      redirect: "manual",
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    if (res.status === 401) return { state: "refused" };
    if (res.status === 404) return { state: "closed" };
    if (res.status !== 200) return { state: "unreachable", error: `HTTP ${res.status}` };
    const body = JSON.parse((await readCapped(res, 64 * 1024)) ?? "null") as { node?: unknown; environments?: unknown };
    if (typeof body?.node !== "string" || !Array.isArray(body.environments)) return { state: "unreachable", error: "not a Collie answer" };
    return { state: "ok", node: body.node, environments: body.environments as { name: string; agent: string }[] };
  } catch (err) {
    return { state: "unreachable", error: (err as Error).message };
  }
}

/** The one outbound call ADR 0049 §2 adds to ADR 0013: bounded, validated, never retried. */
export async function callPair(fetchFn: typeof fetch, origin: string, code: string, name: string): Promise<{ ok: true; node: string; token: string } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetchFn(`${origin}/api/node/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name }),
      redirect: "manual",
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, error: `unreachable: ${(err as Error).message}` };
  }
  const text = await readCapped(res, 4096).catch(() => null);
  if (res.status === 404) return { ok: false, error: "code refused: wrong, expired, or no invitation open there — invite again" };
  if (res.status !== 200) {
    let reason = `HTTP ${res.status}`;
    try {
      reason = (JSON.parse(text ?? "") as { error?: string }).error ?? reason;
    } catch {
      // not JSON: the status says enough
    }
    return { ok: false, error: reason };
  }
  try {
    const b = JSON.parse(text ?? "") as { node?: unknown; token?: unknown };
    if (typeof b.node === "string" && PEER_NAME.test(b.node) && typeof b.token === "string" && TOKEN.test(b.token)) return { ok: true, node: b.node, token: b.token };
  } catch {
    // fall through
  }
  return { ok: false, error: "not a Collie answer" };
}

export interface PeerRouteDeps {
  store: PeerStore;
  /** `checkAccess` (+ device gate on write): the host allowlist and the trusted identity stand in front. */
  access: (level: "read" | "write") => Response | null;
  audit: (action: string, detail: Record<string, unknown>) => void;
  json: (data: unknown, status?: number) => Response;
  text: (body: string, status: number) => Response;
  fetch: typeof fetch;
}

async function bodyOf(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const v: unknown = await req.json();
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `/api/peers/*` (the operator's) and `POST /api/node/pair` (the network's, during an invitation). Null for any other path. */
export async function handlePeerRoute(pathname: string, req: Request, d: PeerRouteDeps): Promise<Response | null> {
  if (pathname === "/api/node/pair") return pairRoute(req, d);
  if (pathname !== "/api/peers" && !pathname.startsWith("/api/peers/")) return null;

  const read = req.method === "GET";
  const denied = d.access(read ? "read" : "write");
  if (denied) return denied;
  // A config write — and the code on screen — is the operator's (ADR 0049 §5), like the autonomy switch.
  if (req.headers.get(PANE_HEADER)?.trim()) return d.text("peers are the operator's setting — an agent pane may not touch them", 403);
  const fail = (err: unknown) => (err instanceof PeerError ? d.json({ ok: false, error: err.message }, err.status) : d.json({ ok: false, error: (err as Error).message }, 500));
  const { store } = d;

  if (pathname === "/api/peers") return read ? d.json(store.view()) : d.text("method not allowed", 405);

  if (pathname === "/api/peers/invite") {
    if (req.method === "DELETE") {
      store.cancelInvitation();
      d.audit("peers.invite.cancel", {});
      return d.json({ ok: true });
    }
    if (req.method !== "POST") return d.text("method not allowed", 405);
    try {
      const inv = store.invite();
      d.audit("peers.invite", { expiresAt: inv.expiresAt });
      return d.json({ ok: true, ...inv });
    } catch (err) {
      return fail(err);
    }
  }

  if (req.method !== "POST") return d.text("method not allowed", 405);
  const b = await bodyOf(req);
  if (!b) return d.json({ ok: false, error: "body must be a JSON object" }, 400);
  const name = typeof b.name === "string" ? b.name : "";

  try {
    if (pathname === "/api/peers/revoke") {
      store.revoke(name);
      d.audit("peers.revoke", { peer: name });
      return d.json({ ok: true });
    }
    if (pathname === "/api/peers/forget") {
      store.forget(name);
      d.audit("peers.forget", { peer: name });
      return d.json({ ok: true });
    }
    if (pathname === "/api/peers/test") {
      const p = store.outbound().find((o) => o.name === name);
      if (!p) return d.json({ ok: false, error: `no peer named "${name}"` }, 404);
      return d.json({ ok: true, test: await testPeer(d.fetch, p) });
    }
    if (pathname === "/api/peers/add") {
      const origin = peerOrigin(b.url);
      if (!origin) return d.json({ ok: false, error: "url must be https:// (http:// only on loopback)" }, 400);
      const code = normalizeCode(b.code);
      // Checked here, so a typo never spends the other machine's invitation.
      if (!code) return d.json({ ok: false, error: "the code is 8 characters, like ABCD-EFGH" }, 400);
      store.checkOutboundWritable();
      const r = await callPair(d.fetch, origin, code, store.ownName());
      d.audit("peers.add", { url: origin, ...(r.ok ? { peer: r.node } : { refused: r.error }) });
      if (!r.ok) return d.json({ ok: false, error: r.error }, 502);
      const peer = { name: r.node, url: origin, token: r.token, pairedAt: new Date().toISOString() };
      store.addOutbound(peer);
      return d.json({ ok: true, peer: { name: peer.name, url: peer.url, pairedAt: peer.pairedAt }, test: await testPeer(d.fetch, peer) });
    }
  } catch (err) {
    return fail(err);
  }
  return d.text("not found", 404);
}

/**
 * The one route a peer without a token reaches (ADR 0049 §3): a 404 outside an open invitation, and
 * the invitation is spent by the first attempt, right or wrong, before any await.
 */
async function pairRoute(req: Request, d: PeerRouteDeps): Promise<Response> {
  const notFound = () => d.text("not found", 404);
  if (req.method !== "POST" || d.store.view().invitation?.state !== "open") return notFound();
  const denied = d.access("read");
  if (denied) return denied;
  const login = req.headers.get("tailscale-user-login");
  const code = d.store.takeInvitation(login);
  if (!code) return notFound();

  const raw = await readCapped(req, PAIR_BODY_MAX).catch(() => null);
  let b: Record<string, unknown> | null = null;
  try {
    const v: unknown = JSON.parse(raw ?? "");
    if (typeof v === "object" && v !== null && !Array.isArray(v)) b = v as Record<string, unknown>;
  } catch {
    // b stays null: a wrong code
  }
  const given = normalizeCode(b?.code) ?? "";
  // Both sides hashed to the same length for timingSafeEqual, like peerFor().
  if (!b || !timingSafeEqual(digest(given), digest(code))) {
    d.audit("peers.pair.burned", { login });
    return notFound();
  }
  const extra = Object.keys(b).filter((k) => !PAIR_FIELDS.has(k));
  if (extra.length) return d.json({ ok: false, error: `refused: ${extra.join(", ")} — a pairing names its caller, nothing else` }, 400);
  if (typeof b.name !== "string" || !PEER_NAME.test(b.name)) return d.json({ ok: false, error: "name must be letters, digits, . _ - (64 at most)" }, 400);
  try {
    const token = d.store.pair(b.name, login);
    d.audit("peers.pair", { peer: b.name, login });
    return d.json({ node: d.store.ownName(), token });
  } catch (err) {
    return d.json({ ok: false, error: (err as Error).message }, err instanceof PeerError ? err.status : 500);
  }
}
