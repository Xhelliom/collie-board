// The multi-select race guards — prompt-action's philosophy applied to the checkbox AskUserQuestion
// dialog, whose Submit is a CLOSED-LOOP choreography (never a blind Enter):
//
//   - A digit TOGGLES its option on/off (pointer-independent, deterministic). "Chat about this"
//     aborts the tool. The review screen's 1/2 submit/cancel. Each of these is one guarded keystroke.
//   - Submit (checkbox → review) is the hard case: Enter activates the POINTED row, NOT a global
//     submit, and Down CLAMPS at the bottom ("Chat about this") with "Submit" exactly one row above
//     it. So the deterministic macro is: clamp Down to the bottom → Up once → VERIFY the pointer sits
//     on "Submit" → only then Enter. The pointer is re-derived from a fresh read at every step, so a
//     checkbox flip / dialog change mid-macro aborts BEFORE any Enter.
//
// Every flow starts with the same entry guard as the sibling actions: a FRESH pane read, the
// unconditional revision check, and a full model re-derivation compared against what the user tapped
// (Herdr 0.7.x's revision is a stub — the re-derivation is the load-bearing check). The mid-flight
// verification polls re-derive from fresh reads again, keyed on a pointer/checked-independent identity
// so the macro's own Down/Up moves don't read as drift.

import { sendKeys } from "./api";
import { type MultiSelectModel, type WizardStepChip } from "./blocks";
import { detectMultiSelect } from "./harness/claude/multi-select";
import { defaultSleep, entryGuard, readModel, type ActionResult, type Sleep } from "./harness/guard";

/** One tap's intent, resolved to keystrokes by {@link submitMultiSelectIntent}. Shared with the
 *  MultiSelectBlock renderer (its `onAction` emits exactly these). */
export type MultiSelectIntent =
  | { kind: "toggle"; n: number } // checkbox: toggle option n on/off
  | { kind: "escape" } //            checkbox: "Chat about this" — aborts the tool
  | { kind: "advance" } //           checkbox: the closed-loop Down→Up→verify→Enter macro onto the
  //                                 advance row ("Submit" on the last question, "Next" before it)
  | { kind: "nav"; keys: string[] } // checkbox step of a wizard: Left/Right to another question
  | { kind: "confirm" } //           review: submit the answers (digit 1)
  | { kind: "cancel" }; //           review: back to the checkboxes (digit 2)

/** Are these the same wizard step? The `signature` normalises `☒/☑ → ☐` across the WHOLE chip line
 *  (it has to: the current question's chip flips on the first tick), which also erases which step you
 *  are on. Two questions of one wizard sharing a question text and option labels would otherwise be
 *  byte-identical to the guard, and a tap meant for the first would land on the second. Compared
 *  explicitly here, exactly as preview-action does. */
function sameSteps(a: WizardStepChip[] | null, b: WizardStepChip[] | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  return a.every(
    (s, i) => s.label === b[i]!.label && s.answered === b[i]!.answered && s.current === b[i]!.current,
  );
}

/**
 * Whether two detected dialogs are the same on-screen state — the entry-guard `equals`. The
 * pointer/checkbox-independent core signature is decisive (a re-rendered dialog / different subject
 * changes it); question + options (labels AND `checked`) re-introduce the checkbox state the
 * signature normalises out, so the FULL visible state participates. The pointer is deliberately NOT
 * compared — it is transient (the Submit macro moves it) and the signature already strips it.
 */
export function multiSelectEquals(a: MultiSelectModel, b: MultiSelectModel): boolean {
  if (a.phase !== b.phase) return false;
  if (a.signature !== b.signature) return false;
  if (a.phase === "checkbox" && b.phase === "checkbox") {
    return (
      sameSteps(a.steps, b.steps) &&
      a.advanceLabel === b.advanceLabel &&
      a.question === b.question &&
      a.options.length === b.options.length &&
      a.options.every(
        (o, i) => o.label === b.options[i]!.label && o.checked === b.options[i]!.checked,
      )
    );
  }
  if (a.phase === "review" && b.phase === "review") return a.incomplete === b.incomplete;
  return false;
}

/**
 * The dialog's identity for the mid-flight polls (pollUntil / the Submit walk) — independent of the
 * transient `❯` pointer, but NOT of the checkbox state. The core signature (pointer/checkbox-normalised)
 * plus question + option labels AND `checked`: a same-shaped successor (different subject) breaks the
 * signature; the macro's own Down/Up moves only shift the pointer (normalised out of both), so the
 * walk stays on the same dialog — but a box that flipped underfoot IS drift. The Submit walk never
 * toggles a box (it sends only Down/Up/Enter), so folding `checked` in costs nothing on the happy path
 * yet aborts the instant an external actor (a second device) flips a box mid-walk, rather than walking
 * on to Submit and shipping a set the user never saw. Only genuine drift (or the dialog vanishing)
 * resolves to "drifted".
 */
export function multiSelectIdentity(a: MultiSelectModel, b: MultiSelectModel): boolean {
  if (a.phase !== b.phase) return false;
  if (a.signature !== b.signature) return false;
  if (a.phase === "checkbox" && b.phase === "checkbox") {
    return (
      sameSteps(a.steps, b.steps) &&
      a.advanceLabel === b.advanceLabel &&
      a.question === b.question &&
      a.options.length === b.options.length &&
      a.options.every(
        (o, i) => o.label === b.options[i]!.label && o.checked === b.options[i]!.checked,
      )
    );
  }
  return true; // review: the signature is the whole identity
}

interface GuardArgs {
  paneId: string;
  requestedLines: number;
  /** The `revision` the rendered dialog was detected against. */
  detectedRevision: number;
  multi: MultiSelectModel;
  /** The session the pane lives in (undefined = primary) — scopes every read + keystroke below. */
  session?: string;
  /** Test seam for the verification polls' pacing. */
  sleep?: Sleep;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Per-pane serialization of multi-select actions WITHIN this browser context. The Submit macro is a
// multi-step, ~1-2s choreography (walk the pointer, re-reading each step); the single-keystroke
// intents are quick but still a read + a send. Without a mutex, two overlapping calls on the SAME
// pane can interleave dangerously — the acute case: two Submit macros both reaching "pointer on
// Submit" and both sending Enter, where the FIRST lands on the review screen (its pointer already on
// "1. Submit answers") and the SECOND Enter activates it, submitting WITHOUT the user seeing review.
// Two ways in: two devices on one herd, or one device where a mid-redraw briefly unmounts+remounts
// the block and clears its local `sending` lock, inviting a re-tap. A module-scoped in-flight set
// closes the single-device path outright and shrinks the multi-device path to the irreducible
// read→send window (fully closing it would need server-side coordination — out of scope). An overlap
// is rejected as "changed" so the caller simply revalidates onto the fresh state.
const inFlight = new Set<string>();
const paneKey = (paneId: string, session: string | undefined) => `${session ?? ""}\u0000${paneId}`;

/**
 * Dispatch a multi-select intent through the race guard, serialized per pane. Toggle/escape/confirm/
 * cancel are one guarded keystroke each; submit is the closed-loop macro. Pure of any UI — the caller
 * maps the result to a status message + a revalidation. A second call on a pane already mid-action (in
 * this browser context) is rejected as "changed" without touching the terminal.
 */
export async function submitMultiSelectIntent(
  args: GuardArgs & { intent: MultiSelectIntent },
): Promise<ActionResult> {
  const key = paneKey(args.paneId, args.session);
  if (inFlight.has(key)) return { status: "changed" }; // a sibling action holds this pane
  inFlight.add(key);
  try {
    return await dispatchIntent(args);
  } finally {
    inFlight.delete(key);
  }
}

/** Resolve one intent to its guarded keystroke(s). Runs with the per-pane lock held. */
async function dispatchIntent(
  args: GuardArgs & { intent: MultiSelectIntent },
): Promise<ActionResult> {
  const { intent } = args;
  if (intent.kind === "advance") return runAdvanceMacro(args);
  if (intent.kind === "toggle") {
    // Validate the tapped digit against the CURRENT model BEFORE the guard reads: a renderer that
    // emits an out-of-range / non-option `n` must never inject a stray digit into the live terminal.
    // (The entry guard then confirms that model is still on screen, so the digit maps to a real,
    // present option.)
    if (args.multi.phase !== "checkbox" || !args.multi.options.some((o) => o.n === intent.n)) {
      return { status: "changed" };
    }
    return guardedKey(args, [String(intent.n)]);
  }
  if (intent.kind === "nav") {
    // Only a wizard STEP has anywhere to navigate to; a standalone multiSelect has no siblings.
    if (args.multi.phase !== "checkbox" || !args.multi.steps) return { status: "changed" };
    return guardedKey(args, intent.keys);
  }
  if (intent.kind === "escape") {
    if (args.multi.phase !== "checkbox" || !args.multi.escape) return { status: "changed" };
    return guardedKey(args, [String(args.multi.escape.n)]);
  }
  if (intent.kind === "confirm") {
    if (args.multi.phase !== "review") return { status: "changed" };
    return guardedKey(args, ["1"]);
  }
  // cancel
  if (args.multi.phase !== "review") return { status: "changed" };
  return guardedKey(args, ["2"]);
}

/** Entry guard, then send exactly `keys` (one keystroke against the dialog). */
async function guardedKey(args: GuardArgs, keys: string[]): Promise<ActionResult> {
  const guarded = await entryGuard(args, args.multi, detectMultiSelect, multiSelectEquals);
  if (guarded) return guarded;
  try {
    const res = await sendKeys(args.paneId, keys, args.session);
    if (!res.ok) return { status: "error", error: res.error };
    return { status: "sent" };
  } catch (e) {
    return { status: "error", error: errMsg(e) };
  }
}

// The pointer settles fast after a nav key — a pointer move is a cheap redraw, unlike the note-focus
// race the 350ms POLL_DELAY guards — so the Submit walk re-reads on this short cadence and advances
// one row per read. (The old macro polled for "reached the bottom" AFTER every Down, so each
// intermediate step burned the full ~2.8s poll timeout before giving up and stepping again — a
// ~5-row walk stalled ~15s. Re-reading the actual pointer resolves each step in one settle.)
const NAV_SETTLE_MS = 250;

/**
 * The Submit macro (checkbox → review): entry guard → walk the pointer DOWN onto "Submit" → Enter.
 * Each step re-reads the ACTUAL pointer and stops the INSTANT it lands on "Submit" — which sits just
 * above the bottom "Chat about this" row, so a downward walk reaches it first (no overshoot, no
 * back-up). Enter is NEVER sent without a fresh read confirming the pointer is on "Submit", and every
 * read re-checks the dialog IDENTITY, so a drift / a checkbox screen that already advanced / a
 * vanished dialog aborts BEFORE any key. Reaching the review screen re-renders on the next poll, where
 * the user confirms (we do NOT auto-send "1").
 */
async function runAdvanceMacro(args: GuardArgs): Promise<ActionResult> {
  if (args.multi.phase !== "checkbox") return { status: "changed" };
  const guarded = await entryGuard(args, args.multi, detectMultiSelect, multiSelectEquals);
  if (guarded) return guarded;

  const sleep = args.sleep ?? defaultSleep;
  // Bound the walk: enough nudges to cross every navigable row (options + free-text + Submit + Chat)
  // with slack for a couple of swallowed keys, so a wedged pane can't loop forever.
  const maxSteps = args.multi.options.length + 6;

  for (let step = 0; step < maxSteps; step++) {
    let fresh;
    try {
      fresh = await readModel(args.paneId, args.requestedLines, args.session, detectMultiSelect);
    } catch {
      await sleep(NAV_SETTLE_MS); // transient read failure — re-read within the bounded walk
      continue;
    }
    const m = fresh.model;
    if (!m) {
      await sleep(NAV_SETTLE_MS); // TUI mid-redraw hid the tail — re-read without sending a key
      continue;
    }
    // Drift guard: a successor dialog, or the checkbox screen already gone — abort before any key.
    if (!multiSelectIdentity(m, args.multi) || m.phase !== "checkbox") return { status: "changed" };
    if (m.pointer === "advance") {
      // Verified on the advance row: activate it. What appears next — the following question of a
      // wizard, or the review screen — is re-detected by whichever grammar owns it on the next poll.
      // This macro deliberately does not predict another screen's shape.
      return (await send(args, ["Enter"])) ?? { status: "sent" };
    }
    // Nudge toward the advance row: Down for every row above it (options / free-text / none), and Up
    // on the off chance the pointer starts on the bottom "Chat about this" row (advance is above it).
    const sent = await send(args, [m.pointer === "chat" ? "Up" : "Down"]);
    if (sent) return sent;
    await sleep(NAV_SETTLE_MS);
  }
  // Never landed on the advance row within the bounded walk — refresh rather than blind-send.
  return { status: "changed" };
}

/** Send `keys`, returning a terminal ActionResult on failure (error / not-ok) or null on success. */
async function send(args: GuardArgs, keys: string[]): Promise<ActionResult | null> {
  try {
    const res = await sendKeys(args.paneId, keys, args.session);
    if (!res.ok) return { status: "error", error: res.error };
    return null;
  } catch (e) {
    return { status: "error", error: errMsg(e) };
  }
}
