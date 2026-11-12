// The repo's default model for a CLI whose TUI takes no model flag but reads it from a config file
// found walking up from where it starts (OpenCode: `opencode.json`, adapters/agents.toml).
//
// Written BESIDE a card's worktree — in the folder holding all of that repo's worktrees — never
// inside a checkout: nothing lands in git. So it reaches card launches only; « Nouvel agent » and the
// orchestrator start in the main checkout, whose parent holds the operator's other repos.
// A file there the board did not write (no MARK) is the operator's: never overwritten, never removed.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { AgentAdapter } from "./adapters.ts";
import { parseWorktreeList, runGit, type GitRunner } from "./git.ts";
import { isModel, isVariant, type RepoModel } from "./templates.ts";

export const MODEL_FILE_MARK = "Collie Board: this repo's default model (repo settings). Removed when set back to None.";

/** `provider/model#variant`, or null when there is no model to name. Pure. */
export function modelSpec(m: RepoModel | null | undefined): string | null {
  if (!m || !isModel(m.model)) return null;
  const base = m.provider && isModel(m.provider) ? `${m.provider}/${m.model}` : m.model;
  return isVariant(m.effort) ? `${base}#${m.effort}` : base;
}

/** The folder the file goes in for a launch in `checkout`, or null: not a worktree beside others. Pure. */
export function modelFileDir(checkout: string, repoPath: string): string | null {
  const dir = dirname(resolve(checkout));
  return resolve(checkout) === resolve(repoPath) || dir === dirname(resolve(repoPath)) ? null : dir;
}

/** Write, refresh or remove the board's file for `kind` in `dir`. Returns what it did. */
export function syncModelFile(adapter: AgentAdapter | undefined, dir: string | null, m: RepoModel | null): "written" | "removed" | "kept" | "none" {
  const name = adapter?.modelFile;
  if (!name || !dir) return "none";
  const path = join(dir, name);
  if (existsSync(path)) {
    let ours = false;
    try {
      ours = (JSON.parse(readFileSync(path, "utf8")) as { $comment?: unknown }).$comment === MODEL_FILE_MARK;
    } catch {
      // Unreadable or JSONC: not the board's.
    }
    if (!ours) return "kept";
  }
  const spec = modelSpec(m);
  if (!spec) {
    if (!existsSync(path)) return "none";
    rmSync(path, { force: true });
    return "removed";
  }
  writeFileSync(path, `${JSON.stringify({ $schema: "https://opencode.ai/config.json", $comment: MODEL_FILE_MARK, model: spec }, null, 2)}\n`);
  return "written";
}

/** Every folder holding the repo's worktrees (the same `git worktree list` the board already runs). */
export async function worktreeDirs(repoPath: string, git: GitRunner = runGit): Promise<string[]> {
  const r = await git(["worktree", "list", "--porcelain"], repoPath).catch(() => null);
  if (!r?.ok) return [];
  return [...new Set(parseWorktreeList(r.stdout).map((w) => modelFileDir(w.path, repoPath)).filter((d): d is string => d !== null))];
}

/** At a card's launch: the file follows the setting before the agent starts. Never fails the launch. */
export function syncAtLaunch(adapter: AgentAdapter | undefined, checkout: string | null | undefined, repoPath: string | null | undefined, m: RepoModel | null): void {
  if (!adapter?.modelFile || !checkout || !repoPath) return;
  try {
    syncModelFile(adapter, modelFileDir(checkout, repoPath), m);
  } catch (err) {
    console.warn(`[model-file] ${checkout}: ${(err as Error).message}`);
  }
}
