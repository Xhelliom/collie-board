import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

// The peer surface (ADR 0046 §2 and §4, as revised by decision bed340b1: no central). Every machine
// is a full Collie with its board on; `/api/node/*` is one more, read-only surface the OTHER peers
// read, server to server, with a bearer token. The config is `<stateDir>/node.toml`, 0600, never in
// a repo: without it, or without a single token, the whole family is a 404 and nothing changes.
// The bridge still calls no one (ADR 0013) — reading the other peers is ADR 0048's.

/** A peer allowed to read this machine: its name is what the audit log records. */
export interface NodePeer {
  name: string;
  token: string;
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
 * token = "…"            # ≥ 32 chars, one per peer
 * [[environments]]
 * name = "arch-2"
 * repo_path = "/home/me/git/app"
 * agent = "claude"
 * ```
 */
export function parseNodeConfig(raw: unknown): NodeConfig | null {
  if (raw === null || typeof raw !== "object") throw new Error("node.toml must be a table");
  const r = raw as Record<string, unknown>;
  const name = str(r.name, "name");
  const peers = table(r.peers, "peers").map((p, i) => {
    const token = str(p.token, `peers[${i}].token`);
    if (token.length < MIN_TOKEN_LENGTH) throw new Error(`peers[${i}].token is shorter than ${MIN_TOKEN_LENGTH} characters`);
    return { name: str(p.name, `peers[${i}].name`), token };
  });
  if (new Set(peers.map((p) => p.token)).size !== peers.length) throw new Error("two peers share a token");
  const environments = table(r.environments, "environments").map((e, i) => {
    const repoPath = str(e.repo_path ?? e.repoPath, `environments[${i}].repo_path`);
    if (!isAbsolute(repoPath)) throw new Error(`environments[${i}].repo_path must be absolute`);
    return { name: str(e.name, `environments[${i}].name`), repoPath, agent: str(e.agent, `environments[${i}].agent`) };
  });
  if (new Set(environments.map((e) => e.name)).size !== environments.length) throw new Error("two environments share a name");
  return peers.length > 0 ? { name, peers, environments } : null;
}

/**
 * Read `<stateDir>/node.toml`. Absent → null, silently (the default). Unreadable, malformed, or
 * readable by group/others → null with a warning: every failure closes the surface.
 */
export function loadNodeConfig(stateDir: string): NodeConfig | null {
  const path = join(stateDir, "node.toml");
  try {
    // Windows has no POSIX modes; its inherited ACLs are accepted (ADR 0046 §7).
    if (process.platform !== "win32" && (statSync(path).mode & 0o077) !== 0) {
      console.warn(`[node] ${path} is readable by others — chmod 600 it; /api/node/* stays off`);
      return null;
    }
    return parseNodeConfig(Bun.TOML.parse(readFileSync(path, "utf8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    console.warn(`[node] ${path} ignored, /api/node/* stays off: ${(err as Error).message}`);
    return null;
  }
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * The peer a request's `authorization: Bearer <token>` belongs to, or null. Constant time: both sides
 * are hashed to the same length for `timingSafeEqual`, and every peer is compared, no early exit.
 */
export function peerFor(authorization: string | null, peers: readonly NodePeer[]): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? "");
  const given = digest(m?.[1] ?? "");
  let found: string | null = null;
  for (const p of peers) if (timingSafeEqual(given, digest(p.token)) && m) found = p.name;
  return found;
}

export interface NodeRouteDeps {
  node: NodeConfig | null;
  /** `checkAccess` at read level: the host allowlist and the trusted identity still stand in front. */
  access: () => Response | null;
  audit: (peer: string | null, route: string) => void;
  /** The primary session's snapshot, `disconnected` included — the peer decides what to ignore. */
  snapshot: () => unknown;
  readPane: (paneId: string) => Promise<Response>;
  json: (data: unknown) => Response;
  text: (body: string, status: number) => Response;
}

const NODE_PANE_ROUTE = /^\/api\/node\/pane\/([^/]+)$/;

/** The `/api/node/*` family. Returns null for any other path. */
export async function handleNodeRoute(pathname: string, req: Request, d: NodeRouteDeps): Promise<Response | null> {
  if (pathname !== "/api/node" && !pathname.startsWith("/api/node/")) return null;
  if (!d.node) return d.text("not found", 404);
  const denied = d.access();
  if (denied) return denied;
  const peer = peerFor(req.headers.get("authorization"), d.node.peers);
  // shortcut: one audit line per peer read; throttle here if ADR 0048's polling makes the log noisy.
  d.audit(peer, pathname);
  if (!peer) return d.text("unauthorized", 401);
  if (req.method !== "GET") return d.text("method not allowed", 405);

  if (pathname === "/api/node/snapshot") return d.json(d.snapshot());
  if (pathname === "/api/node/environments") {
    // Name and agent only: a peer names an environment, this machine resolves the path (ADR 0046 §2).
    return d.json({ node: d.node.name, environments: d.node.environments.map(({ name, agent }) => ({ name, agent })) });
  }
  const pane = NODE_PANE_ROUTE.exec(pathname);
  if (pane) return d.readPane(decodeURIComponent(pane[1]!));
  return d.text("not found", 404);
}
