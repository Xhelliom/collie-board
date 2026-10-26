// The shared board's sync consumer (ADR 0048 §3, lot 3): hung off `engine.onUpdate` like
// ContextTracker, NO timer of its own. It throttles itself per shared repo: one git operation in
// flight, a fetch at most every FETCH_EVERY_MS, a send on the tick after a local write at most every
// SEND_EVERY_MS. The plumbing is git.ts's; the projection is db.ts's; this only decides when.

import type { BoardDb, JournalEntry } from "./db.ts";
import { gitUserEmail, receiveJournal, sendJournal, type JournalFailure } from "./git.ts";
import type { Hlc } from "./journal.ts";
import type { EngineSnapshot } from "./state-engine.ts";

export const FETCH_EVERY_MS = 60_000;
export const SEND_EVERY_MS = 10_000;

/** One shared repo's sync state. In memory only: runtime state, never persisted. */
export interface RepoSync {
  busy: boolean;
  lastFetch: number;
  lastSend: number;
  /** A push was rejected (non-fast-forward): fetch, unite and send again on the next tick. */
  refetch: boolean;
  /** The remote was unreachable: nothing is sent until a fetch gets through again. */
  offline: boolean;
  /** The remote refused this pair's push (rights): the repo's entity writes are refused, with this reason. */
  readOnly: string | null;
  error: string | null;
}

const fresh = (): RepoSync => ({ busy: false, lastFetch: -Infinity, lastSend: -Infinity, refetch: false, offline: false, readOnly: null, error: null });

/**
 * What a repo's tick does: nothing, a send, or a fetch then a send. Pure, so the throttle is tested
 * with an injected clock. A fetch always ends in a send — that is what marks the fetched lines read,
 * and how an outbox held back by `offline` or `readOnly` gets retried, at the fetch's own pace.
 */
export function plan(s: RepoSync, now: number, unsent: number): { fetch: boolean } | null {
  if (s.busy) return null;
  if (s.refetch || now - s.lastFetch >= FETCH_EVERY_MS) return { fetch: true };
  if (unsent > 0 && !s.offline && !s.readOnly && now - s.lastSend >= SEND_EVERY_MS) return { fetch: false };
  return null;
}

/** The git half, injectable so the consumer is tested without a remote. */
export interface JournalGit {
  receive(repo: string, remote: string): Promise<{ ok: true; entries: JournalEntry[] } | JournalFailure>;
  send(repo: string, remote: string, pairId: string, outbox: JournalEntry[]): Promise<{ ok: true; pushed: boolean } | JournalFailure>;
  email(repo: string): Promise<string>;
}

const realGit: JournalGit = {
  receive: (repo, remote) => receiveJournal(repo, remote),
  send: (repo, remote, pairId, outbox) => sendJournal(repo, remote, pairId, outbox),
  email: (repo) => gitUserEmail(repo),
};

/** repo → its sync state. Module-level so the routes read it without wiring through server.ts. */
const states = new Map<string, RepoSync>();

/** A repo's sync as the project screen shows it, or null when the repo is not shared. */
export function journalStatus(db: BoardDb, path: string): { unsent: number; readOnly: string | null; offline: boolean; error: string | null } | null {
  if (!db.repoShare(path)) return null;
  const s = states.get(path) ?? fresh();
  return { unsent: db.journalUnsent(path), readOnly: s.readOnly, offline: s.offline, error: s.error };
}

export class JournalSync {
  private readonly emails = new Map<string, string>();

  constructor(
    private readonly db: BoardDb,
    private readonly clock: Hlc,
    private readonly git: JournalGit = realGit,
    private readonly now: () => number = Date.now,
  ) {}

  /** One tick. Returns the operations it started, so a test can await them; the hook does not. */
  update(snap: EngineSnapshot): Promise<void> {
    if (snap.bridge === "disconnected") return Promise.resolve();
    const ops: Promise<void>[] = [];
    for (const { path, remote } of this.db.sharedRepos()) {
      const s = states.get(path) ?? fresh();
      states.set(path, s);
      const p = plan(s, this.now(), this.db.journalUnsent(path));
      if (!p) continue;
      s.busy = true;
      ops.push(
        this.run(path, remote, s, p.fetch)
          .catch((err) => void (s.error = (err as Error).message))
          .finally(() => void (s.busy = false)),
      );
    }
    return Promise.all(ops).then(() => {});
  }

  private async run(repo: string, remote: string, s: RepoSync, fetch: boolean): Promise<void> {
    const t = this.now();
    if (fetch) {
      s.lastFetch = t;
      s.refetch = false;
      const r = await this.git.receive(repo, remote);
      if (!r.ok) return this.fail(s, r);
      s.offline = false;
      if (r.entries.length > 0) this.db.applyJournal(repo, r.entries, this.clock);
    }
    s.lastSend = t;
    if (!this.emails.has(repo)) this.emails.set(repo, (await this.git.email(repo)) || this.clock.pairId);
    const outbox = this.db.journalOutbox(repo, this.clock, this.emails.get(repo)!);
    const r = await this.git.send(repo, remote, this.clock.pairId, outbox);
    if (!r.ok) return this.fail(s, r);
    if (outbox.length > 0) this.db.dropJournalOutbox(repo, outbox.at(-1)!.seq);
    s.offline = false;
    s.readOnly = null;
    s.error = null;
  }

  private fail(s: RepoSync, f: JournalFailure): void {
    s.error = f.error;
    // No retry loop: each case waits for a later tick, which plan() paces.
    if (f.kind === "rejected") s.refetch = true;
    else if (f.kind === "unreachable") s.offline = true;
    else if (f.kind === "denied") s.readOnly = `read-only: the remote refused this pair's push — ${f.error}`;
  }
}

const ENTITY_PATH = /^\/api\/(cards|phases|runs)\/([^/]+)(\/deliverables)?/;

/**
 * Why a write request must be refused because it touches a read-only shared repo, or null. Reads the
 * repo from the entity in the path, `?repo=` and the body's `repoPath` / `cardId(s)` / `phaseId` —
 * every way a board write names its repo.
 */
// shortcut: a new write route naming its repo some other way slips through; test it here when one is added.
export async function readOnlyRefusal(pathname: string, req: Request, db: BoardDb): Promise<string | null> {
  if (req.method === "GET" || req.method === "HEAD" || ![...states.values()].some((s) => s.readOnly)) return null;
  const repos = new Set<string | null | undefined>();
  const m = ENTITY_PATH.exec(pathname);
  // A deliverable is the card's local store, not a journaled entity.
  if (m && !m[3]) repos.add(m[1] === "cards" ? db.getCard(m[2]!)?.repoPath : m[1] === "phases" ? db.getPhase(m[2]!)?.repoPath : db.getRun(m[2]!)?.repoPath);
  repos.add(new URL(req.url).searchParams.get("repo"));
  const body: unknown = await req.clone().json().catch(() => null);
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.repoPath === "string") repos.add(b.repoPath);
    if (typeof b.phaseId === "string") repos.add(db.getPhase(b.phaseId)?.repoPath);
    for (const id of [b.cardId, ...(Array.isArray(b.cardIds) ? b.cardIds : [])]) if (typeof id === "string") repos.add(db.getCard(id)?.repoPath);
  }
  // An unshared repo is never read-only, whatever a past push said.
  for (const r of repos) if (r && states.get(r)?.readOnly && db.repoShare(r)) return states.get(r)!.readOnly;
  return null;
}
