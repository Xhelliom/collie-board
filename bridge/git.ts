// Git for one card.
//
// A card owns a branch, and herdr gives that branch its own worktree — so "the diff for this card"
// needs no path bookkeeping and no per-file scoping: it is simply everything that checkout differs
// from its fork point by. That is the whole payoff of 1 card = 1 branch = 1 workspace.
//
// WHAT WE DIFF AGAINST. `git diff <base>...HEAD` (three dots) shows only COMMITTED work, and agents
// routinely leave a session with nothing committed — that diff would read empty while the checkout
// is full of changes. So we resolve the merge base once and diff the WORKING TREE against it. That
// covers committed and uncommitted work in one view, which is what "what has the agent written" means
// on a phone. Untracked files are listed separately, since `git diff` cannot see them at all.
//
// SECURITY. This is the only place the bridge shells out — `git`, and `gh` for the one PR call.
// Two rules hold it shut:
//   - every argument is passed as an argv element, never through a shell — no `sh -c`, ever;
//   - the client-supplied `path` is validated (no leading `-`, no traversal) and always follows a
//     `--` separator, so it can never be read as a git option.
// The repo path itself is server-side (it comes from the card), never from the request.
//
// WRITES. Everything above the `── integration ──` marker only reads. Below it, three calls change
// the world: a merge, a push, and a branch delete. Each one refuses before it acts rather than
// unwinding afterwards — see `checkIntegration`, which is the gate all three share.

import { join, resolve, sep } from "node:path";

/** Wall-clock cap on any git call. A pathological repo must not wedge the request. */
const GIT_TIMEOUT_MS = 15_000;

/** Cap on a single file diff handed to the phone. Beyond this you want a laptop anyway. */
const MAX_DIFF_BYTES = 512 * 1024;

/** One changed file in the card's diff. */
export interface DiffFile {
  path: string;
  added: number;
  removed: number;
  /** `binary` files report no line counts; `untracked` never reached the index. */
  kind: "text" | "binary" | "untracked";
}

export interface DiffStat {
  /** The commit the diff is measured from — the merge base with the card's base ref. */
  base: string;
  files: DiffFile[];
  added: number;
  removed: number;
}

export interface GitRunner {
  (args: string[], cwd: string): Promise<{ ok: boolean; stdout: string; stderr: string }>;
}

/** The real runner. Injectable so every parser below is testable without a repo on disk. */
export const runGit: GitRunner = async (args, cwd) => {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    // A git subprocess must never wait on a credential prompt or a pager — both hang forever
    // under a service with no tty.
    //
    // LC_ALL=C because we READ these messages. git is localised, and on a French system a conflict
    // announces itself as "CONFLIT", which the merge path's `/conflict/i` silently missed — so a
    // conflict was reported as a generic git failure, with no offer to hand it to the agent. Every
    // parser here now sees the same English git the tests do.
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_PAGER: "cat",
      PAGER: "cat",
      LC_ALL: "C",
      LANG: "C",
    },
  });
  const timer = setTimeout(() => proc.kill(), GIT_TIMEOUT_MS);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { ok: code === 0, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Parse `git worktree list --porcelain` into (path, branch) pairs.
 *
 * Records are blank-line separated; `branch` is a full ref (`refs/heads/board/x`) and is absent on a
 * detached checkout. Pure + exported: this output is how a card finds its checkout WITHOUT storing a
 * path that herdr could move under us.
 */
export function parseWorktreeList(stdout: string): { path: string; branch: string | null }[] {
  const out: { path: string; branch: string | null }[] = [];
  let current: { path: string; branch: string | null } | null = null;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) out.push(current);
      current = { path: line.slice("worktree ".length).trim(), branch: null };
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * The checkout directory for a card's branch, or null when the branch has no worktree.
 *
 * Derived on demand rather than stored: herdr owns where worktrees live, and a stored path is a
 * stored lie the first time that changes. This is one cheap subprocess on an on-demand route — it
 * never runs on the poll loop.
 */
export async function worktreePathFor(
  repoPath: string,
  branch: string,
  git: GitRunner = runGit,
): Promise<string | null> {
  const r = await git(["worktree", "list", "--porcelain"], repoPath);
  if (!r.ok) return null;
  return parseWorktreeList(r.stdout).find((w) => w.branch === branch)?.path ?? null;
}

/**
 * Parse `git diff --numstat`. Format is `<added>\t<removed>\t<path>`, with `-` in both count
 * columns for a binary file. Pure + exported.
 *
 * Rename records (`a => b`, or the `\0`-separated `-z` form) are NOT special-cased: the path is kept
 * verbatim, which reads fine and keeps the parser honest about what git printed.
 */
export function parseNumstat(stdout: string): DiffFile[] {
  const files: DiffFile[] = [];
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [a, r] = parts;
    const path = parts.slice(2).join("\t");
    const binary = a === "-" || r === "-";
    files.push({
      path,
      added: binary ? 0 : Number(a) || 0,
      removed: binary ? 0 : Number(r) || 0,
      kind: binary ? "binary" : "text",
    });
  }
  return files;
}

/**
 * Untracked paths from `git status --porcelain`. `git diff` is blind to these, and a brand-new file
 * is the single most common thing an agent produces — leaving them out would make the first diff of
 * most cards read "no changes". Pure + exported.
 */
export function parseUntracked(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((l) => l.startsWith("?? "))
    .map((l) => l.slice(3).trim())
    .filter(Boolean);
}

/**
 * The commit a card's work is measured from: the merge base of its base ref and HEAD, so a base
 * branch that moved on doesn't show up as the card's own changes. Falls back to the base ref itself
 * (a base that isn't an ancestor still gives a usable diff), then to HEAD (which diffs to nothing —
 * honest, and better than an error).
 */
export async function resolveBase(
  cwd: string,
  baseRef: string | null,
  git: GitRunner = runGit,
): Promise<string> {
  if (baseRef) {
    const merge = await git(["merge-base", baseRef, "HEAD"], cwd);
    if (merge.ok && merge.stdout.trim()) return merge.stdout.trim();
    const rev = await git(["rev-parse", "--verify", `${baseRef}^{commit}`], cwd);
    if (rev.ok && rev.stdout.trim()) return rev.stdout.trim();
  }
  return "HEAD";
}

/**
 * Does this branch still exist? A predecessor card's `branch` column outlives the branch itself —
 * cleanup after a merge (`deleteBranch`, below) removes the ref but never clears the card's own
 * row, since the row is also the record that the work landed. `startCard` forks a dependent card
 * from its predecessor's branch, so it needs to know before handing a deleted ref to
 * `worktree.create` as `base` — which fails immediately with `worktree_create_failed` otherwise.
 */
export async function branchExists(cwd: string, branch: string, git: GitRunner = runGit): Promise<boolean> {
  const r = await git(["rev-parse", "--verify", `${branch}^{commit}`], cwd);
  return r.ok;
}

/**
 * The board's own scratch directory — where the outgoing agent writes its handoff note. It is
 * plumbing, not the card's work, and it would otherwise sit at the top of every diff of a handed-off
 * card. Pure + exported for the test.
 */
export function isBoardPath(path: string): boolean {
  return path === ".board" || path.startsWith(".board/");
}

/** Everything the card's checkout differs from its fork point by, as a file list. */
export async function diffStat(
  cwd: string,
  baseRef: string | null,
  git: GitRunner = runGit,
): Promise<DiffStat> {
  const base = await resolveBase(cwd, baseRef, git);
  const [numstat, status] = await Promise.all([
    git(["diff", "--numstat", base], cwd),
    git(["status", "--porcelain"], cwd),
  ]);
  const files = numstat.ok ? parseNumstat(numstat.stdout).filter((f) => !isBoardPath(f.path)) : [];
  if (status.ok) {
    for (const path of parseUntracked(status.stdout)) {
      if (isBoardPath(path)) continue;
      files.push({ path, added: 0, removed: 0, kind: "untracked" });
    }
  }
  files.sort((a, b) => b.added + b.removed - (a.added + a.removed) || a.path.localeCompare(b.path));
  return {
    base,
    files,
    added: files.reduce((n, f) => n + f.added, 0),
    removed: files.reduce((n, f) => n + f.removed, 0),
  };
}

/**
 * Whether a client-supplied diff path is safe to hand to git.
 *
 * Rejects an option-looking argument (`--output=…`) even though every call site also uses `--`, and
 * rejects anything that escapes the checkout after resolution. Belt and braces on purpose: this is
 * the only string that reaches a subprocess from a request. Pure + exported.
 */
export function isSafeDiffPath(cwd: string, path: string): boolean {
  if (!path || path.startsWith("-")) return false;
  if (path.includes("\0")) return false;
  const full = resolve(cwd, path);
  return full === cwd || full.startsWith(cwd + sep);
}

/**
 * A unified diff for one file. An UNTRACKED file has nothing to diff against, so it is rendered
 * against the empty tree with `--no-index`, which produces a normal all-additions patch — the point
 * of the view is to read what the agent wrote, and "new file" is the most common case.
 */
export async function diffFile(
  cwd: string,
  baseRef: string | null,
  path: string,
  opts: { untracked?: boolean } = {},
  git: GitRunner = runGit,
): Promise<{ ok: true; diff: string; truncated: boolean } | { ok: false; error: string }> {
  if (!isSafeDiffPath(cwd, path)) return { ok: false, error: "bad path" };
  const r = opts.untracked
    ? // --no-index exits 1 when the files differ, which is the normal case here; judge it on output.
      await git(["diff", "--no-index", "--", "/dev/null", path], cwd)
    : await git(["diff", await resolveBase(cwd, baseRef, git), "--", path], cwd);
  if (!r.ok && r.stdout.trim() === "") {
    return { ok: false, error: r.stderr.trim() || "git diff failed" };
  }
  const truncated = r.stdout.length > MAX_DIFF_BYTES;
  return { ok: true, diff: truncated ? r.stdout.slice(0, MAX_DIFF_BYTES) : r.stdout, truncated };
}

/**
 * The worktree's own copy of one file, as text.
 *
 * A diff answers "what changed"; a generated report needs "what does it say", and the two part ways
 * the moment the file is a MODIFICATION rather than a new one — a patch then carries only its hunks,
 * which is half a document. So the reader reads the file, it does not un-prefix a patch.
 *
 * Same guard as {@link diffFile} and the same cap: `isSafeDiffPath` is the whole security surface
 * for a client-supplied path, and it is the only string here that comes from a request.
 */
export async function readWorktreeFile(
  cwd: string,
  path: string,
): Promise<{ ok: true; text: string; truncated: boolean } | { ok: false; error: string }> {
  if (!isSafeDiffPath(cwd, path)) return { ok: false, error: "bad path" };
  const file = Bun.file(resolve(cwd, path));
  if (!(await file.exists())) return { ok: false, error: "no such file in this worktree" };
  const truncated = file.size > MAX_DIFF_BYTES;
  return {
    ok: true,
    text: truncated ? await file.slice(0, MAX_DIFF_BYTES).text() : await file.text(),
    truncated,
  };
}

/**
 * A one-screen `--stat` summary of a {@link DiffStat}, as text — the copilot's review input (both
 * {@link cardDiffSummary} and {@link cwdDiffSummary} format through this one place). Pure + exported.
 */
export function formatDiffStat(stat: DiffStat): string {
  if (stat.files.length === 0) return "(no changes)";
  const lines = stat.files
    .slice(0, 100)
    .map((f) => `${f.path} | ${f.kind === "text" ? `+${f.added} -${f.removed}` : f.kind}`);
  if (stat.files.length > 100) lines.push(`… and ${stat.files.length - 100} more files`);
  lines.push(`${stat.files.length} files changed, ${stat.added} insertions(+), ${stat.removed} deletions(-)`);
  return lines.join("\n");
}

/**
 * The same stat as ONE push-body line — `3 files, +180 -12`. Null when nothing changed, so the
 * notification body's cascade (notify-subtitle.ts §3.3) falls through to nothing rather than
 * announcing an empty diff. Pure + exported; deliberately not {@link formatDiffStat}'s per-file
 * listing, which is a prompt's worth of text and a lock screen's worth of nothing.
 */
export function diffStatLine(stat: DiffStat): string | null {
  const n = stat.files.length;
  if (n === 0) return null;
  return `${n} file${n === 1 ? "" : "s"}, +${stat.added} -${stat.removed}`;
}

/**
 * A card's diff, measured in its worktree against its base ref. Null when the card has no branch or
 * no worktree on disk — there is nothing to measure, which is not the same as measuring zero.
 *
 * Explicitly NOT the full patch: every consumer wants the stat, and the full diff would burn the
 * quota the copilot is meant to be careful with.
 */
export async function cardDiffStat(
  db: { getCard(id: string): { repoPath: string | null; branch: string | null; baseRef: string | null } | null },
  cardId: string,
): Promise<DiffStat | null> {
  const card = db.getCard(cardId);
  if (!card?.repoPath || !card.branch) return null;
  const cwd = await worktreePathFor(card.repoPath, card.branch);
  if (!cwd) return null;
  return diffStat(cwd, card.baseRef);
}

/** That stat as the copilot's review input. A plain sentence when there is nothing to summarise, so
 *  the prompt never contains an empty section. */
export async function cardDiffSummary(
  db: { getCard(id: string): { repoPath: string | null; branch: string | null; baseRef: string | null } | null },
  cardId: string,
): Promise<string> {
  const stat = await cardDiffStat(db, cardId);
  return stat ? formatDiffStat(stat) : "(no worktree for this card)";
}

// ── integration ───────────────────────────────────────────────────────────────
//
// Where a card's branch stands against the branch it forked from, and the three writes that end it.
// Nothing here ever runs on its own: every one of them is a tap, on a card the operator has already
// decided is finished.

/** Where a card's branch stands relative to its base. */
export interface Integration {
  /** The branch the card owns. */
  branch: string;
  /** What it would be merged into — the card's `baseRef`, or the main checkout's current branch. */
  base: string;
  /** Commits on the branch that the base doesn't have. 0 means "nothing left to integrate". */
  ahead: number;
  /** Commits the base has that the branch doesn't. Only informative — a merge handles them. */
  behind: number;
  /** Uncommitted work in the MAIN checkout. A merge into a dirty tree is refused. */
  baseDirty: boolean;
  /**
   * Uncommitted work in the CARD's checkout.
   *
   * The loudest thing on this screen when it is true: the card's diff view shows working-tree
   * changes, so a card can look full of work while `ahead` is 0 — merging then integrates nothing,
   * and cleaning up afterwards would delete it.
   */
  branchDirty: boolean;
  /** The base branch is checked out in the main worktree, which a merge requires. */
  baseCheckedOut: boolean;
  /**
   * Every commit on this branch is also on its upstream — it has been pushed, so nothing here is
   * unrecoverable even once the checkout and the local branch are gone. False when the branch has no
   * upstream at all, which is where every branch starts.
   */
  pushed: boolean;
}

/**
 * Does `git status --porcelain` show work worth protecting?
 *
 * `.board/` is excluded for the same reason it is excluded from every diff (`isBoardPath`): it holds
 * the handoff and wrapup notes this bridge writes, so it is nearly always "untracked" in a card's
 * checkout. Counting it as work would refuse the cleanup of every finished card, forever — found
 * exactly that way, against a real worktree whose only change was `?? .board/`.
 *
 * Pure + exported. Handles the rename form (`R  old -> new`) by looking at the destination, which is
 * the path that would actually be lost.
 */
export function hasRealChanges(stdout: string): boolean {
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .some((line) => {
      const path = line.slice(2).trim();
      const arrow = path.lastIndexOf(" -> ");
      const target = (arrow === -1 ? path : path.slice(arrow + 4)).replace(/^"|"$/g, "");
      return target !== "" && !isBoardPath(target);
    });
}

/** What the board asks git to ignore, and the line that says why it is there. */
const EXCLUDE_PATTERN = ".board/";
const EXCLUDE_NOTE =
  "# Collie Board — handoff and wrapup notes it writes into card worktrees. Local only.";

/**
 * Teach this repository to ignore `.board/`, via `.git/info/exclude`.
 *
 * NOT the project's `.gitignore`, and not a commit. The notes belong to the board, not to the code:
 * committing them would carry them into the base branch on the first merge and make two cards that
 * both handed off conflict over a file that has nothing to do with either. And `.gitignore` is a
 * versioned file shared with everyone who clones — the board writes into repositories that have
 * never heard of it. `info/exclude` is git's own answer to exactly this: local, unversioned, one
 * line, and shared by every worktree of the repo (hence `--git-common-dir`, not `--git-dir`).
 *
 * Idempotent, and quiet on failure: a repo we cannot write to still works, it just keeps showing
 * `?? .board/`. Returns whether it actually added the line.
 */
export async function ensureBoardExcluded(repoPath: string, git: GitRunner = runGit): Promise<boolean> {
  // One try around everything, including the subprocess: this is fire-and-forget from `startCard`,
  // and NOTHING here is worth failing a start over — a repo we cannot write to simply keeps showing
  // `?? .board/`, which is where we were before.
  try {
    const dir = await git(["rev-parse", "--git-common-dir"], repoPath);
    if (!dir.ok || !dir.stdout.trim()) return false;
    // `--git-common-dir` answers relative to the repo when it can (".git"), absolute otherwise.
    const path = join(resolve(repoPath, dir.stdout.trim()), "info", "exclude");
    const file = Bun.file(path);
    const current = (await file.exists()) ? await file.text() : "";
    if (current.split("\n").some((l) => l.trim() === EXCLUDE_PATTERN)) return false;
    const prefix = current === "" || current.endsWith("\n") ? "" : "\n";
    await Bun.write(path, `${current}${prefix}${EXCLUDE_NOTE}\n${EXCLUDE_PATTERN}\n`);
    return true;
  } catch {
    return false;
  }
}

/** The main checkout's current branch, or null when detached / not a repo. */
export async function currentBranch(repoPath: string, git: GitRunner = runGit): Promise<string | null> {
  const r = await git(["rev-parse", "--abbrev-ref", "HEAD"], repoPath);
  const name = r.stdout.trim();
  return r.ok && name && name !== "HEAD" ? name : null;
}

/**
 * Parse `git rev-list --count --left-right <base>...<branch>`, whose output is `<behind>\t<ahead>`.
 * Pure + exported: getting these two the wrong way round would offer to merge nothing, or refuse a
 * cleanup that is perfectly safe.
 */
export function parseLeftRight(stdout: string): { behind: number; ahead: number } | null {
  const m = /^(\d+)\s+(\d+)$/.exec(stdout.trim());
  return m ? { behind: Number(m[1]), ahead: Number(m[2]) } : null;
}

/**
 * Where a card's branch stands. Read-only, and every failure degrades to "nothing to say" rather
 * than to an error: this rides the card view, and a repo that has moved under us must not turn the
 * card screen into a stack trace.
 */
export async function integrationOf(
  repoPath: string,
  branch: string,
  baseRef: string | null,
  git: GitRunner = runGit,
): Promise<Integration | null> {
  const head = await currentBranch(repoPath, git);
  const base = baseRef?.trim() || head;
  if (!base || base === branch) return null;

  const counts = await git(["rev-list", "--count", "--left-right", `${base}...${branch}`], repoPath);
  const parsed = counts.ok ? parseLeftRight(counts.stdout) : null;
  if (!parsed) return null;

  const [baseStatus, checkout, unpushed] = await Promise.all([
    git(["status", "--porcelain"], repoPath),
    worktreePathFor(repoPath, branch, git),
    // Fails outright when the branch has no upstream, which is the answer we want: nothing pushed.
    git(["rev-list", "--count", `${branch}@{upstream}..${branch}`], repoPath),
  ]);
  const branchStatus = checkout ? await git(["status", "--porcelain"], checkout) : null;

  return {
    branch,
    base,
    ahead: parsed.ahead,
    behind: parsed.behind,
    baseDirty: baseStatus.ok && hasRealChanges(baseStatus.stdout),
    branchDirty: (branchStatus?.ok && hasRealChanges(branchStatus.stdout)) ?? false,
    baseCheckedOut: head === base,
    pushed: unpushed.ok && unpushed.stdout.trim() === "0",
  };
}

export type IntegrationRefusal =
  | "no-branch"
  | "nothing-to-merge"
  | "branch-dirty"
  | "base-not-checked-out"
  | "not-merged";

/**
 * The shared gate. Every write below asks this first, and a refusal is a SENTENCE the card screen
 * shows — not an exception, and never something the operator discovers by finding their repository
 * in a state they didn't ask for.
 */
export function refusalFor(
  state: Integration | null,
  action: "merge" | "pr" | "cleanup",
): IntegrationRefusal | null {
  if (!state) return "no-branch";
  if (action === "merge") {
    if (state.ahead === 0) return "nothing-to-merge";
    if (state.branchDirty) return "branch-dirty";
    if (!state.baseCheckedOut) return "base-not-checked-out";
    // `baseDirty` is deliberately NOT a refusal, though it looks like one should be. Measured: git
    // merges happily over uncommitted changes it does not touch — which is the common case, since
    // the card worked in a different part of the tree — and preserves them. When the merge WOULD
    // overwrite them it refuses by itself, before changing anything, and names the files. It knows
    // the exact intersection; we would only be guessing at it, and guessing conservatively here
    // means refusing most merges for a collision that isn't there.
    return null;
  }
  if (action === "pr") {
    if (state.ahead === 0) return "nothing-to-merge";
    if (state.branchDirty) return "branch-dirty";
    return null;
  }
  // Cleanup deletes a checkout and a branch. `ahead > 0` means the base does not have these commits
  // — but "the base" is not the only place they can live: a pushed branch has them on its upstream,
  // which is exactly what the PR gesture leaves behind, and deleting a checkout of work that is
  // already on the remote loses nothing. That is also the rule `git branch -d` enforces one step
  // later (merged into HEAD *or its upstream*), so the two locks on this door now agree. A dirty
  // checkout stays a refusal either way: uncommitted work is on no remote.
  if (state.ahead > 0 && !state.pushed) return "not-merged";
  if (state.branchDirty) return "branch-dirty";
  return null;
}

/** Every refusal, as the sentence the phone shows. Pure + exported so the wording is reviewable. */
export function refusalMessage(reason: IntegrationRefusal, state: Integration | null): string {
  switch (reason) {
    case "no-branch":
      return "this card has no branch to integrate";
    case "nothing-to-merge":
      return `nothing to merge — ${state?.base ?? "the base"} already has every commit on this branch`;
    case "branch-dirty":
      return "the card's checkout has uncommitted work — commit it from the agent's pane first, or it will not be integrated";
    case "base-not-checked-out":
      return `the repository is not on ${state?.base ?? "the base"} right now — switch to it first, so a merge never moves the branch you are working on`;
    case "not-merged":
      return `${state?.ahead ?? "some"} commit(s) are on this branch and nowhere else — merge or open a PR before cleaning up`;
  }
}

/**
 * Merge the card's branch into its base, in the MAIN checkout.
 *
 * `--no-ff` on purpose: a card is a unit of work, and a merge commit is the only thing that says so
 * afterwards. On conflict it aborts immediately and reports git's own message — the operator is on a
 * phone and cannot resolve anything, so leaving a half-merged tree behind would be the worst
 * possible outcome of a tap.
 */
export async function mergeIntoBase(
  repoPath: string,
  branch: string,
  git: GitRunner = runGit,
): Promise<
  | { ok: true; stdout: string }
  | { ok: false; error: string; kind: "conflict" | "would-overwrite" | "other" }
> {
  const r = await git(["merge", "--no-ff", "--no-edit", "--", branch], repoPath);
  if (r.ok) return { ok: true, stdout: r.stdout.trim() };
  const out = `${r.stdout}\n${r.stderr}`;
  // Three outcomes, because each has a different next step and only the middle one is ours to fix:
  //   conflict        — the branch and the base disagree. The agent can settle it on its branch.
  //   would-overwrite — the merge collides with UNCOMMITTED work in the base. Only the person who
  //                     wrote it can decide what happens to it; git stopped before touching a byte.
  //   other           — anything else, reported verbatim.
  const kind = /conflict/i.test(out)
    ? "conflict"
    : /would be overwritten|Please commit your changes or stash/i.test(out)
      ? "would-overwrite"
      : "other";
  // Only a conflict leaves a merge in progress; the other two failed before starting. Harmless
  // either way — `merge --abort` on a repo with no merge in flight is a no-op.
  await git(["merge", "--abort"], repoPath);
  return { ok: false, error: (r.stderr || r.stdout).trim().split("\n").slice(0, 5).join("\n"), kind };
}

/** Push the card's branch and set its upstream. Needed before a PR can reference it. */
export async function pushBranch(
  repoPath: string,
  branch: string,
  git: GitRunner = runGit,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await git(["push", "--set-upstream", "origin", branch], repoPath);
  return r.ok ? { ok: true } : { ok: false, error: (r.stderr || r.stdout).trim().split("\n").slice(0, 4).join("\n") };
}

/**
 * Delete the card's branch, with `-d` rather than `-D`.
 *
 * The lowercase flag refuses a branch that is merged into neither HEAD nor its upstream — the same
 * rule `refusalFor` applies one step earlier, and the one lock on that door that git enforces rather
 * than us.
 */
export async function deleteBranch(
  repoPath: string,
  branch: string,
  git: GitRunner = runGit,
  /** `true` only on discard, where throwing the commits away IS the request. */
  force = false,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await git(["branch", force ? "-D" : "-d", "--", branch], repoPath);
  return r.ok ? { ok: true } : { ok: false, error: (r.stderr || r.stdout).trim().split("\n")[0] ?? "branch delete failed" };
}

/**
 * Remove a worktree checkout through git rather than through herdr.
 *
 * The fallback for a checkout herdr has no workspace for — a bridge restart, a workspace closed by
 * hand, a worktree that outlived the session that made it. Without it those are unreachable from the
 * phone forever: `git branch -d` refuses while a worktree holds the branch, and nothing else in the
 * app removes one. `--force` because a discard has already accepted losing what is in there.
 */
export async function removeWorktreeAt(
  repoPath: string,
  checkout: string,
  git: GitRunner = runGit,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await git(["worktree", "remove", "--force", "--", checkout], repoPath);
  return r.ok ? { ok: true } : { ok: false, error: (r.stderr || r.stdout).trim().split("\n")[0] ?? "worktree remove failed" };
}

/** The real `gh` runner. Same rules as {@link runGit}: argv only, hard timeout, no tty. */
export const runGh: GitRunner = async (args, cwd) => {
  const proc = Bun.spawn(["gh", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1", GH_PAGER: "cat" },
  });
  const timer = setTimeout(() => proc.kill(), GIT_TIMEOUT_MS);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { ok: code === 0, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
};

/** The PR url in `gh pr create`'s output, or null. It prints the url on its own line. Pure. */
export function parsePrUrl(stdout: string): string | null {
  const m = /https:\/\/\S*\/pull\/\d+/.exec(stdout);
  return m ? m[0] : null;
}

/**
 * Open a pull request for the card's branch. Assumes {@link pushBranch} has run.
 *
 * An EXISTING pr is a success, not an error: `gh` refuses to create a second one and says so, and
 * "there is already a PR for this branch" is exactly the outcome the operator wanted.
 */
export async function createPr(
  repoPath: string,
  input: { branch: string; base: string; title: string; body: string },
  gh: GitRunner = runGh,
): Promise<{ ok: true; url: string | null } | { ok: false; error: string }> {
  const r = await gh(
    [
      "pr",
      "create",
      "--base",
      input.base,
      "--head",
      input.branch,
      "--title",
      input.title,
      "--body",
      input.body,
    ],
    repoPath,
  );
  if (r.ok) return { ok: true, url: parsePrUrl(r.stdout) };
  const message = (r.stderr || r.stdout).trim();
  if (/already exists/i.test(message)) {
    const existing = await gh(["pr", "view", input.branch, "--json", "url", "--jq", ".url"], repoPath);
    return { ok: true, url: existing.ok ? existing.stdout.trim() || null : null };
  }
  return { ok: false, error: message.split("\n").slice(0, 4).join("\n") };
}

/**
 * What a card's pull request BECAME, as GitHub sees it. `mergedAt` is epoch ms, null unless merged.
 *
 * Deliberately not part of {@link Integration}: everything there is answered by local refs, this one
 * leaves the machine.
 */
export interface PrStatus {
  state: "open" | "merged" | "closed";
  url: string;
  mergedAt: number | null;
}

/**
 * Parse `gh pr view --json state,mergedAt,url`. Anything unrecognised is `null`, never a guess —
 * the card then keeps saying only what its journal knows.
 *
 * Pure + exported: this is the fragile half, so it is the half with a test.
 */
export function parsePrView(stdout: string): PrStatus | null {
  let raw: { state?: unknown; mergedAt?: unknown; url?: unknown };
  try {
    raw = JSON.parse(stdout) as typeof raw;
  } catch {
    return null;
  }
  // `gh` shouts them: OPEN / MERGED / CLOSED.
  const state = typeof raw.state === "string" ? raw.state.toLowerCase() : "";
  if (state !== "open" && state !== "merged" && state !== "closed") return null;
  if (typeof raw.url !== "string" || !raw.url) return null;
  const merged = typeof raw.mergedAt === "string" ? Date.parse(raw.mergedAt) : NaN;
  return { state, url: raw.url, mergedAt: Number.isFinite(merged) ? merged : null };
}

/**
 * Ask GitHub what the branch's pull request became. THE ONE NETWORK READ IN THIS MODULE.
 *
 * Never called from `integrationOf` and never from a poll — it is its own on-demand route, cached by
 * `prStatusFor` (integrate.ts), because half a second of network has no business in a section the
 * card screen renders on open.
 *
 * DEGRADES TO `null`, ALWAYS: no `gh` on PATH (Bun.spawn throws), not logged in, no GitHub remote,
 * no PR for this branch, offline. Same posture as the context gauge — no reading beats a wrong one.
 *
 * `gh pr view` takes exactly one positional and so cannot be given a `--` separator; `branch` is
 * usually the board's own slug, but it is a writable card field, so a leading `-` is refused here
 * rather than handed to a flag parser.
 */
export async function prStatusOf(
  repoPath: string,
  branch: string,
  gh: GitRunner = runGh,
): Promise<PrStatus | null> {
  if (!branch || branch.startsWith("-")) return null;
  try {
    const r = await gh(["pr", "view", branch, "--json", "state,mergedAt,url"], repoPath);
    return r.ok ? parsePrView(r.stdout) : null;
  } catch {
    return null;
  }
}
