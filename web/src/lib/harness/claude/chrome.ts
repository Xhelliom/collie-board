// Chrome stripping — trims the agent's own TUI chrome off the TAIL of a parsed buffer so the app's
// composer/statusline supersedes it instead of duplicating it. Today that's the Claude Code input
// box (the "❯ …" prompt line sandwiched between two rules) plus the statusline / hint lines below it
// and any trailing blank runs.
//
// Deliberately CONSERVATIVE: it strips only when the WHOLE input-box shape matches confidently at
// the tail, and never removes content above it — when unsure it returns the buffer untouched (the
// T1 raw-mirror fallback). Pure; operates on parsed line text, so a user-configured statusline is
// matched by POSITION (below the box's bottom border), never by its content strings.

import type { StyledLine } from "../../blocks";
import { isBlank, isBoxBorder, lineText } from "./markers";

// Rows allowed DIRECTLY under the input box's bottom border: the statusline plus its hint row(s)
// ("← for agents", "⏵⏵ bypass permissions on …"). A statusline is an arbitrary user command's output,
// so this run is as tall as the user made it — a 3-row ceiling left a 4+ row statusline (a common
// shape: git state, PR/review state, a context meter, a session timer are all independently toggled)
// permanently unmatched, so extractInputDraft never found the box and sendGuardedReply stalled with
// "Message didn't reach the input box" even though the text WAS in the box. Raised to 8, mirroring
// MAX_FOOTER_LINES — the ceiling only stops a borderless buffer matching unboundedly, it does not
// meaningfully protect against swallowing a dialog (that's the blank line Claude paints above a
// dialog's own footer hint, matched separately).
const MAX_STATUS_LINES = 8;

// A newer Claude Code UI paints a "background agents" footer BELOW the statusline/hint, separated from
// them by a blank line: a bold "● main" header and one row per background agent
// ("◯ <agent>  <task…>   <elapsed> · ↓ <tokens>"). We peel it off the tail as chrome too, bounded to
// this many rows (header + a handful of agents, plus a possible "… +N more" line) so a borderless
// buffer still can't strip unboundedly — an over-long block just falls back to the raw mirror.
const MAX_FOOTER_LINES = 8;

// A long draft WRAPS inside the input box: the "❯ …" prompt line plus continuation lines (indented,
// no leading "❯") before the bottom border. We scan up past those to find the prompt, but only this
// many — a bound that stops a BORDERLESS buffer scanning unboundedly. It is not what keeps the match
// tight: the scan aborts on any box border it meets on the way up, so a diff box or a menu can never
// be walked through into a bogus "prompt" line.
//
// 12 was tuned for soft-wrap alone and was far too low for a draft carrying its own newlines: Claude
// grows the box one row per line, up to the terminal's height (live-verified on herdr 0.8.2,
// 2026-09-01 — a 100-line draft rendered a 42-row box). Every one of those stalled
// `sendGuardedReply`, because locateInputBox never found the "❯" and the guard read "no draft".
const MAX_DRAFT_LINES = 64;

// Text Claude draws on the "❯" prompt line that is NOT a real user draft — it's a hint the TUI paints
// when the box is otherwise empty. Must never be surfaced as a recoverable draft. Kept as an array so
// more variants can be added without touching the extraction logic.
const INPUT_PLACEHOLDERS = ["Press up to edit queued messages"];

// Over roughly a thousand characters, Claude Code stops showing a draft and shows a STAND-IN for it:
// "[Pasted text #3]", or "[Pasted text #3 +12 lines]" when the text carries newlines. Live-verified
// on herdr 0.8.2 (2026-09-01): 699 chars render in full, 1099 collapse — it is the character count
// that trips it, not the line count.
//
// The text is really in the box, it is simply not on screen to compare against, so this shape is the
// only evidence a big send has that it landed (see reply-action.ts). Anchored whole-line, so a draft
// that merely mentions the phrase can't pass as one.
const COLLAPSED_DRAFT = /^\[Pasted text #\d+(?: \+\d+ lines?)?\]$/;

/**
 * Whether `draft` (as returned by {@link extractInputDraft}) is Claude's collapsed stand-in for a
 * large draft rather than the draft's own text.
 */
export function isCollapsedDraft(draft: string): boolean {
  return COLLAPSED_DRAFT.test(draft.trim());
}

/**
 * Return `lines` with any confidently-matched trailing chrome removed. When nothing matches the
 * input is returned as-is (same reference), so callers can treat an unchanged result as "no chrome".
 */
export function stripChrome(lines: StyledLine[]): StyledLine[] {
  const texts = lines.map(lineText);
  let end = lines.length; // exclusive bound of the kept range

  // 1. Drop a trailing run of blank lines.
  while (end > 0 && isBlank(texts[end - 1]!)) end--;
  if (end === 0) return lines.slice(0, 0);

  // 2. Peel the input box off the tail if the full shape is present. Only then; otherwise the
  //    blank-trim above is the sole (safe) change.
  const box = locateInputBox(texts, end);
  if (box !== null) {
    end = box.top;
    // Drop the blank run now exposed above the box (a fresh session has an empty body above it).
    while (end > 0 && isBlank(texts[end - 1]!)) end--;
  }

  return end === lines.length ? lines : lines.slice(0, end);
}

/**
 * The chrome lines directly under the input box — everything stripChrome peeled off the tail, handed
 * back so the app can render it above the composer.
 *
 * PLURAL ON PURPOSE. This used to return the FIRST line only, on the assumption that Claude's own
 * statusline (model · ctx · cwd · branch) sits flush against the border with a hint line below it
 * worth dropping. Both halves of that are wrong in the field: a statusline hook (Claude Code's
 * `statusLine` setting) can paint its OWN line above Claude's — a user running one saw `[PONYTAIL]`
 * in the app strip and lost the branch, the model and the auto-mode indicator behind it — and the
 * "hint" line is where `⏵⏵ auto mode on` lives, which is real state, not decoration.
 *
 * So: the whole run, in order, in the caller's hands. Guessing which of these lines matters needs
 * knowledge this parser does not have and should not invent — a little too much beats missing the one
 * line you were looking for, and the caller can render it compactly.
 *
 * Bounded by MAX_STATUS_LINES, the same run locateInputBox already accepts above the border, and
 * stopped by the first BLANK line — that blank is the TUI's own separator before the background-agents
 * footer (`● main` / `◯ …` rows), which is a different thing and would swamp a phone. Empty array
 * when there is no box at the tail, so `[]` and "nothing to show" are the same case.
 */
export function extractStatusLines(lines: StyledLine[]): string[] {
  const texts = lines.map(lineText);
  let end = lines.length;
  while (end > 0 && isBlank(texts[end - 1]!)) end--;
  if (end === 0) return [];

  const box = locateInputBox(texts, end);
  if (box === null) return [];

  const out: string[] = [];
  for (let j = box.bottomBorder + 1; j < end && out.length < MAX_STATUS_LINES; j++) {
    const t = texts[j]!.trim();
    if (t.length === 0) break; // the separator before the background-agents footer
    out.push(t);
  }
  return out;
}

/**
 * The user's draft text stranded on the input box's "❯" prompt line. When a message is queued while
 * the agent is busy and then recalled (Up/Esc), the text lands here and persists across turns — but
 * stripChrome peels the whole box off the mirror, so it becomes invisible, and the composer (local
 * state only) never learns of it. This re-surfaces it so the app can offer to recover it.
 *
 * Reads the prompt line found by locateInputBox: drop the leading "❯" marker and its separator space
 * (Claude renders a U+00A0 there, which JS trim() strips), then trim. A draft too long for one line
 * WRAPS onto continuation lines inside the box; those are folded back in (each trimmed of its
 * alignment indent, joined with a single space — Claude soft-wraps at word boundaries, so the dropped
 * break was a space). Returns `null` when there's no input box at the tail, the box is empty (bare
 * "❯"), or the line is a known TUI placeholder (INPUT_PLACEHOLDERS) rather than a real draft.
 */
export function extractInputDraft(lines: StyledLine[]): string | null {
  const texts = lines.map(lineText);
  let end = lines.length;
  while (end > 0 && isBlank(texts[end - 1]!)) end--;
  if (end === 0) return null;

  const box = locateInputBox(texts, end);
  if (box === null) return null;

  let head = texts[box.prompt]!.trimStart();
  if (head.startsWith("❯")) head = head.slice(1);
  const parts = [head.trim()];
  // Continuation lines of a wrapped draft: everything between the prompt and the bottom border,
  // de-indented. Blank lines are dropped (interior/trailing padding), so they never inject a space.
  for (let j = box.prompt + 1; j < box.bottomBorder; j++) {
    const t = texts[j]!.trim();
    if (t.length > 0) parts.push(t);
  }
  const draft = parts.join(" ").trim();
  if (draft.length === 0 || INPUT_PLACEHOLDERS.includes(draft)) return null;
  return draft;
}

interface InputBox {
  /** Index of the TOP border — the exclusive bound of everything ABOVE the box (stripChrome uses it). */
  top: number;
  /** Index of the "❯" prompt line, between the two borders — carries the draft (extractInputDraft). */
  prompt: number;
  /** Index of the BOTTOM border — the statusline, if any, is the first non-blank line after it. */
  bottomBorder: number;
}

/**
 * If the range ending at `end` (exclusive; `end-1` is the last non-blank line) ends in the Claude
 * input-box shape —
 *
 *     <top border>
 *     ❯ <draft>            (the prompt line)
 *     <continuation…>      (0..MAX_DRAFT_LINES wrapped-draft lines, no leading "❯")
 *     <bottom border>
 *     <statusline>         (statusline + hint rows together are 0..MAX_STATUS_LINES, by position)
 *     <hint line>
 *     <blank>              (optional — separates the background-agents footer, if present)
 *     <● main>             (0..MAX_FOOTER_LINES footer lines, matched by position not content)
 *     <◯ agent …>
 *
 * return the top and bottom border indices plus the prompt-line index. Otherwise null. Scans
 * bottom-up.
 */
function locateInputBox(texts: string[], end: number): InputBox | null {
  let i = end - 1;

  // (a) Optional background-agents footer at the very tail (a newer Claude Code UI): a non-blank run
  //     ("● main" header + "◯ …" agent rows) divided from the statusline/hint by a blank line. Matched
  //     by POSITION, never content, and peeled only when that blank separator is found within the
  //     bound — otherwise the run we just walked IS the statusline+hint, so leave it for step (b).
  {
    let j = i;
    let footer = 0;
    while (j >= 0 && !isBoxBorder(texts[j]!) && !isBlank(texts[j]!) && footer < MAX_FOOTER_LINES) {
      footer++;
      j--;
    }
    if (footer > 0 && j >= 0 && isBlank(texts[j]!)) {
      while (j >= 0 && isBlank(texts[j]!)) j--; // consume the blank separator run
      i = j;
    }
  }

  // (b) Up to MAX_STATUS_LINES status/hint lines directly above the bottom border: non-blank,
  //     non-border text. Stop as soon as a border is reached.
  let status = 0;
  while (i >= 0 && !isBoxBorder(texts[i]!) && !isBlank(texts[i]!) && status < MAX_STATUS_LINES) {
    status++;
    i--;
  }

  // (c) bottom border
  if (i < 0 || !isBoxBorder(texts[i]!)) return null;
  const bottomBorder = i;
  i--;

  // (d) the "❯" prompt line — the FIRST line of the draft. A long draft wraps onto continuation lines
  //     (indented, no "❯") between the prompt and the bottom border, so scan up past them to the
  //     prompt. Bounded by MAX_DRAFT_LINES, and any box border en route aborts the match (we'd have
  //     left the box). Blank padding on either side is tolerated defensively.
  while (i >= 0 && isBlank(texts[i]!)) i--;
  let wrapped = 0;
  while (
    i >= 0 &&
    !isBoxBorder(texts[i]!) &&
    !texts[i]!.trimStart().startsWith("❯") &&
    wrapped < MAX_DRAFT_LINES
  ) {
    wrapped++;
    i--;
  }
  if (i < 0 || !texts[i]!.trimStart().startsWith("❯")) return null;
  const prompt = i;
  i--;
  while (i >= 0 && isBlank(texts[i]!)) i--;

  // (e) top border
  if (i < 0 || !isBoxBorder(texts[i]!)) return null;
  return { top: i, prompt, bottomBorder };
}
