// Update to the latest release, or roll back to the previous one — upstream's idea (1.23.0 "Roll
// back"), rewritten for a checkout install. The bridge cannot reinstall itself: `systemctl restart`
// kills its whole cgroup, children included (and `taskkill /T` its tree on Windows). So it asks HERDR
// to run the existing update action, which herdr runs outside our unit; a rollback first leaves the
// target tag where that action reads it (`update-target` in the plugin config dir).
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PANE_HEADER } from "./board-routes.ts";
import { summarizeGate } from "./gate.ts";
import { compareSemver, githubTagsFetcher, parseSemverTag } from "./update.ts";

const PLUGIN = "herdr.collie-board";
const INVOKE_TIMEOUT_MS = 15_000;
/** Under Bun.serve's idleTimeout (180 s): past this the request answers "still running" and the page waits for the reload. */
const WATCH_MS = 165_000;
const WATCH_EVERY_MS = 2_000;
// Off Windows, the bash twin: it needs no bun on Herdr's PATH (ADR 0050). Same update underneath.
const UPDATE_ACTION = ["herdr", "plugin", "action", "invoke", process.platform === "win32" ? "update" : "update-bash", "--plugin", PLUGIN];
const LOG_LIST = ["herdr", "plugin", "log", "list", "--plugin", PLUGIN, "--limit", "10"];

/** The log id herdr gives an invoked action, or the reason it refused it. Pure. */
export function parseInvoke(stdout: string): { logId: string } | { error: string } {
  try {
    const j = JSON.parse(stdout);
    const logId = j?.result?.log?.log_id;
    if (typeof logId === "string") return { logId };
    return { error: j?.error?.message ? `${j.error.code}: ${j.error.message}` : stdout.trim() || "no answer from herdr" };
  } catch {
    return { error: stdout.trim() || "no answer from herdr" };
  }
}

/** Where that log stands: still running (null), or done — with the reason when it failed. Pure. */
export function parseLogOutcome(stdout: string, logId: string): null | { error: string | null } {
  let log: { status?: string; exit_code?: number; stdout?: string; stderr?: string } | undefined;
  try {
    log = JSON.parse(stdout)?.result?.logs?.find((l: { log_id?: string }) => l.log_id === logId);
  } catch {
    return null;
  }
  if (!log || log.status === "running") return null;
  if (log.status === "succeeded") return { error: null };
  // Errors land on stderr, but git and bun print warnings there too: keep the tail of both, in order.
  return { error: summarizeGate(`${log.stdout ?? ""}\n${log.stderr ?? ""}`.trim()) || `exit ${log.exit_code ?? "?"}` };
}

async function capture(argv: string[]): Promise<string> {
  try {
    const p = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", stdin: "ignore", timeout: INVOKE_TIMEOUT_MS });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return out.trim() ? out : err;
  } catch (e) {
    return (e as Error).message;
  }
}

/**
 * Invoke the update action, then watch its herdr log until it fails or the deadline: a failure comes
 * back as its reason, while the running bridge is still the old one. A success ends with the restart,
 * which kills this request mid-wait — the page then learns the outcome from the new build's reload.
 */
async function invokeAndWatch(): Promise<string | null> {
  const invoked = parseInvoke(await capture(UPDATE_ACTION));
  if ("error" in invoked) return `herdr refused the update action: ${invoked.error}`;
  for (const deadline = Date.now() + WATCH_MS; Date.now() < deadline; ) {
    await Bun.sleep(WATCH_EVERY_MS);
    const outcome = parseLogOutcome(await capture(LOG_LIST), invoked.logId);
    if (outcome) return outcome.error;
  }
  return null;
}

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
  /** Run the update action through herdr; resolves to why it failed, or null when it is under way / done. */
  invoke: () => Promise<string | null>;
}

const repo = process.env.COLLIE_BOARD_UPDATE_REPO?.trim() || "";
const defaultDeps: RollbackDeps = {
  fetchTags: repo ? githubTagsFetcher(repo) : async () => [],
  configDir: process.env.HERDR_PLUGIN_CONFIG_DIR ?? "",
  invoke: invokeAndWatch,
};

/** A failed update, as the page shows it: the reason, and a kind that tells it from a proxy's 502. */
const failed = (error: string) => Response.json({ error, kind: "update-failed" }, { status: 502 });

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
    return failed(error);
  }
  return Response.json({ target: previous }, { status: 202 });
}

/** POST: update to the newest release — no target, the operator's gesture only. */
export async function handleUpdate(req: Request, deps: RollbackDeps = defaultDeps): Promise<Response> {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (req.headers.get(PANE_HEADER)?.trim())
    return new Response("updating is the operator's gesture — an agent pane may not", { status: 403 });
  // A target left by a rollback that never ran would turn this update into a rollback.
  if (deps.configDir) await rm(join(deps.configDir, "update-target"), { force: true });
  const error = await deps.invoke();
  return error ? failed(error) : Response.json({ started: true }, { status: 202 });
}
