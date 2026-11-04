// A long reply typed into Claude Code goes as ONE bracketed paste (HERDR_API.md, "send_text").
//
// `pane.send_text` writes raw bytes. On a macOS host the PTY hands them to Claude in ~1 KB reads,
// Claude makes each read over 800 characters its own paste token, and a short last read wipes the
// earlier ones: only the end of the message arrives (upstream #349, 12,029 sent / 787 received).
// Framed as ESC[200~ … ESC[201~, Claude takes the whole text as one paste. Not reproduced on Linux
// (13 KB arrived whole raw), so this is a hedge for the hosts where the reads are small.
import type { EngineSnapshot } from "./state-engine.ts";

/** At or under this many characters no PTY read can exceed Claude's paste threshold. */
const PASTE_MIN_CHARS = 800;
const PASTE_START = "\u001b[200~";
const PASTE_END = "\u001b[201~";

/** Line breaks and tabs stay; every other control byte (C0, DEL, C1) goes, so ESC[201~ in the text can't end the paste early. */
function keeps(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return ch === "\n" || ch === "\t" || (code >= 0x20 && (code < 0x7f || code > 0x9f));
}

/**
 * The bytes to type for `text` into `paneId`: framed as a bracketed paste when the pane runs Claude
 * Code and the text is long, untouched otherwise. Only Claude: a program that never enabled
 * bracketed-paste mode would show the markers as text (herdr passes them through unchecked).
 */
export function asPaste(snap: EngineSnapshot | undefined, paneId: string, text: string): string {
  if (text.length <= PASTE_MIN_CHARS) return text;
  if (!snap || snap.bridge === "disconnected") return text;
  if (snap.agents.find((a) => a.paneId === paneId)?.agent !== "claude") return text;
  return `${PASTE_START}${[...text].filter(keeps).join("")}${PASTE_END}`;
}
