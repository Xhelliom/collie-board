// Which repositories can a card be started in?
//
// Typing `/home/you/code/some-project` on a phone keyboard is exactly the pain this whole project
// exists to remove, so the new-card sheet needs a LIST. The question is where that list comes from,
// and the answer is: three places that already know, none of which is a new table.
//
//   1. CARDS — `card.repo_path` is already persisted. Every repo you have ever carded is in there,
//      with the most recent first. This is the "remember what I used" store, and it exists.
//   2. THE HERD — every pane reports a `cwd`, and its enclosing repo is one `git rev-parse` away.
//      This covers a repo you have open right now but have never carded, and it self-heals: close
//      the workspace and it drops off by itself.
//   3. A SCAN ROOT (opt-in, `COLLIE_BOARD_REPO_ROOTS`) — for the cold start, where nothing is open
//      and nothing is carded yet.
//
// A dedicated `repo` table was the obvious move and is the wrong one: it would be a second copy of
// (1) with nothing to invalidate it, so a repo you move or delete stays in the picker forever. The
// derived list cannot go stale, because it is recomputed from things that are true.
//
// `workspace.worktree.repo_root` looked like the clean answer and isn't: live-verified on 0.7.5,
// herdr populates it for SOME workspaces and not others (one of four, in a herd where all four were
// git repos). Pane cwd is the field that is always there.

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import type { BoardDb } from "./db.ts";
import { runGit, type GitRunner } from "./git.ts";
import type { EngineSnapshot } from "./state-engine.ts";

/** How deep a scan root is walked looking for `.git`. Enough for `~/code/org/project`. */
const SCAN_DEPTH = 3;

/** Upper bound on scan results, so a scan root pointed at `/` can't hang the request. */
const SCAN_MAX = 200;

/** Directory names never worth descending into while hunting for repos. */
const SCAN_SKIP = new Set(["node_modules", ".git", "target", "dist", "build", ".cache", "vendor"]);

/**
 * Where people keep repositories, when nobody has said.
 *
 * This is the COLD START, and it is the case that actually matters: a fresh install has no cards,
 * and if herdr is empty it has no pane cwds either — so without this the picker would be blank on
 * the very first card, which is the worst possible moment to hand someone a text field.
 *
 * Cheap enough to do unconditionally: measured at 12 ms for 27 repos across `~/git` (depth 3, with
 * the skip list above). Only directories that exist are walked.
 */
const CONVENTIONAL_ROOTS = ["git", "code", "dev", "src", "projects", "work", "repos", "Documents/GitHub"];

/**
 * The scan roots to walk: the operator's if they configured any, otherwise the conventional ones
 * that exist. Explicit config REPLACES the defaults rather than adding to them — someone who names
 * their roots has said where to look, and quietly walking `~/code` as well would be ignoring them.
 *
 * Pure given `exists`, so the precedence is testable without a filesystem.
 */
export function scanRootsFor(
  configured: string[],
  home: string,
  exists: (path: string) => boolean,
): string[] {
  if (configured.length > 0) return configured;
  return CONVENTIONAL_ROOTS.map((r) => join(home, r)).filter(exists);
}

export interface RepoChoice {
  /** Absolute path of the repository root. */
  path: string;
  /** Last path segment — what the picker shows. */
  name: string;
  /** Where we learned about it. `card` sorts first: it's what you actually work on. */
  source: "card" | "herd" | "scan";
  /** For `card`, the newest `updated_at` among cards using it — drives the ordering. */
  lastUsedAt?: number;
  /** The repo's default branch, when it could be resolved. Pre-fills the card's base ref. */
  defaultBranch?: string;
  /**
   * The operator hid this one. A DECISION, not a fact — it is the single thing about a repo that
   * cannot be derived from cards, the herd or the disk, which is exactly why it is the only thing
   * stored (see `repo_pref` in db.ts).
   */
  hidden?: boolean;
}

/**
 * Merge the three sources into one ordered list.
 *
 * Order is the whole UX: what you carded most recently, then what is open in the herd, then the
 * scan. First entry is the one the sheet pre-selects, so it has to be the likely answer.
 *
 * Pure + exported — the precedence and de-duplication rules are the part worth pinning down.
 */
export function mergeRepoChoices(
  cards: { path: string; lastUsedAt: number }[],
  herd: string[],
  scan: string[],
): RepoChoice[] {
  const byPath = new Map<string, RepoChoice>();

  // Cards first, newest-used first, so the ordering survives the later sources.
  for (const { path, lastUsedAt } of [...cards].sort((a, b) => b.lastUsedAt - a.lastUsedAt)) {
    if (!byPath.has(path)) byPath.set(path, { path, name: basename(path), source: "card", lastUsedAt });
  }
  // A repo that is BOTH carded and open stays "card" — the stronger signal wins.
  for (const path of herd) {
    if (!byPath.has(path)) byPath.set(path, { path, name: basename(path), source: "herd" });
  }
  for (const path of scan) {
    if (!byPath.has(path)) byPath.set(path, { path, name: basename(path), source: "scan" });
  }
  return [...byPath.values()];
}

/** Last path segment, tolerating a trailing slash. Pure. */
export function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  // "/" trims to "" — never a real repo root, but a picker entry with an empty label would be a
  // mystery button, so fall back to the path itself.
  if (trimmed === "") return path;
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
}

/**
 * The CANONICAL repository root containing `cwd`, or null when it isn't in one.
 *
 * Two problems, one answer:
 *  - a pane's cwd drifts as the agent works, so it is routinely several levels below the root;
 *  - a pane sitting in a CARD'S OWN WORKTREE would otherwise show up as a separate repository, and
 *    offering "start a card in another card's worktree" is offering a foot-gun.
 *
 * `--git-common-dir` solves both: it is the SHARED git directory, so a linked worktree and its
 * source repo both report `<main-repo>/.git` (live-verified 2026-07-28). Strip `/.git` and a card's
 * worktree collapses onto the repo it came from, which is the entry you actually want.
 *
 * Falls back to `--show-toplevel` when the common dir isn't a plain `<root>/.git` — a separate
 * git-dir or a bare repo, where the derivation wouldn't name a working tree.
 */
export async function repoRootOf(cwd: string, git: GitRunner = runGit): Promise<string | null> {
  const top = await git(["rev-parse", "--show-toplevel"], cwd);
  const toplevel = top.stdout.trim();
  if (!top.ok || !toplevel) return null;
  const common = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
  const dir = common.ok ? common.stdout.trim() : "";
  return dir.endsWith("/.git") ? dir.slice(0, -"/.git".length) : toplevel;
}

/**
 * A repo's default branch — what a new card should fork from.
 *
 * `origin/HEAD` is asked first and is the one that's right: the repo's own HEAD is whatever branch
 * happens to be checked out, which after a single card is a `board/…` branch, and forking the next
 * card off that would silently chain unrelated work. The current branch is only the fallback for a
 * repo with no remote.
 */
export async function defaultBranchOf(root: string, git: GitRunner = runGit): Promise<string | undefined> {
  const remote = await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], root);
  if (remote.ok && remote.stdout.trim()) return remote.stdout.trim().replace(/^origin\//, "");
  for (const candidate of ["main", "master"]) {
    const verify = await git(["rev-parse", "--verify", "--quiet", `refs/heads/${candidate}`], root);
    if (verify.ok && verify.stdout.trim()) return candidate;
  }
  const head = await git(["rev-parse", "--abbrev-ref", "HEAD"], root);
  const branch = head.stdout.trim();
  return head.ok && branch && branch !== "HEAD" ? branch : undefined;
}

/** Walk a root looking for `.git`, bounded in depth, breadth and total results. */
async function scanRoot(root: string, out: Set<string>): Promise<void> {
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > SCAN_DEPTH || out.size >= SCAN_MAX) return;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return; // unreadable directory — not our problem to report
    }
    if (entries.includes(".git")) {
      out.add(dir);
      return; // a repo's subdirectories are its own business; nested repos aren't worth the walk
    }
    for (const entry of entries) {
      if (out.size >= SCAN_MAX) return;
      if (entry.startsWith(".") || SCAN_SKIP.has(entry)) continue;
      const child = join(dir, entry);
      try {
        if ((await stat(child)).isDirectory()) await walk(child, depth + 1);
      } catch {
        continue;
      }
    }
  };
  await walk(root, 0);
}

/**
 * The pickable repositories, freshest first.
 *
 * On-demand only: this shells out once per distinct pane cwd and optionally walks a directory tree,
 * which is fine for a sheet the user just opened and would be absurd on the 1.5 s poll.
 */
export async function listRepos(
  db: BoardDb,
  snap: EngineSnapshot,
  scanRoots: string[],
  git: GitRunner = runGit,
): Promise<RepoChoice[]> {
  const hidden = db.hiddenRepos();
  // 1. Cards — already persisted, newest first.
  const carded = new Map<string, number>();
  for (const card of db.listCards({ includeArchived: true })) {
    if (!card.repoPath) continue;
    carded.set(card.repoPath, Math.max(carded.get(card.repoPath) ?? 0, card.updatedAt));
  }

  // 2. The herd — one `rev-parse` per DISTINCT cwd, not per pane.
  const cwds = new Set([...snap.agents, ...snap.shellPanes].map((p) => p.cwd).filter(Boolean));
  const roots = await Promise.all([...cwds].map((cwd) => repoRootOf(cwd, git).catch(() => null)));
  const herd = roots.filter((r): r is string => r !== null);

  // 3. The scan. Roots are resolved by the CALLER (scanRootsFor) — this function must not reach for
  //    homedir() or the filesystem on its own, or its own tests start finding the machine's repos.
  const scanned = new Set<string>();
  for (const root of scanRoots) await scanRoot(root, scanned);

  const choices = mergeRepoChoices(
    [...carded].map(([path, lastUsedAt]) => ({ path, lastUsedAt })),
    herd,
    [...scanned],
  );

  for (const choice of choices) {
    if (hidden.has(choice.path)) choice.hidden = true;
  }

  // Resolve default branches in parallel — it pre-fills the card's base ref, which is the OTHER
  // field nobody wants to type on a phone. Best-effort: an unresolvable one just stays blank.
  // Only for the ones that will actually be offered — a hidden repo's base ref is never used, and on
  // a machine with 200 repos that is 200 subprocesses saved.
  await Promise.all(
    choices
      .filter((c) => !c.hidden)
      .map(async (choice) => {
        choice.defaultBranch = await defaultBranchOf(choice.path, git).catch(() => undefined);
      }),
  );
  return choices;
}
