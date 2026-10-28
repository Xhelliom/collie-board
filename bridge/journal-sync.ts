// The shared board's sync consumer (ADR 0048 §3, lot 3): hung off `engine.onUpdate` like
// ContextTracker, NO timer of its own. It throttles itself per shared repo: one git operation in
// flight, a fetch at most every FETCH_EVERY_MS, a send on the tick after a local write at most every
// SEND_EVERY_MS. The plumbing is git.ts's; the projection is db.ts's; this only decides when.

import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { writeSafetyBackup } from "./backup.ts";
import { PANE_HEADER, type BoardContext } from "./board-routes.ts";
import type { BoardDb, JournalEntry } from "./db.ts";
import {
  forgetJournal,
  gitRemotes,
  gitUserEmail,
  journalBranchOn,
  journalWasShared,
  ownJournal,
  receiveJournal,
  sendJournal,
  type JournalFailure,
} from "./git.ts";
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
  /**
   * The remote branch was rewritten to a state that does not descend from the last one known
   * (force-push). Sends are held until the operator resends this pair's journal: a send would build
   * on the rewritten tree and drop from JOURNAL_REF the very lines the resend reads back.
   */
  rewritten: boolean;
  error: string | null;
}

const fresh = (): RepoSync => ({ busy: false, lastFetch: -Infinity, lastSend: -Infinity, refetch: false, offline: false, readOnly: null, rewritten: false, error: null });

/**
 * What a repo's tick does: nothing, a send, or a fetch then a send. Pure, so the throttle is tested
 * with an injected clock. A fetch always ends in a send — that is what marks the fetched lines read,
 * and how an outbox held back by `offline` or `readOnly` gets retried, at the fetch's own pace.
 */
export function plan(s: RepoSync, now: number, unsent: number): { fetch: boolean } | null {
  if (s.busy) return null;
  if (s.refetch || now - s.lastFetch >= FETCH_EVERY_MS) return { fetch: true };
  if (unsent > 0 && !s.offline && !s.readOnly && !s.rewritten && now - s.lastSend >= SEND_EVERY_MS) return { fetch: false };
  return null;
}

/** The git half, injectable so the consumer is tested without a remote. */
export interface JournalGit {
  receive(repo: string, remote: string): Promise<{ ok: true; entries: JournalEntry[]; rewritten?: true } | JournalFailure>;
  send(repo: string, remote: string, pairId: string, outbox: JournalEntry[], message?: string): Promise<{ ok: true; pushed: boolean } | JournalFailure>;
  email(repo: string): Promise<string>;
  remotes(repo: string): Promise<string[]>;
  /** Forget what was read, so the next receive is the whole journal. */
  forget(repo: string): Promise<void>;
  /** Every line this pair wrote, read back from its own journal ref. */
  own(repo: string, pairId: string): Promise<JournalEntry[]>;
}

const realGit: JournalGit = {
  receive: (repo, remote) => receiveJournal(repo, remote),
  send: (repo, remote, pairId, outbox, message) => sendJournal(repo, remote, pairId, outbox, undefined, message),
  email: (repo) => gitUserEmail(repo),
  remotes: (repo) => gitRemotes(repo),
  forget: (repo) => forgetJournal(repo),
  own: (repo, pairId) => ownJournal(repo, pairId),
};

/** repo → its sync state. Module-level so the routes read it without wiring through server.ts. */
const states = new Map<string, RepoSync>();

/** A repo's sync as the project screen shows it, or null when the repo is not shared. */
export function journalStatus(
  db: BoardDb,
  path: string,
): { unsent: number; readOnly: string | null; offline: boolean; rewritten: boolean; error: string | null } | null {
  if (!db.repoShare(path)) return null;
  const s = states.get(path) ?? fresh();
  return { unsent: db.journalUnsent(path), readOnly: s.readOnly, offline: s.offline, rewritten: s.rewritten, error: s.error };
}

/** The running consumer, so the share route reaches its clock and its throttle without wiring through server.ts. */
let live: JournalSync | null = null;

export type Activation =
  | { ok: true; backup: string; existed: boolean; imported: number; pushed: boolean; error: string | null }
  | { ok: false; error: string };

export class JournalSync {
  private readonly emails = new Map<string, string>();

  constructor(
    private readonly db: BoardDb,
    private readonly clock: Hlc,
    private readonly git: JournalGit = realGit,
    private readonly now: () => number = Date.now,
  ) {
    live = this;
  }

  /**
   * § 6: share a repo's board on `remote`. A backup first, then the WHOLE journal is fetched: absent,
   * every local entity is imported and the orphan branch created by the « import » commit; present,
   * the projection is rebuilt from it — the journal wins on what it knows, edits made here while
   * unshared are lost (the backup keeps them) — then the entities it does not know are imported.
   */
  async activate(repo: string, remote: string, backup: () => Promise<string>): Promise<Activation> {
    const s = states.get(repo) ?? fresh();
    if (s.busy) return { ok: false, error: "a sync of this repo is in flight — try again in a moment" };
    if (!(await this.git.remotes(repo)).includes(remote)) return { ok: false, error: `no remote named ${remote} in this repo` };
    states.set(repo, s);
    s.busy = true;
    try {
      const saved = await backup();
      await this.git.forget(repo);
      const r = await this.git.receive(repo, remote);
      // Nothing is shared when the journal cannot be read: activating blind would import over it.
      if (!r.ok) return { ok: false, error: r.error };
      Object.assign(s, fresh(), { busy: true, lastFetch: this.now() });
      await this.identity(repo);
      this.db.setRepoShare(repo, remote);
      this.db.rebuildJournal(repo, r.entries, this.clock);
      const imported = this.db.importJournal(repo);
      const pushed = await this.send(repo, remote, s, `collie-board: import of ${imported} entities from ${this.clock.pairId}`);
      return { ok: true, backup: saved, existed: r.entries.length > 0, imported, pushed, error: s.error };
    } finally {
      s.busy = false;
    }
  }

  /** § 6: stop sharing. The outbox is dropped (returned: « N changements ne partiront pas »); the remote branch is not touched. */
  deactivate(repo: string): number {
    const dropped = this.db.journalUnsent(repo);
    this.db.setRepoShare(repo, null);
    states.delete(repo);
    return dropped;
  }

  /**
   * « Renvoyer mon journal » — the operator's repair once the remote branch was force-pushed to an
   * older state: every line this pair ever wrote is read back from its own journal ref and sent again
   * with the outbox, after a fetch. Never forced, and idempotent: a line already on the remote is not
   * added twice. It also releases the sends a detected rewrite held.
   */
  async resend(repo: string): Promise<{ ok: true; lines: number } | { ok: false; error: string }> {
    const remote = this.db.repoShare(repo);
    if (!remote) return { ok: false, error: "this repo's board is not shared" };
    const s = states.get(repo) ?? fresh();
    if (s.busy) return { ok: false, error: "a sync of this repo is in flight — try again in a moment" };
    states.set(repo, s);
    s.busy = true;
    try {
      const own = await this.git.own(repo, this.clock.pairId);
      await this.run(repo, remote, s, true, own);
      return s.error ? { ok: false, error: s.error } : { ok: true, lines: own.length };
    } catch (err) {
      return { ok: false, error: (s.error = (err as Error).message) };
    } finally {
      s.busy = false;
    }
  }

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

  private async run(repo: string, remote: string, s: RepoSync, fetch: boolean, own?: JournalEntry[]): Promise<void> {
    const t = this.now();
    if (fetch) {
      s.lastFetch = t;
      s.refetch = false;
      const r = await this.git.receive(repo, remote);
      if (!r.ok) return this.fail(s, r);
      s.offline = false;
      if (r.rewritten) s.rewritten = true;
      // Unshared while the fetch was out: what it brought is no longer this repo's to apply.
      if (this.db.repoShare(repo) !== remote) return;
      if (r.entries.length > 0) this.db.applyJournal(repo, r.entries, this.clock);
    }
    if (s.rewritten && !own) return;
    await this.send(repo, remote, s, undefined, own);
  }

  /** This clone's git identity, read once: the `by` of its lines (the pair id when unset) and its cards' `createdBy`. */
  private async identity(repo: string): Promise<void> {
    const email = await this.git.email(repo);
    this.db.setPeerIdentity(repo, email);
    this.emails.set(repo, email || this.clock.pairId);
  }

  /** Push the outbox; true when a commit went out. A failure is recorded on `s` for plan() to pace. */
  private async send(repo: string, remote: string, s: RepoSync, message?: string, own?: JournalEntry[]): Promise<boolean> {
    s.lastSend = this.now();
    if (!this.emails.has(repo)) await this.identity(repo);
    const outbox = this.db.journalOutbox(repo, this.clock, this.emails.get(repo)!);
    const r = await this.git.send(repo, remote, this.clock.pairId, [...(own ?? []), ...outbox], message);
    if (!r.ok) {
      this.fail(s, r);
      return false;
    }
    if (outbox.length > 0) this.db.dropJournalOutbox(repo, outbox.at(-1)!.seq);
    s.offline = false;
    s.readOnly = null;
    if (own) s.rewritten = false;
    s.error = null;
    return r.pushed;
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

/** `/api/repos/share` — a repo's shared board (ADR 0048 §1, §6): GET its state, POST `{path, remote}` to share it, `remote: null` to stop. */
const SHARE_ROUTE = "/api/repos/share";

/**
 * The operator's gesture, and the only writer of `repo_pref.share`: refused to an agent pane (an agent
 * that could share would carry the board off to a remote nobody chose), write-gated, audited. Nothing
 * here reads the repo's own config; the remote branch is only reported (`branch`), never acted on.
 */
export async function handleShareRoute(pathname: string, req: Request, ctx: BoardContext): Promise<Response | null> {
  if (pathname === RESEND_ROUTE) return resendRoute(req, ctx);
  if (pathname !== SHARE_ROUTE) return null;
  if (req.method === "GET") {
    const denied = ctx.guard("read");
    if (denied) return denied;
    const url = new URL(req.url);
    const repo = url.searchParams.get("repo");
    if (!repo || !isAbsolute(repo) || !existsSync(join(repo, ".git"))) return ctx.text("repo must be the root of a repository", 400);
    const share = ctx.db.repoShare(repo);
    const remotes = await gitRemotes(repo);
    const asked = url.searchParams.get("remote") ?? share ?? (remotes.includes("origin") ? "origin" : remotes[0]);
    return ctx.json({
      share,
      remotes,
      remote: asked ?? null,
      // On demand only (the settings fold opens): one ls-remote, never on the poll.
      branch: asked && remotes.includes(asked) ? await journalBranchOn(repo, asked) : null,
      wasShared: await journalWasShared(repo),
      identity: await gitUserEmail(repo),
      sync: journalStatus(ctx.db, repo),
    });
  }
  if (req.method !== "POST") return ctx.text("method not allowed", 405);
  if (req.headers.get(PANE_HEADER)?.trim()) return ctx.text("sharing the board is the operator's setting — an agent pane may not change it", 403);
  const denied = ctx.guard("write");
  if (denied) return denied;
  const body: unknown = await req.json().catch(() => null);
  const { path, remote } = (body ?? {}) as { path?: unknown; remote?: unknown };
  if (typeof path !== "string" || !isAbsolute(path) || !existsSync(join(path, ".git"))) return ctx.text("path must be the root of a repository", 400);
  if (remote !== null && typeof remote !== "string") return ctx.text("remote must be a remote name or null", 400);
  if (!live) return ctx.json({ ok: false, error: "the journal sync is not running", kind: "disabled" }, 503);
  if (remote === null) {
    const dropped = live.deactivate(path);
    ctx.audit.record({ action: "repo.share", session: ctx.session, device: ctx.device, detail: { path, remote: null, dropped } });
    return ctx.json({ ok: true, dropped });
  }
  const r = await live.activate(path, remote, () => writeSafetyBackup(ctx.db, ctx.cfg.stateDir));
  ctx.audit.record({ action: "repo.share", session: ctx.session, device: ctx.device, detail: { path, remote, ok: r.ok } });
  return ctx.json(r, r.ok ? 200 : 409);
}

/** `/api/repos/share/resend` — POST `{path}`: « Renvoyer mon journal » (ADR 0048 §3). */
const RESEND_ROUTE = "/api/repos/share/resend";

/** The operator's repair, refused to an agent pane like the share switch: it pushes to the remote. */
async function resendRoute(req: Request, ctx: BoardContext): Promise<Response> {
  if (req.method !== "POST") return ctx.text("method not allowed", 405);
  if (req.headers.get(PANE_HEADER)?.trim()) return ctx.text("resending the journal is the operator's gesture — an agent pane may not", 403);
  const denied = ctx.guard("write");
  if (denied) return denied;
  const { path } = ((await req.json().catch(() => null)) ?? {}) as { path?: unknown };
  if (typeof path !== "string" || !isAbsolute(path) || !existsSync(join(path, ".git"))) return ctx.text("path must be the root of a repository", 400);
  if (!live) return ctx.json({ ok: false, error: "the journal sync is not running", kind: "disabled" }, 503);
  const r = await live.resend(path);
  ctx.audit.record({ action: "repo.share.resend", session: ctx.session, device: ctx.device, detail: { path, ...r } });
  return ctx.json(r, r.ok ? 200 : 409);
}
