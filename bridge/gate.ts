// The repo's gate — ADR 0020. A command the OPERATOR set for a repo (build, tests, lint…), run by the
// coordinator in the worker's checkout before the lead is asked anything. A machine says "red" or
// "green" first; the lead — who spends quota reading code — only sees what passed.
//
// SECURITY. This is the second place the bridge runs a process (git.ts is the first), under the same
// two rules: argv elements, never a shell, and the command is the operator's own, set through a
// write-gated route — never read from the repo, where the worker could rewrite it.

import { constants, setPriority } from "node:os";

/** A gate that outlives this is hung, not slow: the run halts instead of waiting for ever. */
const GATE_TIMEOUT_MS = 30 * 60_000;
/** SIGTERM first, SIGKILL this long after — short, so a timed-out gate hands back within a second. */
const KILL_GRACE_MS = 300;

/** What the worker is told of a red gate — the tail, because that is where build tools put the errors. */
const SUMMARY_LINES = 40;
const SUMMARY_CHARS = 4_000;

export type GateResult =
  /** `note`: the gate's last line on stdout — where a gate says what it did (e.g. tests skipped). */
  | { kind: "pass"; note?: string }
  | { kind: "fail"; exit: number; summary: string }
  /** The gate could not give a verdict (missing binary, timeout): the operator's, not the worker's. */
  | { kind: "error"; message: string };

/**
 * `"tools/check all"` → `["tools/check", "all"]`. Whitespace-split on purpose: there is no shell here,
 * so quotes, pipes and `&&` mean nothing — wrap those in a script and name the script. Null: blank.
 */
export function parseGate(command: string | null | undefined): string[] | null {
  const argv = (command ?? "").trim().split(/\s+/).filter(Boolean);
  return argv.length ? argv : null;
}

/** The last lines of a gate's output, capped — pure, so what the worker is sent is pinned by a test. */
export function summarizeGate(output: string): string {
  const lines = output.trimEnd().split("\n");
  const tail = lines.slice(-SUMMARY_LINES).join("\n");
  const cut = lines.length > SUMMARY_LINES || tail.length > SUMMARY_CHARS;
  return (cut ? "…\n" : "") + tail.slice(-SUMMARY_CHARS);
}

/** The last non-empty line of a green gate's stdout, capped, or undefined. Pure. */
export function gateNote(stdout: string): string | undefined {
  const last = stdout.trimEnd().split("\n").pop()?.trim();
  return last ? last.slice(0, 200) : undefined;
}

/** The message that sends the worker back when the gate is red. Pure. */
export function gatePrompt(command: string, summary: string): string {
  return [
    `The repo's gate (\`${command}\`) failed on your work. Fix what it reports, commit, and tell me when it is green.`,
    "Last lines of its output:",
    "",
    summary,
  ].join("\n");
}

/**
 * Wraps `fn` so its calls run one after another, never together. A call that throws or rejects
 * still frees the slot for the next. Pure over `fn`, so the queueing is pinned by a test.
 */
export function oneAtATime<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  let tail: Promise<unknown> = Promise.resolve();
  return (...args) => {
    const next = tail.then(() => fn(...args));
    tail = next.catch(() => {});
    return next;
  };
}

/** The cards whose gate is queued behind another one — runtime only, shown as "check waiting" (audit P5). */
const waiting = new Set<string>();
export const gatesWaiting: ReadonlySet<string> = waiting;

const queued = oneAtATime((argv: string[], cwd: string, timeoutMs?: number, cardId?: string) => {
  if (cardId) waiting.delete(cardId);
  return spawnGate(argv, cwd, timeoutMs);
});

/**
 * The operator's gate, one at a time across the whole bridge: a run gates each card of a lot in
 * parallel and pr-follow gates each PR it lands, and N test suites at once starve the CPU until a
 * healthy suite times out (a red that is not the worker's). Each gate's own timeout starts when it
 * actually runs, so a queued gate is never charged for the wait. `cardId`: listed in `gatesWaiting`
 * until its turn comes.
 * ponytail: one global queue; per-repo slots if gates on unrelated repos must overlap.
 */
export function runGate(argv: string[], cwd: string, timeoutMs?: number, cardId?: string): Promise<GateResult> {
  if (cardId) waiting.add(cardId);
  return queued(argv, cwd, timeoutMs, cardId);
}

/** Run a command unqueued — what the gate runs, and what `bun install` (deps.ts) uses directly. */
export async function spawnGate(argv: string[], cwd: string, timeoutMs = GATE_TIMEOUT_MS): Promise<GateResult> {
  // Same reason as runGit: a gate run under a git hook would inherit the wrong repo's location.
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_PREFIX", "GIT_INDEX_FILE"]) delete env[key];
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    // Its own process group, so the timeout reaches every descendant — a grandchild that kept the
    // pipes open held a 30-min gate for 4 h 16 (incident 23/11).
    proc = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore", env, detached: true });
  } catch (err) {
    return { kind: "error", message: (err as Error).message };
  }
  // Low priority (audit P5): the bridge and the herd's panes stay responsive while a suite runs. Set
  // before the gate forks its workers, which inherit it; on Linux the IO priority follows the nice
  // level. os.setPriority is portable (IDLE class on Windows) — and a refusal only costs the priority.
  try {
    setPriority(proc.pid, constants.priority.PRIORITY_LOW);
  } catch {}
  const killGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-proc.pid, signal);
    } catch {
      proc.kill(signal); // no group (Windows) or already gone
    }
  };
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(async () => {
      timedOut = true;
      killGroup("SIGTERM");
      // A short grace for a clean exit, then the whole group dies; the pipes are never awaited again.
      await Promise.race([proc.exited, Bun.sleep(KILL_GRACE_MS)]);
      killGroup("SIGKILL");
      resolve("timeout");
    }, timeoutMs);
  });
  try {
    const done = Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
      proc.exited,
    ]);
    const res = await Promise.race([done, timeout]);
    if (timedOut) return { kind: "error", message: `timed out after ${Math.round(timeoutMs / 60_000)} min` };
    const [out, err, exit] = res as [string, string, number];
    const note = gateNote(out);
    return exit === 0 ? (note ? { kind: "pass", note } : { kind: "pass" }) : { kind: "fail", exit, summary: summarizeGate(`${out}\n${err}`) };
  } finally {
    clearTimeout(timer);
  }
}
