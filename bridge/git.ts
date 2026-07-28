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
// SECURITY. This is the only place the bridge shells out. Two rules hold it shut:
//   - every argument is passed as an argv element, never through a shell — no `sh -c`, ever;
//   - the client-supplied `path` is validated (no leading `-`, no traversal) and always follows a
//     `--` separator, so it can never be read as a git option.
// The repo path itself is server-side (it comes from the card), never from the request.

import { resolve, sep } from "node:path";

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
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat", PAGER: "cat" },
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
 * A one-screen `--stat` summary of a card's diff, as text — the copilot's review input.
 *
 * Explicitly NOT the full diff: the stat is enough to judge drift from the acceptance criteria, and
 * the full patch would burn the quota the copilot is meant to be careful with. Returns a plain
 * sentence when there is nothing to summarise, so the prompt never contains an empty section.
 */
export async function cardDiffSummary(
  db: { getCard(id: string): { repoPath: string | null; branch: string | null; baseRef: string | null } | null },
  cardId: string,
): Promise<string> {
  const card = db.getCard(cardId);
  if (!card?.repoPath || !card.branch) return "(no branch for this card)";
  const cwd = await worktreePathFor(card.repoPath, card.branch);
  if (!cwd) return "(no worktree for this card)";
  const stat = await diffStat(cwd, card.baseRef);
  if (stat.files.length === 0) return "(no changes on this branch)";
  const lines = stat.files
    .slice(0, 100)
    .map((f) => `${f.path} | ${f.kind === "text" ? `+${f.added} -${f.removed}` : f.kind}`);
  if (stat.files.length > 100) lines.push(`… and ${stat.files.length - 100} more files`);
  lines.push(`${stat.files.length} files changed, ${stat.added} insertions(+), ${stat.removed} deletions(-)`);
  return lines.join("\n");
}
