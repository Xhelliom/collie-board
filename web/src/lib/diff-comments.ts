// Line comments on a card's diff, collected as one batch and sent to the card's agent as ONE prompt.
// Idea from upstream Collie 1.25.0 (Changes → comment on lines), rewritten for the card diff.
//
// The batch is kept in sessionStorage per card: a Back out of the card and in again keeps it, but it
// does not outlive the tab — a batch from last week would quote lines of a diff that no longer exists.

/** One line of a unified patch, numbered. `code` is false for headers (`diff`, `---`, `@@`…). */
export interface DiffLine {
  text: string;
  code: boolean;
  oldNo: number | null;
  newNo: number | null;
}

export interface DiffComment {
  path: string;
  /** `kind:old:new:text` of each line covered, so a re-fetched patch re-finds them. */
  keys: string[];
  label: string;
  lines: string[];
  note: string;
}

/** Number every line of a unified patch from its `@@ -a,b +c,d @@` headers. Pure, for the test. */
export function numberDiff(body: string): DiffLine[] {
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  return body.split("\n").map((text) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      inHunk = true;
      return { text, code: false, oldNo: null, newNo: null };
    }
    if (inHunk && text.startsWith("+")) return { text, code: true, oldNo: null, newNo: newNo++ };
    if (inHunk && text.startsWith("-")) return { text, code: true, oldNo: oldNo++, newNo: null };
    if (inHunk && text.startsWith(" ")) return { text, code: true, oldNo: oldNo++, newNo: newNo++ };
    // `diff --git` of a next file, `\ No newline…`, or the trailing empty line: not a code line.
    if (text.startsWith("diff ")) inHunk = false;
    return { text, code: false, oldNo: null, newNo: null };
  });
}

export function lineKey(l: DiffLine): string {
  return `${l.oldNo ?? ""}:${l.newNo ?? ""}:${l.text}`;
}

/** `+12–15`, `-3, +3–4`: the new line number when there is one, the old one for a removal. */
export function lineLabel(lines: readonly DiffLine[]): string {
  const ranges: { sign: string; start: number; end: number }[] = [];
  for (const l of lines) {
    const sign = l.newNo !== null ? "+" : "-";
    const no = (l.newNo ?? l.oldNo)!;
    const prev = ranges.at(-1);
    if (prev && prev.sign === sign && no === prev.end + 1) prev.end = no;
    else ranges.push({ sign, start: no, end: no });
  }
  return ranges.map((r) => (r.start === r.end ? `${r.sign}${r.start}` : `${r.sign}${r.start}–${r.end}`)).join(", ");
}

export function makeComment(path: string, lines: readonly DiffLine[], note: string): DiffComment {
  return { path, keys: lines.map(lineKey), label: lineLabel(lines), lines: lines.map((l) => l.text), note: note.trim() };
}

/** The one message the agent gets: per comment, `path` (lines), the quoted lines, then the note. */
export function formatBatch(intro: string, comments: readonly DiffComment[]): string {
  const parts = comments.map((c) => {
    const quote = c.lines.map((l) => `> ${l}`).join("\n");
    return `\`${c.path}\` (${c.label})\n${quote}\n\n${c.note}`;
  });
  return [intro, ...parts].join("\n\n");
}

const key = (cardId: string) => `collie-board:diff-comments:v1:${cardId}`;

export function loadComments(cardId: string): DiffComment[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(key(cardId)) ?? "[]");
    return Array.isArray(parsed) ? (parsed as DiffComment[]).filter((c) => typeof c?.note === "string" && Array.isArray(c.lines) && Array.isArray(c.keys)) : [];
  } catch {
    return [];
  }
}

export function saveComments(cardId: string, comments: readonly DiffComment[]): void {
  try {
    if (comments.length === 0) sessionStorage.removeItem(key(cardId));
    else sessionStorage.setItem(key(cardId), JSON.stringify(comments));
  } catch {
    // Private mode or a full quota: the batch lives in the component's state only.
  }
}
