import { createContext } from "react";

import type { TranscriptEntry } from "@/lib/types";

// The paths an agent names in its prose — `src/a.ts:42` — found in plain text, so the reading view
// can turn the ones that exist in the pane's folder into links (components/file-links.tsx). Only
// RELATIVE paths with an extension: an absolute path, a URL and a dot-led segment never match, the
// same shape the bridge accepts (bridge/files-view.ts parseRelPath).

export interface FileRef {
  path: string;
  line?: number;
}

export type FilePiece = { text: string; ref?: FileRef };

// Not after a word char, `/`, `.`, `:`, `~`, `@`, `-` (inside a URL or an absolute path); segments
// start with a word char; the last has a letter-led extension; an optional `:line[:col]`.
const FILE_REF =
  /(?<![\w/.:~@-])((?:[\w@-][\w.@-]*\/)*[\w@-][\w.@-]*\.[A-Za-z][A-Za-z0-9]{0,7})(?::(\d+))?(?::\d+)?(?![\w/])/g;

/** Split text into plain pieces and path pieces. Pure; concatenating `text` gives back the input. */
export function splitFileRefs(text: string): FilePiece[] {
  const out: FilePiece[] = [];
  let last = 0;
  for (const m of text.matchAll(FILE_REF)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], ref: m[2] ? { path: m[1]!, line: Number(m[2]) } : { path: m[1]! } });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Every distinct path named in the prose of these turns — what the bridge is asked about. Pure. */
export function fileRefCandidates(entries: TranscriptEntry[]): string[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    for (const part of entry.parts) {
      if (part.kind !== "text" && part.kind !== "thinking") continue;
      for (const piece of splitFileRefs(part.text)) if (piece.ref) seen.add(piece.ref.path);
    }
  }
  return [...seen];
}

/** What MarkdownText needs to link a path: does it exist, and how to open it. Null = no links. */
export interface FileLinks {
  has(path: string): boolean;
  open(ref: FileRef): void;
}

export const FileLinksContext = createContext<FileLinks | null>(null);
