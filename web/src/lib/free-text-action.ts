// Answering a dialog's "Type something." row (single-question select or a wizard step): the digit
// moves the pointer onto the row — verified on a fresh read, because text typed while another row
// is pointed would be lost and the Enter would pick THAT option — then the text goes in with its
// Enter. Recipe verified live on Claude Code 2.1.322 (fixtures claude--v2322-select-long*.txt).

import { sendKeys, sendReply } from "./api";
import { detectPromptSelect, type PromptModel } from "./harness/claude/prompt-select";
import { detectWizard, type WizardModel } from "./harness/claude/wizard";
import { entryGuard, pollUntil, sanitizeTypedText, type ActionResult, type Sleep } from "./harness/guard";
import type { StyledLine } from "./blocks";

export const FREE_TEXT_MAX_LENGTH = 1000;

export type FreeTextModel = PromptModel | WizardModel;

// Same arbitration as claudeBuildBlocks: the wizard first, prompt-select bails on a stepper.
const detect = (lines: StyledLine[]): FreeTextModel | null => detectWizard(lines) ?? detectPromptSelect(lines);
const rowOf = (m: FreeTextModel) => ("freeText" in m ? m.freeText : undefined);
// The pointer moving rewrites the signature, so mid-recipe the dialog is recognised by its question.
const sameQuestion = (a: FreeTextModel, b: FreeTextModel) =>
  "question" in a && "question" in b && a.question === b.question;

export async function submitFreeText(args: {
  paneId: string;
  requestedLines: number;
  /** The `revision` the rendered dialog was detected against. */
  detectedRevision: number;
  session?: string;
  model: FreeTextModel;
  text: string;
  /** Test seam for the poll pacing. */
  sleep?: Sleep;
}): Promise<ActionResult> {
  const row = rowOf(args.model);
  const text = sanitizeTypedText(args.text, FREE_TEXT_MAX_LENGTH);
  if (!row || !text) return { status: "changed" };

  const guarded = await entryGuard(args, args.model, detect, (a, b) => a.signature === b.signature);
  if (guarded) return guarded;

  try {
    // Already pointed: the digit would be typed into the row as text.
    if (!row.pointed) {
      const moved = await sendKeys(args.paneId, [String(row.n)], args.session);
      if (!moved.ok) return { status: "error", error: moved.error };
      const pointed = (m: FreeTextModel) => sameQuestion(m, args.model) && rowOf(m)?.pointed === true;
      if ((await pollUntil(args, args.model, detect, pointed, sameQuestion)) !== "ok") return { status: "changed" };
    }
    // shortcut: the Enter follows the text unverified (hc can only paste WITH Enter), stage it
    // like submitPreviewNote if a text is ever seen answering the wrong row.
    const sent = await sendReply(args.paneId, text, true, args.session, true);
    return sent.ok ? { status: "sent" } : { status: "error", error: sent.error };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}
