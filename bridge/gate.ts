// The repo's gate — ADR 0020. A command the OPERATOR set for a repo (build, tests, lint…), run by the
// coordinator in the worker's checkout before the lead is asked anything. A machine says "red" or
// "green" first; the lead — who spends quota reading code — only sees what passed.
//
// SECURITY. This is the second place the bridge runs a process (git.ts is the first), under the same
// two rules: argv elements, never a shell, and the command is the operator's own, set through a
// write-gated route — never read from the repo, where the worker could rewrite it.

/** A gate that outlives this is hung, not slow: the run halts instead of waiting for ever. */
const GATE_TIMEOUT_MS = 30 * 60_000;

/** What the worker is told of a red gate — the tail, because that is where build tools put the errors. */
const SUMMARY_LINES = 40;
const SUMMARY_CHARS = 4_000;

export type GateResult =
  | { kind: "pass" }
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

/** The message that sends the worker back when the gate is red. Pure. */
export function gatePrompt(command: string, summary: string): string {
  return [
    `The repo's gate (\`${command}\`) failed on your work. Fix what it reports, commit, and tell me when it is green.`,
    "Last lines of its output:",
    "",
    summary,
  ].join("\n");
}

export async function runGate(argv: string[], cwd: string, timeoutMs = GATE_TIMEOUT_MS): Promise<GateResult> {
  // Same reason as runGit: a gate run under a git hook would inherit the wrong repo's location.
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_PREFIX", "GIT_INDEX_FILE"]) delete env[key];
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore", env });
  } catch (err) {
    return { kind: "error", message: (err as Error).message };
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);
  try {
    const [out, err, exit] = await Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
      proc.exited,
    ]);
    if (timedOut) return { kind: "error", message: `timed out after ${Math.round(timeoutMs / 60_000)} min` };
    return exit === 0 ? { kind: "pass" } : { kind: "fail", exit, summary: summarizeGate(`${out}\n${err}`) };
  } finally {
    clearTimeout(timer);
  }
}
