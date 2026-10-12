// A fresh worktree has no node_modules, so the repo's pre-push hook (tsc, tests) fails in it and the
// card never opens its PR. Install before the agent starts. argv, never a shell — same rule as gate.ts.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnGate } from "./gate.ts";

const INSTALL_TIMEOUT_MS = 5 * 60_000;

/** Dirs ("" = root) needing `bun install`: a bun.lock and no node_modules yet. Pure over `has`. */
export function installDirs(has: (rel: string) => boolean): string[] {
  return ["", "web"].filter((d) => has(join(d, "bun.lock")) && !has(join(d, "node_modules")));
}

/** Install into the checkout; resolves to a failure message per dir that failed (empty: all fine). */
export async function installDeps(checkout: string): Promise<string[]> {
  const failures: string[] = [];
  for (const d of installDirs((rel) => existsSync(join(checkout, rel)))) {
    const r = await spawnGate(["bun", "install"], join(checkout, d), INSTALL_TIMEOUT_MS);
    if (r.kind === "fail") failures.push(`${d || "."}: exit ${r.exit}: ${r.summary}`);
    else if (r.kind === "error") failures.push(`${d || "."}: ${r.message}`);
  }
  return failures;
}
