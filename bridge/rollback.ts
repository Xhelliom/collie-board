// Roll back to the previous release — upstream's idea (1.23.0 "Roll back"), rewritten for a checkout
// install. The bridge cannot reinstall itself: `systemctl restart` kills its whole cgroup, children
// included. So it leaves the target tag where the ctl's `update` reads it (`update-target` in the
// plugin config dir) and asks HERDR to run that existing action, which herdr runs outside our unit.
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PANE_HEADER } from "./board-routes.ts";
import { spawnGate } from "./gate.ts";
import { compareSemver, githubTagsFetcher, parseSemverTag } from "./update.ts";

const INVOKE_TIMEOUT_MS = 15_000;
const UPDATE_ACTION = ["herdr", "plugin", "action", "invoke", "update", "--plugin", "herdr.collie-board"];

/** The newest release strictly older than `current` (dotted, no `v`), or null. Pure. */
export function previousRelease(tags: string[], current: string): string | null {
  let best: string | null = null;
  for (const tag of tags) {
    const parts = parseSemverTag(tag);
    if (!parts) continue;
    const v = parts.join(".");
    if (compareSemver(v, current) < 0 && (best === null || compareSemver(v, best) > 0)) best = v;
  }
  return best;
}

export interface RollbackDeps {
  fetchTags: () => Promise<string[]>;
  /** Where the ctl's `update` looks for a target (HERDR_PLUGIN_CONFIG_DIR), or "" when unknown. */
  configDir: string;
  /** Ask herdr to run the `update` action; resolves to an error message, or null when it was taken. */
  invoke: () => Promise<string | null>;
}

const repo = process.env.COLLIE_BOARD_UPDATE_REPO?.trim() || "";
const defaultDeps: RollbackDeps = {
  fetchTags: repo ? githubTagsFetcher(repo) : async () => [],
  configDir: process.env.HERDR_PLUGIN_CONFIG_DIR ?? "",
  invoke: async () => {
    const r = await spawnGate(UPDATE_ACTION, import.meta.dir, INVOKE_TIMEOUT_MS);
    return r.kind === "pass" ? null : r.kind === "fail" ? r.summary : r.message;
  },
};

// The release before the running one never changes while this process runs: look it up once.
let cached: Promise<string | null> | null = null;
function lookup(deps: RollbackDeps, current: string): Promise<string | null> {
  if (deps !== defaultDeps) return deps.fetchTags().then((t) => previousRelease(t, current));
  cached ??= deps.fetchTags().then(
    (t) => previousRelease(t, current),
    () => ((cached = null), null), // a network miss is retried on the next open of the screen
  );
  return cached;
}

/** GET: `{ previous }` for the Settings button. POST: reinstall it — the operator's gesture only. */
export async function handleRollback(req: Request, current: string, deps: RollbackDeps = defaultDeps): Promise<Response> {
  if (req.method === "GET") return Response.json({ previous: await lookup(deps, current) });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (req.headers.get(PANE_HEADER)?.trim())
    return new Response("rolling back is the operator's gesture — an agent pane may not", { status: 403 });
  const previous = await lookup(deps, current);
  if (!previous) return new Response("no earlier release to go back to", { status: 409 });
  if (!deps.configDir) return new Response("no plugin config dir: run the update action by hand", { status: 503 });
  const file = join(deps.configDir, "update-target");
  await writeFile(file, `v${previous}\n`, { mode: 0o600 });
  const error = await deps.invoke();
  if (error) {
    await rm(file, { force: true }); // never leave a target behind for the next plain update
    return new Response(`herdr refused the update action: ${error}`, { status: 502 });
  }
  return Response.json({ target: previous }, { status: 202 });
}
