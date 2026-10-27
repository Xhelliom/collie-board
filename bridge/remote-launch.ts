import { branchFromTitle, initialPrompt } from "./cards.ts";
import type { BoardDb, BoardEvent, Card, CardEnvironment } from "./db.ts";
import { normalizeRemote, originUrl } from "./git.ts";
import { PEER_NAME, peerCall, type OutboundPeer } from "./pairing.ts";

// A card that runs in a peer's environment (ADR 0046 §4, decision 77740d3b point 2). The card carries
// `{peer, name}`; its start goes to that peer's `POST /api/node/launch` instead of `launchAgent`, its
// diff and its end to `/api/node/diff` and `/api/node/end`. No session row: a pane id of another
// machine never sits where `reconcile()` would read it — the journal holds the launch, and only the
// peer that runs the pane reconciles it (ADR 0048 §4). No loop either: the peer is read on a tap.

/** The peer's launch creates a worktree, starts the agent and confirms its first prompt. */
const LAUNCH_TIMEOUT_MS = 120_000;

export const REMOTE_LAUNCHED = "card.remote_launched";
export const REMOTE_ENDED = "card.remote_ended";

/** `environment` from a card body: `{peer, name}`, or null for this machine. */
export function parseCardEnvironment(v: unknown): { ok: true; value: CardEnvironment | null } | { ok: false; error: string } {
  if (v === null) return { ok: true, value: null };
  const o = v as Partial<Record<string, unknown>> | undefined;
  if (typeof o !== "object" || Array.isArray(o) || Object.keys(o).some((k) => k !== "peer" && k !== "name")) {
    return { ok: false, error: "environment must be {peer, name} or null" };
  }
  if (typeof o.peer !== "string" || !PEER_NAME.test(o.peer) || typeof o.name !== "string" || !PEER_NAME.test(o.name)) {
    return { ok: false, error: "environment: peer and name are letters, digits, . _ -" };
  }
  return { ok: true, value: { peer: o.peer, name: o.name } };
}

/** An environment a paired peer offers, as its `/api/node/environments` says. */
export interface PeerEnvironment {
  peer: string;
  name: string;
  agent: string;
  remote: string | null;
}

/** The environments that run the repo whose normalised origin is `remote`. A repo with no origin matches none. */
export function environmentsForRemote(remote: string | null, envs: readonly PeerEnvironment[]): PeerEnvironment[] {
  return remote ? envs.filter((e) => e.remote === remote) : [];
}

export type LaunchRoute = { kind: "local" } | { kind: "peer"; peer: OutboundPeer; environment: string } | { kind: "refused"; error: string };

/** Where a card's start goes: here, the peer of its environment, or nowhere — never a fallback (ADR 0046 §4). */
export function launchRouteFor(environment: CardEnvironment | null, outbound: readonly OutboundPeer[]): LaunchRoute {
  if (!environment) return { kind: "local" };
  const peer = outbound.find((p) => p.name === environment.peer);
  return peer
    ? { kind: "peer", peer, environment: environment.name }
    : { kind: "refused", error: `${environment.name}: ${environment.peer} is not a paired peer of this machine` };
}

/** The card's session on a peer. */
export interface RemoteSession {
  peer: string;
  environment: string;
  paneId: string;
  branch: string;
}

/** The last launch on a peer not ended since, from the journal (newest first, as `listEvents` gives it). Pure. */
export function remoteSessionOf(events: readonly BoardEvent[]): RemoteSession | null {
  for (const e of events) {
    if (e.type === REMOTE_ENDED) return null;
    if (e.type !== REMOTE_LAUNCHED) continue;
    const p = e.payload as Partial<RemoteSession> | null;
    return typeof p?.peer === "string" && typeof p.paneId === "string"
      ? { peer: p.peer, environment: String(p.environment ?? ""), paneId: p.paneId, branch: String(p.branch ?? "") }
      : null;
  }
  return null;
}

/** A peer's answer turned into the reason the operator reads: who refused, and why. Pure. */
export function peerRefusal(peer: string, environment: string, r: { status: number; body: Record<string, unknown> | null } | { error: string }): string {
  if ("error" in r) return `${environment}: ${peer} unreachable (${r.error})`;
  const said = typeof r.body?.error === "string" ? r.body.error : null;
  if (r.status === 401) return `${environment}: ${peer} refused this machine's token — pair again`;
  if (r.status === 404 && !said) return `${environment}: ${peer} serves no peer surface (no peer declared there)`;
  return `${environment}: ${peer} refused — ${said ?? `HTTP ${r.status}`}`;
}

export interface RemoteDeps {
  db: BoardDb;
  fetch: typeof fetch;
  outbound: () => readonly OutboundPeer[];
  branchPrefix: string;
}

type Call = { status: number; body: Record<string, unknown> | null } | { error: string };

async function call(d: RemoteDeps, peer: OutboundPeer, route: string, opts?: Parameters<typeof peerCall>[3]): Promise<Call> {
  try {
    return await peerCall(d.fetch, peer, route, opts);
  } catch (err) {
    return { error: (err as Error).message };
  }
}

const ok = (r: Call): r is { status: 200; body: Record<string, unknown> } => !("error" in r) && r.status === 200 && r.body !== null;

/**
 * Start a card in its peer environment. Same "the board says no" gates as `startCard` that make sense
 * here (container, predecessor, already running); the rest — autonomy, the grant, the environment
 * itself — is the peer's to refuse, and its reason is journaled on the card.
 */
export async function startOnPeer(d: RemoteDeps, card: Card): Promise<{ ok: true; session: RemoteSession } | { ok: false; error: string; kind: "board" | "peer" }> {
  const route = launchRouteFor(card.environment, d.outbound());
  const failed = (error: string, kind: "board" | "peer", peer?: string) => {
    d.db.recordEvent(card.id, "card.start_failed", { stage: "peer", ...(peer ? { peer } : {}), environment: card.environment?.name ?? null, error });
    return { ok: false as const, error, kind };
  };
  if (route.kind === "local") throw new Error("startOnPeer: a local card");
  if (route.kind === "refused") return failed(route.error, "board", card.environment!.peer);
  const { peer, environment } = route;
  if (d.db.listChildren(card.id).length > 0) return failed("this card holds sub-tasks — start one of those", "board");
  const predecessor = card.dependsOn ? d.db.getCard(card.dependsOn) : null;
  if (predecessor && predecessor.status !== "done" && predecessor.status !== "archived") {
    return failed(`waiting on “${predecessor.title}” to finish first`, "board");
  }
  const running = remoteSessionOf(d.db.listEvents(card.id));
  if (running) return failed(`already running on ${running.peer} (${running.environment})`, "board", running.peer);

  const branch = card.branch ?? branchFromTitle(card.title, d.branchPrefix);
  const r = await call(d, peer, "/api/node/launch", { body: { environment, prompt: initialPrompt(card), branch }, timeoutMs: LAUNCH_TIMEOUT_MS });
  if (!ok(r) || typeof r.body.paneId !== "string") return failed(peerRefusal(peer.name, environment, r), "peer", peer.name);
  const session = { peer: peer.name, environment, paneId: r.body.paneId, branch: typeof r.body.branch === "string" ? r.body.branch : branch };
  d.db.recordEvent(card.id, REMOTE_LAUNCHED, session);
  d.db.setStatus(card.id, "working", `launched on ${peer.name} (${environment})`);
  return { ok: true, session };
}

function peerOf(d: RemoteDeps, s: RemoteSession): OutboundPeer | null {
  return d.outbound().find((p) => p.name === s.peer) ?? null;
}

/** End the card's session on its peer: the peer closes the pane it launched, the checkout stays there. */
export async function endOnPeer(d: RemoteDeps, card: Card): Promise<{ ok: true; session: RemoteSession } | { ok: false; error: string }> {
  const s = remoteSessionOf(d.db.listEvents(card.id));
  if (!s) return { ok: false, error: "no session running on a peer" };
  const peer = peerOf(d, s);
  if (!peer) return { ok: false, error: `${s.peer} is no longer a paired peer of this machine` };
  const r = await call(d, peer, "/api/node/end", { body: { paneId: s.paneId } });
  // 404: the peer no longer knows that pane (restarted, or closed there) — nothing is left to end.
  const gone = !("error" in r) && r.status === 404 && r.body !== null;
  if (!ok(r) && !gone) return { ok: false, error: peerRefusal(s.peer, s.environment, r) };
  d.db.recordEvent(card.id, REMOTE_ENDED, { ...s, ...(gone ? { gone: true } : {}) });
  return { ok: true, session: s };
}

/** The card's diff, read on its peer: the stat, or one file's patch. */
export async function diffOnPeer(d: RemoteDeps, s: RemoteSession, path: string | null, untracked: boolean): Promise<{ status: number; body: unknown }> {
  const peer = peerOf(d, s);
  if (!peer) return { status: 409, body: { ok: false, error: `${s.peer} is no longer a paired peer of this machine` } };
  const q = new URLSearchParams({ pane: s.paneId, ...(path !== null ? { path } : {}), ...(untracked ? { untracked: "1" } : {}) });
  const r = await call(d, peer, `/api/node/diff?${q}`);
  if (ok(r)) return { status: 200, body: { ok: true, ...r.body, ...(path !== null ? { path } : {}), peer: s.peer } };
  return { status: 502, body: { ok: false, error: peerRefusal(s.peer, s.environment, r), kind: "peer" } };
}

/** What the peer says of the card's pane, read once when the card is opened. Never written back. */
export async function remoteStateOf(d: RemoteDeps, s: RemoteSession): Promise<{ reachable: boolean; error?: string; pane: { status: string; agent: string | null } | null }> {
  const peer = peerOf(d, s);
  if (!peer) return { reachable: false, error: `${s.peer} is no longer a paired peer of this machine`, pane: null };
  const r = await call(d, peer, "/api/node/snapshot");
  if (!ok(r)) return { reachable: false, error: peerRefusal(s.peer, s.environment, r), pane: null };
  if (r.body.bridge === "disconnected") return { reachable: false, error: `${s.peer}: its herdr is disconnected`, pane: null };
  const panes = [...((r.body.agents as unknown[]) ?? []), ...((r.body.shellPanes as unknown[]) ?? [])] as { paneId?: unknown; status?: unknown; agent?: unknown }[];
  const p = panes.find((x) => x?.paneId === s.paneId);
  return { reachable: true, pane: p ? { status: String(p.status ?? "unknown"), agent: typeof p.agent === "string" ? p.agent : null } : null };
}

/** The paired peers' environments that run `repoPath` — same normalised origin. Read on a tap, every peer at once. */
export async function environmentsForRepo(d: Omit<RemoteDeps, "db" | "branchPrefix">, repoPath: string): Promise<{
  remote: string | null;
  environments: PeerEnvironment[];
  unreachable: { peer: string; error: string }[];
}> {
  const remote = normalizeRemote(await originUrl(repoPath));
  const unreachable: { peer: string; error: string }[] = [];
  const all = await Promise.all(
    d.outbound().map(async (peer) => {
      const r = await call(d as RemoteDeps, peer, "/api/node/environments");
      if (!ok(r) || !Array.isArray(r.body.environments)) {
        unreachable.push({ peer: peer.name, error: peerRefusal(peer.name, "environments", r) });
        return [];
      }
      return (r.body.environments as Record<string, unknown>[]).flatMap((e) =>
        typeof e?.name === "string" ? [{ peer: peer.name, name: e.name, agent: String(e.agent ?? ""), remote: typeof e.remote === "string" ? e.remote : null }] : [],
      );
    }),
  );
  return { remote, environments: environmentsForRemote(remote, all.flat()), unreachable };
}
