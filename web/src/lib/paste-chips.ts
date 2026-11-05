// A long text paste into the composer stays out of the textarea: it becomes a `[Collé #N]` marker
// there and a chip above it, and Send puts the text back where its marker stands. Idea from upstream
// Collie 1.24.0, rewritten small.

export interface PasteChip {
  n: number;
  text: string;
}

export const PASTE_COLLAPSE_LINES = 5;
export const PASTE_COLLAPSE_CHARS = 300;

export function isCollapsiblePaste(text: string): boolean {
  return text.length >= PASTE_COLLAPSE_CHARS || text.split(/\r?\n/).length >= PASTE_COLLAPSE_LINES;
}

export function pasteMarker(n: number): string {
  return `[Collé #${n}]`;
}

/** Chips whose marker is still in the draft — deleting the marker by hand drops its chip. */
export function liveChips(input: string, chips: readonly PasteChip[]): PasteChip[] {
  return chips.filter((c) => input.includes(pasteMarker(c.n)));
}

/** The text Send types: every marker replaced by its chip's text. */
export function expandPastes(input: string, chips: readonly PasteChip[]): string {
  return chips.reduce((s, c) => s.split(pasteMarker(c.n)).join(c.text), input);
}

/** The first non-empty line, cut for the chip's label. */
export function pasteLabel(text: string): string {
  const first = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  return first.trim().slice(0, 40);
}
