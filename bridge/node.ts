import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { agentNameFor, launchAgent, promptAndConfirm } from "./cards.ts";
import { defaultBranchOf, diffFile, diffStat } from "./git.ts";
import type { HerdrClient } from "./herdr-client.ts";

// The peer surface (ADR 0046 §2 and §4, as revised by decision bed340b1: no central). Every machine
// is a full Collie with its board on; `/api/node/*` is one more surface the OTHER peers
// read and drive, server to server, with a bearer token. The config is `<stateDir>/node.toml`, 0600, never in
// a repo: without it, or without a single token, the whole family is a 404 and nothing changes.
// The bridge still calls no one (ADR 0013) — reading the other peers is ADR 0048's.

/** A peer allowed to read this machine: its name is what the audit log records. */
export interface NodePeer {
  name: string;
  /** SHA-256 of its token, hex: the clear token lives only in the caller's `peers.toml` (ADR 0049 §4). */
  sha256: string;
  /** The Tailscale login seen at pairing: a request with this token under another login is refused. */
  login?: string;
  pairedAt?: string;
  /** Environments it may launch in. Absent: every one (a hand-written 0046 peer); a paired peer starts with none. */
  launch?: string[];
}

/** A place this machine offers to run an agent. The path stays here: a peer only ever names it. */
export interface NodeEnvironment {
  name: string;
  repoPath: string;
  agent: string;
}

export interface NodeConfig {
  /** This peer's own name. */
  name: string;
  peers: NodePeer[];
  environments: NodeEnvironment[];
}

/** A token shorter than this is refused: it is worth a shell on this machine. */
const MIN_TOKEN_LENGTH = 32;
const SHA256_HEX = /^[0-9a-f]{64}$/;

function str(v: unknown, what: string): string {
  if (typeof v !== "string" || v.trim() === "") throw new Error(`${what} must be a non-empty string`);
  return v.trim();
}

function table(v: unknown, what: string): Record<string, unknown>[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((e) => e === null || typeof e !== "object")) throw new Error(`${what} must be an array of tables`);
  return v as Record<string, unknown>[];
}

/**
 * Validate a parsed `node.toml`. Pure; throws on anything malformed — a half-read file must close the
 * surface, not open a guessed version of it. Returns null when no peer is declared (nothing to open).
 *
 * ```toml
 * name = "arch-2"
 * [[peers]]
 * name = "arch-1"
 * token = "…"            # ≥ 32 chars, one per peer — or token_sha256 = "<hex>", what the UI writes
 * login = "me@github"    # optional: the Tailscale login this token must come with
 * launch = ["arch-2"]    # optional: absent, every environment
 * [[environments]]
 * name = "arch-2"
 * repo_path = "/home/me/git/app"
 * agent = "claude"
 * ```
 */
export function parseNodeConfig(raw: unknown): NodeConfig | null {
  const cfg = parseNodeFile(raw);
  return cfg.peers.length > 0 ? cfg : null;
}

/** {@link parseNodeConfig}, with no peer still a config: what the pairing routes rewrite. */
export function parseNodeFile(raw: unknown): NodeConfig {
  if (raw === null || typeof raw !== "object") throw new Error("node.toml must be a table");
  const r = raw as Record<string, unknown>;
  const name = str(r.name, "name");
  const peers = table(r.peers, "peers").map((p, i): NodePeer => {
    let sha256: string;
    if (p.token_sha256 !== undefined) {
      sha256 = str(p.token_sha256, `peers[${i}].token_sha256`).toLowerCase();
      if (!SHA256_HEX.test(sha256)) throw new Error(`peers[${i}].token_sha256 is not a SHA-256 hex digest`);
    } else {
      const token = str(p.token, `peers[${i}].token`);
      if (token.length < MIN_TOKEN_LENGTH) throw new Error(`peers[${i}].token is shorter than ${MIN_TOKEN_LENGTH} characters`);
      sha256 = digest(token).toString("hex");
    }
    const peer: NodePeer = { name: str(p.name, `peers[${i}].name`), sha256 };
    if (p.login !== undefined) peer.login = str(p.login, `peers[${i}].login`);
    if (p.paired_at !== undefined) peer.pairedAt = str(p.paired_at, `peers[${i}].paired_at`);
    if (p.launch !== undefined) {
      if (!Array.isArray(p.launch) || p.launch.some((e) => typeof e !== "string")) throw new Error(`peers[${i}].launch must be an array of strings`);
      peer.launch = p.launch as string[];
    }
    return peer;
  });
  if (new Set(peers.map((p) => p.sha256)).size !== peers.length) throw new Error("two peers share a token");
  if (new Set(peers.map((p) => p.name)).size !== peers.length) throw new Error("two peers share a name");
  const environments = table(r.environments, "environments").map((e, i) => {
    const repoPath = str(e.repo_path ?? e.repoPath, `environments[${i}].repo_path`);
    if (!isAbsolute(repoPath)) throw new Error(`environments[${i}].repo_path must be absolute`);
    return { name: str(e.name, `environments[${i}].name`), repoPath, agent: str(e.agent, `environments[${i}].agent`) };
  });
  if (new Set(environments.map((e) => e.name)).size !== environments.length) throw new Error("two environments share a name");
  return { name, peers, environments };
}

/** A 0600 config file of the state dir, as read: `text` null when absent, `error` when it must stay shut. */
export interface SecretFile<T> {
  value: T | null;
  text: string | null;
  error?: string;
}

/**
 * Read a secret TOML of the state dir. Absent → value and text null, silently. Unreadable, malformed,
 * or readable by group/others → value null with an error: every failure closes the surface.
 */
export function readSecretToml<T>(path: string, parse: (raw: unknown) => T): SecretFile<T> {
  try {
    // Windows has no POSIX modes; its inherited ACLs are accepted (ADR 0046 §7).
    if (process.platform !== "win32" && (statSync(path).mode & 0o077) !== 0) {
      return { value: null, text: null, error: `${path} is readable by others — chmod 600 it` };
    }
    const text = readFileSync(path, "utf8");
    try {
      return { value: parse(Bun.TOML.parse(text)), text };
    } catch (err) {
      return { value: null, text, error: `${path}: ${(err as Error).message}` };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { value: null, text: null };
    return { value: null, text: null, error: `${path}: ${(err as Error).message}` };
  }
}

/**
 * Read `<stateDir>/node.toml`. Absent → null, silently (the default). Unreadable, malformed, or
 * readable by group/others → null with a warning: every failure closes the surface.
 */
export function loadNodeConfig(stateDir: string): NodeConfig | null {
  const f = readSecretToml(join(stateDir, "node.toml"), parseNodeConfig);
  if (f.error) console.warn(`[node] ${f.error}; /api/node/* stays off`);
  return f.value;
}

export const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * The peer a request's `authorization: Bearer <token>` belongs to, or null. Constant time: both sides
 * are hashed to the same length for `timingSafeEqual`, and every peer is compared, no early exit.
 */
export function peerFor(authorization: string | null, peers: readonly NodePeer[]): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? "");
  const given = digest(m?.[1] ?? "");
  let found: string | null = null;
  for (const p of peers) if (timingSafeEqual(given, Buffer.from(p.sha256, "hex")) && m) found = p.name;
  return found;
}

/** A pane this machine launched for a peer: what `diff` reads and `end` closes. Memory only. */
export interface LaunchedPane {
  paneId: string;
  peer: string;
  environment: string;
  branch: string;
  checkoutPath: string;
  base: string | null;
}

/** A validated `POST /api/node/launch`: the environment is this machine's own, resolved by name. */
export interface LaunchRequest {
  peer: string;
  env: NodeEnvironment;
  prompt: string;
  branch: string;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// Anything else — a path, a cwd, an agent, a command, args — is refused by name, never ignored.
const LAUNCH_FIELDS = new Set(["environment", "prompt", "branch"]);
// A ref git accepts and that cannot pass for an option or climb out of refs/heads.
const SAFE_BRANCH = /^(?![-/.])(?!.*\.\.)(?!.*\/\/)(?!.*[/.]$)(?!.*\.lock$)[A-Za-z0-9._/-]{1,100}$/;

/** Validate a launch body against this machine's own config. Pure. */
export function parseLaunch(body: unknown, node: NodeConfig, peer: string, now = Date.now()): Parsed<LaunchRequest> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "body must be a JSON object" };
  const b = body as Record<string, unknown>;
  const extra = Object.keys(b).filter((k) => !LAUNCH_FIELDS.has(k));
  if (extra.length) return { ok: false, error: `refused: ${extra.join(", ")} — a peer names an environment; the path and the agent are ${node.name}'s` };
  if (typeof b.environment !== "string") return { ok: false, error: "environment is required" };
  const env = node.environments.find((e) => e.name === b.environment);
  if (!env) {
    const known = node.environments.map((e) => e.name).join(", ") || "none";
    return { ok: false, error: `environment "${b.environment}" is not declared on ${node.name} (declared: ${known})` };
  }
  const allowed = node.peers.find((p) => p.name === peer)?.launch;
  if (allowed && !allowed.includes(env.name)) return { ok: false, error: `${peer} may not launch in "${env.name}" — ${node.name}'s owner grants it (ADR 0049 §4)` };
  if (typeof b.prompt !== "string" || b.prompt.trim() === "") return { ok: false, error: "prompt must be a non-empty string" };
  if (b.branch !== undefined && (typeof b.branch !== "string" || !SAFE_BRANCH.test(b.branch))) return { ok: false, error: "branch is not a safe git ref name" };
  const branch = (b.branch as string | undefined) ?? `node/${peer.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${now.toString(36)}`;
  return { ok: true, value: { peer, env, prompt: b.prompt, branch } };
}

/** `{ paneId, … }` from a POST body; the pane is a string herdr resolves, nothing more. */
function paneOf(b: Record<string, unknown>): string | null {
  return typeof b.paneId === "string" && b.paneId.trim() !== "" ? b.paneId : null;
}

/** What the routes do to this machine; the server wires the live herdr and git (see `liveNodeActions`). */
export interface NodeActions {
  reply: (paneId: string, text: string, submit: boolean) => Promise<{ ok: boolean; error?: string; textDelivered: boolean }>;
  keys: (paneId: string, keys: string[]) => Promise<void>;
  launch: (l: LaunchRequest) => Promise<LaunchedPane>;
  diff: (p: LaunchedPane, path: string | null, untracked: boolean) => Promise<unknown>;
  close: (paneId: string) => Promise<void>;
}

export interface NodeRouteDeps {
  node: NodeConfig | null;
  /** `checkAccess` at read level: the host allowlist and the trusted identity still stand in front. */
  access: () => Response | null;
  /** One audit line per call, the calling peer always in it: `node.read`, `node.denied`, `node.<action>`. */
  audit: (action: string, peer: string | null, detail: Record<string, unknown>) => void;
  /** The primary session's snapshot, `disconnected` included — the peer decides what to ignore. */
  snapshot: () => unknown;
  readPane: (paneId: string) => Promise<Response>;
  json: (data: unknown, status?: number) => Response;
  text: (body: string, status: number) => Response;
  actions: NodeActions;
  /** The owner's autonomy switch for a repo (ADR 0030): off, and no peer launches there. */
  autonomyOn: (repoPath: string) => boolean;
  /** The panes launched for peers since boot. */
  launched: Map<string, LaunchedPane>;
}

const NODE_PANE_ROUTE = /^\/api\/node\/pane\/([^/]+)$/;
const NODE_POST = new Set(["/api/node/reply", "/api/node/keys", "/api/node/launch", "/api/node/end"]);

/** The `/api/node/*` family. Returns null for any other path. */
export async function handleNodeRoute(pathname: string, req: Request, d: NodeRouteDeps): Promise<Response | null> {
  if (pathname !== "/api/node" && !pathname.startsWith("/api/node/")) return null;
  if (!d.node) return d.text("not found", 404);
  const denied = d.access();
  if (denied) return denied;
  const peer = peerFor(req.headers.get("authorization"), d.node.peers);
  if (!peer) {
    d.audit("node.denied", null, { route: pathname });
    return d.text("unauthorized", 401);
  }
  // The login seen at pairing is the one this token must come with (ADR 0049 §4, 0048 §5).
  const login = d.node.peers.find((p) => p.name === peer)?.login;
  if (login && req.headers.get("tailscale-user-login") !== login) {
    d.audit("node.denied", peer, { route: pathname, login: req.headers.get("tailscale-user-login") });
    return d.text("unauthorized", 401);
  }
  if (NODE_POST.has(pathname)) {
    if (req.method !== "POST") return d.text("method not allowed", 405);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return d.text("bad body", 400);
    }
    return nodeAction(pathname.slice("/api/node/".length), peer, body, d.node, d);
  }
  if (req.method !== "GET") return d.text("method not allowed", 405);
  // shortcut: one audit line per peer read; throttle here if ADR 0048's polling makes the log noisy.
  d.audit("node.read", peer, { route: pathname });

  if (pathname === "/api/node/snapshot") return d.json(d.snapshot());
  if (pathname === "/api/node/environments") {
    // Name and agent only: a peer names an environment, this machine resolves the path (ADR 0046 §2).
    return d.json({ node: d.node.name, environments: d.node.environments.map(({ name, agent }) => ({ name, agent })) });
  }
  if (pathname === "/api/node/diff") {
    const q = new URL(req.url).searchParams;
    const launched = d.launched.get(q.get("pane") ?? "");
    if (!launched) return d.text("not a pane launched for a peer", 404);
    // `diffFile` refuses an unsafe path (`isSafeDiffPath`); the checkout is this machine's, never the caller's.
    const diff = await d.actions.diff(launched, q.get("path"), q.get("untracked") === "1");
    return (diff as { ok?: boolean }).ok === false ? d.json(diff, 400) : d.json(diff);
  }
  const pane = NODE_PANE_ROUTE.exec(pathname);
  if (pane) return d.readPane(decodeURIComponent(pane[1]!));
  return d.text("not found", 404);
}

async function nodeAction(action: string, peer: string, body: unknown, node: NodeConfig, d: NodeRouteDeps): Promise<Response> {
  const b = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const refuse = (error: string, status: number, detail: Record<string, unknown> = {}) => {
    d.audit(`node.${action}`, peer, { ...detail, refused: error });
    return d.json({ ok: false, error }, status);
  };
  try {
    if (action === "launch") {
      const parsed = parseLaunch(body, node, peer);
      if (!parsed.ok) return refuse(parsed.error, 400, { environment: b.environment ?? null });
      const { env, branch } = parsed.value;
      if (!d.autonomyOn(env.repoPath)) {
        return refuse(`autonomy is off for environment "${env.name}" on ${node.name} — its owner keeps the hand`, 403, { environment: env.name });
      }
      const launched = await d.actions.launch(parsed.value);
      d.launched.set(launched.paneId, launched);
      d.audit("node.launch", peer, { environment: env.name, branch, paneId: launched.paneId, prompt: parsed.value.prompt });
      return d.json({ ok: true, paneId: launched.paneId, branch: launched.branch, environment: env.name });
    }

    const paneId = paneOf(b);
    if (!paneId) return refuse("paneId is required", 400);
    if (action === "reply") {
      if (b.text !== undefined && typeof b.text !== "string") return refuse("text must be a string", 400, { paneId });
      const text = (b.text as string | undefined) ?? "";
      const submit = b.submit !== false;
      const out = await d.actions.reply(paneId, text, submit);
      d.audit("node.reply", peer, { paneId, text, submit, submitted: out.ok, textDelivered: out.textDelivered });
      return d.json({ ok: out.ok, textDelivered: out.textDelivered, ...(out.error ? { error: out.error } : {}) });
    }
    if (action === "keys") {
      const keys = Array.isArray(b.keys) ? b.keys.filter((k): k is string => typeof k === "string") : [];
      if (keys.length === 0) return refuse("no keys", 400, { paneId });
      await d.actions.keys(paneId, keys);
      d.audit("node.keys", peer, { paneId, keys });
      return d.json({ ok: true });
    }
    // end: only the pane this machine launched for that same peer — never any other pane of the owner.
    const launched = d.launched.get(paneId);
    if (!launched || launched.peer !== peer) return refuse("not a pane launched for this peer", 404, { paneId });
    await d.actions.close(paneId);
    d.launched.delete(paneId);
    d.audit("node.end", peer, { paneId, environment: launched.environment, branch: launched.branch });
    return d.json({ ok: true });
  } catch (err) {
    return refuse((err as Error).message, 502);
  }
}

/** The live wiring: herdr for the panes, `git.ts` for the diff, `launchAgent` → `promptAndConfirm` for a launch. */
export function liveNodeActions(
  herdr: () => HerdrClient | null,
  reply: (h: HerdrClient, ...a: Parameters<NodeActions["reply"]>) => ReturnType<NodeActions["reply"]>,
): NodeActions {
  const h = () => {
    const c = herdr();
    if (!c) throw new Error("herdr is not connected");
    return c;
  };
  return {
    reply: (paneId, text, submit) => reply(h(), paneId, text, submit),
    keys: (paneId, keys) => h().sendPaneKeys(paneId, keys),
    close: (paneId) => h().closePane(paneId),
    diff: (p, path, untracked) => (path === null ? diffStat(p.checkoutPath, p.base) : diffFile(p.checkoutPath, p.base, path, { untracked })),
    launch: async ({ peer, env, prompt, branch }) => {
      const c = h();
      const base = (await defaultBranchOf(env.repoPath)) ?? null;
      const wt = await c.createWorktree({ cwd: env.repoPath, branch, base, label: `${peer}: ${prompt}`.slice(0, 40) });
      try {
        await launchAgent(c, wt.paneId, env.agent, agentNameFor(branch));
        await promptAndConfirm(c, wt.paneId, prompt, undefined, { firstAfterLaunch: true });
      } catch (err) {
        // A pane no peer can `end` would sit on the owner's machine: close it, keep the checkout.
        await c.closePane(wt.paneId).catch(() => {});
        throw err;
      }
      return { paneId: wt.paneId, peer, environment: env.name, branch, checkoutPath: wt.checkoutPath, base };
    },
  };
}
