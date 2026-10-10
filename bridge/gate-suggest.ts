// Ask the copilot what a repo's gate should be (ADR 0020). The operator taps for it, the copilot
// reads the repo, and the answer is only ever RETURNED — it is the operator who saves it, because
// the gate is a command the bridge will run.
//
// The copilot is told the one hard constraint (no shell: words separated by spaces) and the parser
// enforces it, so a suggestion that would silently mean something else never reaches the screen.

import { parseGate } from "./gate.ts";

export interface GateSuggestion {
  /** What to save: words separated by spaces. When `needsScript`, the path of the script to create. */
  command: string;
  reason: string;
  needsScript: boolean;
  /** The script's content, when `needsScript` — shown to the operator, never written by the bridge. */
  scriptSuggestion: string | null;
}

export type SuggestOutcome =
  | { ok: true; suggestion: GateSuggestion }
  | { ok: false; kind: "no-answer" | "malformed"; error: string };

/** Anything a shell would read — meaningless here, so a command carrying it is refused, not run oddly. */
const SHELL_SYNTAX = /[|&;<>$`'"\\*?(){}]/;

export function suggestPrompt(input: { repoPath: string; outPath: string }): string {
  return [
    "You are suggesting the GATE for a repository: the one command a machine runs on a worker's",
    "checkout to say red or green before anyone reviews the code (build, tests, lint).",
    "",
    "HARD RULES. You read; you never act. Do NOT edit, create or delete any file in the repository, do",
    "not run the project's commands, do not install anything. Reading files and listing directories is",
    "all you may do.",
    "",
    `The repository: ${input.repoPath}`,
    "Look at, in this order: CLAUDE.md / README (a documented check command wins), package.json",
    "scripts, Makefile, justfile, .github/workflows, tools/ and scripts/. Prefer the command CI runs.",
    "",
    "THE COMMAND RUNS WITHOUT A SHELL: it is split on spaces and executed as-is. No `&&`, `|`, `;`,",
    "quotes, redirects or variables — they would mean nothing. One executable and its arguments",
    "(`bun run test`, `make check`, `tools/check`).",
    "If the right check needs several steps, do not chain them: set needsScript to true, make `command`",
    "the path of a script the operator will create (e.g. `scripts/gate.sh`), and put that script's full",
    "content in scriptSuggestion.",
    "",
    "`reason` is one or two plain sentences saying where you found it — never empty.",
    "",
    `Write ONLY this JSON to ${input.outPath} (create directories as needed) and print nothing else:`,
    "{",
    '  "command": "bun run test",',
    '  "reason": "why this command",',
    '  "needsScript": false,',
    '  "scriptSuggestion": "only when needsScript is true"',
    "}",
  ].join("\n");
}

/** Pure: throws on a malformed answer, an empty reason, or a command a shell would be needed for. */
export function toGateSuggestion(raw: unknown): GateSuggestion {
  if (typeof raw !== "object" || raw === null) throw new Error("gate: the answer is not an object");
  const o = raw as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
  const command = str("command");
  const reason = str("reason");
  if (!parseGate(command)) throw new Error("gate: no command");
  if (SHELL_SYNTAX.test(command)) throw new Error(`gate: the command needs a shell: ${JSON.stringify(command)}`);
  if (!reason) throw new Error("gate: no reason");
  const needsScript = o.needsScript === true;
  const scriptSuggestion = str("scriptSuggestion");
  if (needsScript && !scriptSuggestion) throw new Error("gate: needsScript without a script");
  return { command, reason, needsScript, scriptSuggestion: needsScript ? scriptSuggestion : null };
}

/** `ask` is the copilot's serialised one-off question. Never throws: the screen shows `error`. */
export async function suggestGate(
  ask: (build: (outPath: string) => string) => Promise<unknown | null>,
  repoPath: string,
): Promise<SuggestOutcome> {
  const raw = await ask((outPath) => suggestPrompt({ repoPath, outPath }));
  if (raw === null) return { ok: false, kind: "no-answer", error: "the copilot gave no answer in time" };
  try {
    return { ok: true, suggestion: toGateSuggestion(raw) };
  } catch (err) {
    return { ok: false, kind: "malformed", error: (err as Error).message };
  }
}
