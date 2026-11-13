import type { MessageKey } from "@/i18n";
import { haltSummary } from "@/components/halt-reason";

// Why a lot stopped, as ONE sentence the operator reads on the project page. The raw output (a 502's
// HTML, a gate's colours) stays in the card's history, never on the page. Known causes get a sentence
// of their own; anything else, its first readable line.

const KNOWN: [RegExp, MessageKey][] = [
  [/\b50[234]\b|bad gateway|service unavailable|gateway time-?out/i, "halt.github"],
  [/conflict/i, "halt.conflict"],
  [/the check .* failed on GitHub/i, "halt.ci"],
  [/\bgate\b/i, "halt.gate"],
  [/no verdict from the lead/i, "halt.leadSilent"],
  [/rounds without the lead/i, "halt.rounds"],
  [/PR was closed without merging/i, "halt.predClosed"],
  [/checkout is gone|agent .*gone|no agent/i, "halt.gone"],
  [/without a PR/i, "halt.remote"],
];

/** A key for a known cause, else the cleaned first line (no HTML tag, at most 140 characters). Pure. */
export function haltSentence(reason: string): { key: MessageKey } | { text: string } {
  for (const [re, key] of KNOWN) if (re.test(reason)) return { key };
  const line = haltSummary(reason.replace(/<[^>]*>/g, " ")).head[0]?.replace(/\s+/g, " ").trim() ?? "";
  return { text: line.length > 140 ? `${line.slice(0, 139)}…` : line };
}
