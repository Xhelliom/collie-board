import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseAnsi } from "../../ansi";
import { splitLines, type StyledLine } from "../../blocks";
import { extractInputDraft, extractStatusLines, stripChrome } from "./chrome";
import { lineText } from "./markers";

// Anchored on this file's directory (see prompt-select.test.ts for why not `new URL(import.meta.url)`).
const PANES_DIR = join(import.meta.dirname, "..", "..", "..", "fixtures", "panes");

// Synthesise the input-box shape: a top rule, the "❯ …" prompt line, a bottom rule, and an optional
// statusline below it (matched by position, like the real captures). 40 box glyphs clear the
// 20-glyph border threshold in isBoxBorder.
function boxBuffer(promptLine: string, status?: string): StyledLine[] {
  const rule = "─".repeat(40);
  const rows = [rule, promptLine, rule];
  if (status !== undefined) rows.push(status);
  return splitLines(parseAnsi(rows.join("\n")));
}

// The same box with a MULTI-LINE statusline under it — the shape a `statusLine` hook produces when it
// paints its own line above Claude's.
function boxBufferWithStatus(promptLine: string, statusLines: string[]): StyledLine[] {
  const rule = "─".repeat(40);
  return splitLines(parseAnsi([rule, promptLine, rule, ...statusLines].join("\n")));
}

// A WRAPPED-draft box: the "❯ …" prompt plus continuation lines (indented, no "❯") between the two
// rules — the shape a long draft takes. `above` is any real output that precedes the box.
function wrappedBoxBuffer(promptLine: string, continuationLines: string[], above?: string[]): StyledLine[] {
  const rule = "─".repeat(40);
  const rows = [...(above ?? []), rule, promptLine, ...continuationLines, rule];
  return splitLines(parseAnsi(rows.join("\n")));
}

// stripChrome peels the agent's own input-box + statusline + trailing blanks off the TAIL. It's
// deliberately conservative: it strips only when the full box shape matches and never removes
// content above the last real output — when unsure it returns the buffer untouched. Driven against
// the same real captures as the detector.

function fixtureLines(name: string): StyledLine[] {
  return splitLines(parseAnsi(readFileSync(join(PANES_DIR, name), "utf8")));
}

const joined = (lines: StyledLine[]) => lines.map(lineText).join("\n");

describe("stripChrome — trims the input box off the tail", () => {
  it("fresh-idle: removes the empty input box + statusline, keeps the welcome banner", () => {
    const lines = fixtureLines("claude--fresh-idle.txt");
    const kept = joined(stripChrome(lines));
    expect(stripChrome(lines).length).toBeLessThan(lines.length);
    expect(kept).toContain("Welcome back Altan!"); // real content above survives
    expect(kept).not.toContain("← for agents"); // hint line gone
    expect(kept).not.toMatch(/\/fixture-sandbox\s*$/); // statusline gone
  });

  it("working: removes the statusline + permission hint, keeps the last real output", () => {
    const lines = fixtureLines("claude--working.txt");
    const kept = joined(stripChrome(lines));
    expect(stripChrome(lines).length).toBeLessThan(lines.length);
    expect(kept).toContain("How is Claude doing this session?"); // last real block survives
    expect(kept).not.toContain("bypass permissions"); // hint line gone
    expect(kept).not.toContain("151.5k tokens"); // statusline gone
  });

  it("done: removes the input box (draft and all) + statusline, keeps the completed turn", () => {
    const lines = fixtureLines("claude--done.txt");
    const kept = joined(stripChrome(lines));
    expect(kept).toContain("Created hello.txt containing the single word hello.");
    expect(kept).not.toContain("cat hello.txt to verify"); // the input-box draft is chrome
    expect(kept).not.toContain("32.7k tokens"); // statusline gone
  });

  // The newer Claude Code UI paints a "background agents" footer BELOW the statusline/hint, separated
  // by a blank line. It broke the bottom-up anchor (only the statusline window was tolerated), so the
  // whole box stayed visible on the mirror AND no draft chip surfaced. These three cover empty /
  // single-line / wrapped drafts with that footer present — see the real-capture cohort in the README.
  it("footer variant (empty prompt): strips the box + statusline + hint + background-agents footer", () => {
    const lines = fixtureLines("claude--draft-footer-empty.txt");
    const kept = joined(stripChrome(lines));
    expect(stripChrome(lines).length).toBeLessThan(lines.length);
    expect(kept).toContain("Wired up the token refresh path"); // real content above survives
    expect(kept).not.toContain("● main"); // footer header gone
    expect(kept).not.toContain("worker:scout"); // footer agent row gone
    expect(kept).not.toContain("bypass permissions"); // hint gone
    expect(kept).not.toContain("ctx:33%"); // statusline gone
  });

  it("footer variant (single-line draft): strips the box AND the footer below it", () => {
    const lines = fixtureLines("claude--draft-footer-single.txt");
    const kept = joined(stripChrome(lines));
    expect(kept).toContain("Wired up the token refresh path"); // content above survives
    expect(kept).not.toContain("update the changelog"); // the box draft is chrome
    expect(kept).not.toContain("● main"); // footer gone with the box
  });

  it("footer variant (wrapped draft): strips the multi-line box AND the footer", () => {
    const lines = fixtureLines("claude--draft-footer-wrapped.txt");
    const kept = joined(stripChrome(lines));
    expect(kept).toContain("Wired up the token refresh path"); // content above survives
    expect(kept).not.toContain("soft-wraps it onto several"); // wrapped continuation gone
    expect(kept).not.toContain("worker:scout"); // footer gone
  });
});

describe("stripChrome — conservative: leaves non-chrome untouched", () => {
  it("returns the same buffer (same reference) when there's no tail chrome", () => {
    const lines = splitLines(parseAnsi("hello\nworld"));
    expect(stripChrome(lines)).toBe(lines);
  });

  it("strips a WRAPPED draft box (multi-line ❯) off the tail, keeping the output above", () => {
    // A long stranded draft soft-wraps onto continuation lines inside the box; the whole box must
    // still come off the mirror (regression: it used to stay visible, raw draft and all).
    const lines = fixtureLines("claude--draft-wrapped.txt");
    const kept = joined(stripChrome(lines));
    expect(stripChrome(lines).length).toBeLessThan(lines.length);
    expect(kept).toContain("Welcome back altan!"); // real content above survives
    expect(kept).not.toContain("soft-wraps"); // the wrapped-draft continuation is gone
    expect(kept).not.toContain("used to stay"); // ...and its last line too
    expect(kept).not.toContain("manual mode on"); // statusline/hint gone with the box
  });

  it("does not strip a blocked-state menu (its footer is not an input box)", () => {
    const lines = fixtureLines("claude--trust-prompt.txt");
    const result = stripChrome(lines);
    expect(result).toBe(lines); // untouched
    const kept = joined(result);
    expect(kept).toContain("Enter to confirm"); // footer preserved
    expect(kept).toContain("Yes, I trust this folder"); // option preserved
  });

  it("only trims trailing blank lines when no box is present", () => {
    const lines = splitLines(parseAnsi("output line\n\n\n"));
    const kept = joined(stripChrome(lines));
    expect(kept).toBe("output line");
  });
});

// extractStatusLines hands back the whole run stripChrome peels off under the input box, so the app
// can re-surface it above the composer. Positional (the non-blank run below the bottom border), never
// content-parsed. It returned only the FIRST line until a field case broke that assumption: a user
// running a `statusLine` hook had it paint `[PONYTAIL]` above Claude's own line, and the app strip
// showed that and nothing else — no branch, no model, no auto-mode indicator.
describe("extractStatusLines — recovers the stripped chrome under the box", () => {
  it("working: keeps the statusline AND the hint under it", () => {
    const status = extractStatusLines(fixtureLines("claude--working.txt"));
    expect(status.length).toBeGreaterThan(0);
    expect(status[0]).toContain("feature/block-renderer"); // the branch survives
    expect(status[0]).toContain("151.5k tokens");
    // The "hint" is real state (permission mode, ⏵⏵ auto mode), not decoration — it stays.
    expect(status.join(" ")).toContain("bypass permissions");
  });

  it("fresh-idle: the statusline leads, the hint follows", () => {
    const status = extractStatusLines(fixtureLines("claude--fresh-idle.txt"));
    expect(status[0]).toContain("fixture-sandbox");
    expect(status.join(" ")).toContain("← for agents");
  });

  it("done: returns the statusline of a completed turn", () => {
    const status = extractStatusLines(fixtureLines("claude--done.txt"));
    expect(status.join(" ")).toContain("tokens");
  });

  // A statusline HOOK paints its own line above Claude's. Both are wanted; picking one loses the
  // other, and which one matters isn't this parser's call.
  it("keeps every line of a multi-line statusline, in order", () => {
    const status = extractStatusLines(
      boxBufferWithStatus("❯ ", ["[PONYTAIL]", "⏵⏵ auto mode on (shift+tab to cycle) · ← 3 agents"]),
    );
    expect(status).toEqual(["[PONYTAIL]", "⏵⏵ auto mode on (shift+tab to cycle) · ← 3 agents"]);
  });

  // The blank line under the hint is the TUI's own separator before the background-agents footer.
  // That footer is a different thing (and Collie shows the herd itself), so the run stops there.
  it("footer variant: stops at the blank before the background-agents footer", () => {
    const status = extractStatusLines(fixtureLines("claude--draft-footer-empty.txt"));
    expect(status.join(" ")).toContain("ctx:33%");
    expect(status.join(" ")).not.toContain("worker:scout");
  });

  it("returns nothing when a menu is up (no input box at the tail)", () => {
    expect(extractStatusLines(fixtureLines("claude--select-menu.txt"))).toEqual([]);
    expect(extractStatusLines(fixtureLines("claude--trust-prompt.txt"))).toEqual([]);
    expect(extractStatusLines(fixtureLines("claude--permission-bash.txt"))).toEqual([]);
  });

  it("returns nothing for a plain buffer with no input box", () => {
    expect(extractStatusLines(splitLines(parseAnsi("just some output\nmore output")))).toEqual([]);
  });
});

// extractInputDraft recovers a user draft stranded on the "❯" prompt line (a queued-then-recalled
// message that stripChrome would otherwise hide) — the marker + separator stripped, trimmed; null
// for an empty box, a TUI placeholder, or no box at the tail.
describe("extractInputDraft — recovers a stranded prompt-line draft", () => {
  it("done: returns the draft left in the input box (the text stripChrome hides)", () => {
    // The same fixture whose draft stripChrome removes as chrome — here we surface it instead.
    const draft = extractInputDraft(fixtureLines("claude--done.txt"));
    expect(draft).toBe("cat hello.txt to verify");
  });

  it("returns null for an empty box (bare ❯)", () => {
    expect(extractInputDraft(boxBuffer("❯"))).toBeNull();
    expect(extractInputDraft(boxBuffer("❯ "))).toBeNull();
  });

  it("returns null for the queued-messages placeholder line", () => {
    expect(extractInputDraft(boxBuffer("❯ Press up to edit queued messages"))).toBeNull();
  });

  it("returns null when there's no input box at the tail", () => {
    expect(extractInputDraft(splitLines(parseAnsi("just some output\nmore output")))).toBeNull();
    expect(extractInputDraft(fixtureLines("claude--trust-prompt.txt"))).toBeNull();
  });

  it("returns the draft even when a statusline sits below the box", () => {
    const draft = extractInputDraft(boxBuffer("❯ fix the flaky test", "[Opus 4.8] · ctx:3% · main · 32k tokens"));
    expect(draft).toBe("fix the flaky test");
  });

  it("trims leading and trailing whitespace around the draft", () => {
    expect(extractInputDraft(boxBuffer("❯   spaced out draft   "))).toBe("spaced out draft");
  });

  // Ground truth for the in-flight self-race (fix: draft-detect). The parse is stateless per snapshot
  // by design, so it DOES read our own just-typed reply as a "draft" during the bridge's ~350ms
  // send_text→Enter gap — that's exactly why the cross-poll stabiliser + match-last-sent guard exist
  // upstream (see use-terminal-draft.ts / composer.tsx). These two pin the parse behaviour those
  // guards depend on.
  it("mid-send in-flight frame: reads the just-typed text off the ❯ line (the false positive to suppress)", () => {
    // The composer typed "/rename"; the bridge hasn't pressed Enter yet, so it sits on the box line.
    expect(extractInputDraft(fixtureLines("claude--send-inflight.txt"))).toBe("/rename");
  });

  it("self-resolved rename frame: the box is empty again, so no draft is read", () => {
    // A poll or two later the command has submitted (spinner up, prompt cleared) — nothing stranded.
    expect(extractInputDraft(fixtureLines("claude--rename-resolved.txt"))).toBeNull();
  });

  // Background-agents footer present below the box — the case that regressed on real panes: the extra
  // footer lines broke locateInputBox, so no draft surfaced. With the footer tolerated, an empty box
  // is still null (no chip), and a real draft (single-line or wrapped) is recovered as before.
  it("footer variant (empty box): no draft to recover", () => {
    expect(extractInputDraft(fixtureLines("claude--draft-footer-empty.txt"))).toBeNull();
  });

  it("footer variant (single-line draft): recovers the draft above the footer", () => {
    expect(extractInputDraft(fixtureLines("claude--draft-footer-single.txt"))).toBe(
      "remember to update the changelog before tagging",
    );
  });

  it("footer variant (wrapped draft): folds the continuations back, footer notwithstanding", () => {
    expect(extractInputDraft(fixtureLines("claude--draft-footer-wrapped.txt"))).toBe(
      "this stranded draft is long enough that the Claude Code TUI soft-wraps it onto several continuation lines inside the input box while the background-agents footer sits below the box",
    );
  });

  it("folds a WRAPPED draft back into one line (real capture)", () => {
    // A long draft the TUI soft-wrapped across the box — the continuation lines are stitched back on.
    const draft = extractInputDraft(fixtureLines("claude--draft-wrapped.txt"));
    expect(draft).toBe(
      "this stranded draft is long enough that Claude soft-wraps it onto several lines inside the input box which is exactly the case that used to stay visible",
    );
  });

  it("joins a synthetic wrapped draft with single spaces (de-indented continuations)", () => {
    const draft = extractInputDraft(
      wrappedBoxBuffer("❯ the quick brown fox jumps over", ["  the lazy dog again and", "  again"]),
    );
    expect(draft).toBe("the quick brown fox jumps over the lazy dog again and again");
  });

  // Conservatism: the multi-line scan is bounded (MAX_DRAFT_LINES) and aborts on a border en route,
  // so it can't run away up a borderless buffer and strip real output as a giant "draft".
  it("does not match a box whose draft exceeds the wrap bound (falls back to raw)", () => {
    const tooMany = Array.from({ length: 20 }, (_, i) => `  continuation ${i}`);
    expect(extractInputDraft(wrappedBoxBuffer("❯ opening line", tooMany))).toBeNull();
  });
});
