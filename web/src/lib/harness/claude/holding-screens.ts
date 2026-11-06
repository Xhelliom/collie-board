// Claude Code screens that hold the agent while herdr says `idle`: no input box, a choice waiting.
// No import on purpose — the bridge reads this file too (state-engine.ts turns such an `idle` into
// `blocked`), and the web's grammar (markers.ts `namesTrustDialog`) lifts them into buttons.
//
// « Teach auto mode about your environment? » — read off Claude Code 2.1.319: a dialog titled so, over
// a select `Yes` / `Not now` / `Don't show again`, pointer on `Yes`. Seen 2026-11-06 holding a remote
// card that had finished its work: herdr said `idle`, nobody was told.

export const HOLDING_SCREEN_TITLES: readonly RegExp[] = [/teach auto mode about your environment\?/i];

/** Rows at the tail a dialog's title sits within: title, body, three options, footer, blanks. */
const TAIL_ROWS = 16;

/**
 * Whether a pane's text (plain, as `pane.read` gives it) ends on one of these screens: a title in
 * its last rows with no input-box prompt (`❯` at column 0) below it — once answered, the box is back.
 */
export function holdingScreen(text: string): boolean {
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines.at(-1)!.trim() === "") lines.pop();
  const tail = lines.slice(-TAIL_ROWS);
  const title = tail.findLastIndex((l) => HOLDING_SCREEN_TITLES.some((re) => re.test(l)));
  return title !== -1 && !tail.slice(title + 1).some((l) => l.startsWith("❯"));
}
