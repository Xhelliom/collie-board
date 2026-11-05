// Which prompt reading mode pins above the thread, given the turn at the top of the screen.
//
// Idea from upstream Collie 1.21.0 (lib/prompt-pin.ts), rewritten over our TranscriptEntry: a long
// answer scrolls the question it answers off screen; the pin says which prompt the turns on screen
// belong to. Nothing here touches the DOM, so the rule is table-testable.

import type { TranscriptEntry } from "./types";

export interface Pin {
  /** The prompt's turn, to scroll back to. */
  uuid: string;
  text: string;
}

/** The words of a user turn, or null when it carries none (an image alone). */
function promptText(entry: TranscriptEntry): string | null {
  if (entry.role !== "user") return null;
  const text = entry.parts
    .flatMap((p) => (p.kind === "text" ? [p.text] : []))
    .join("\n\n")
    .trim();
  return text === "" ? null : text;
}

/**
 * The prompt the turn `topUuid` answers, when that prompt is above it (off screen).
 * Null when the top turn IS a prompt (it is on screen), or no prompt is held above it.
 */
export function pinFor(entries: readonly TranscriptEntry[], topUuid: string | null): Pin | null {
  const top = entries.findIndex((e) => e.uuid === topUuid);
  if (top === -1 || entries[top]!.role === "user") return null;
  for (let i = top - 1; i >= 0; i--) {
    const text = promptText(entries[i]!);
    if (text !== null) return { uuid: entries[i]!.uuid, text };
  }
  return null;
}
