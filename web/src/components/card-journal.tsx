import { useState, type ReactNode } from "react";
import { RotateCcw, Sparkles, User } from "lucide-react";

import { t, useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";
import type { BoardEvent } from "@/lib/board";

// The card's journal — and the one place an overwritten spec can be got back.
//
// It used to render `card.edited {"reason":"copilot",…}` in monospace, which is a developer's view
// of a database table: nobody restores anything from that. Every overwrite of a card's written
// fields is recorded with the text it replaced (bridge/db.ts → patchCard), so the history already
// exists; this makes it legible and gives it a button.
//
// The replaced text arrives TRUNCATED — the journal rides the polled card response, so carrying
// every past spec whole would grow that response without bound. A preview is enough to decide,
// because restoring is itself journalled and therefore undoable.
//
// Redesign: a flat list now — every entry (edit or not) is the SAME row shape (timestamp · icon ·
// sentence), so an edit doesn't stand out as its own boxed thing. Restaurer is a small button on the
// row itself rather than a tap-to-reveal, and IT is what expands the previous text in place; the
// actual write stays a second, explicit tap inside that expansion — restoring a spec is state you
// can't casually undo a second time, so it keeps the same "show what you're about to do" shape as
// everywhere else in this app.

/** What a `card.edited` payload looks like once the bridge has trimmed it for this view. */
interface EditPayload {
  reason?: string;
  truncated?: boolean;
  replaced?: { title?: string; spec?: string | null; acceptance?: string[] };
}

export function CardJournal({
  events,
  onRestore,
}: {
  events: BoardEvent[];
  onRestore: (eventId: number) => Promise<void>;
}) {
  if (events.length === 0) return null;
  return (
    <ul className="flex flex-col">
      {events.slice(0, 30).map((e) =>
        e.type === "card.edited" ? (
          <EditEntry key={e.id} event={e} onRestore={() => onRestore(e.id)} />
        ) : (
          <JournalRow
            key={e.id}
            ts={e.ts}
            icon={<EventIcon type={e.type} />}
            // The lead's reason IS the entry — it's what you read instead of the diff, so it wraps.
            wrap={e.type.startsWith("run.")}
          >
            {describeEvent(e)}
          </JournalRow>
        ),
      )}
    </ul>
  );
}

/** The shared row shape every entry renders as — timestamp, a 12px icon (or an empty spacer of the
 *  same size, so the sentence column still lines up), then the sentence. */
function JournalRow({
  ts,
  icon,
  wrap = false,
  children,
}: {
  ts: number;
  icon: ReactNode;
  wrap?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs">
      <span className="w-[60px] shrink-0 tabular-nums text-muted-foreground">{timeAgo(ts)}</span>
      <span className="flex size-3 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 text-foreground",
          wrap ? "whitespace-pre-wrap break-words" : "truncate",
        )}
      >
        {children}
      </span>
    </li>
  );
}

/** Sparkles for the copilot, User for a human edit, nothing (an empty spacer) for every other kind
 *  of event — a session open/close or a status move isn't "caused" by either in the same sense. */
function EventIcon({ type }: { type: string }) {
  if (type.startsWith("copilot.")) return <Sparkles className="size-3" />;
  return null;
}

/**
 * One overwrite, with what it replaced behind Restaurer.
 *
 * The cause is spelled out rather than shown as a `reason` field: "the copilot rewrote this" and
 * "you rewrote this" call for different reactions, and that distinction is the whole reason the
 * cause is recorded at all.
 */
function EditEntry({ event, onRestore }: { event: BoardEvent; onRestore: () => Promise<void> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const payload = (event.payload ?? {}) as EditPayload;
  const replaced = payload.replaced ?? {};
  const byCopilot = payload.reason === "copilot";

  async function restore() {
    setBusy(true);
    try {
      await onRestore();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg px-2 py-1.5">
      <div className="flex items-center gap-2.5 text-xs">
        <span className="w-[60px] shrink-0 tabular-nums text-muted-foreground">
          {timeAgo(event.ts)}
        </span>
        <span className="flex size-3 shrink-0 items-center justify-center text-muted-foreground">
          {byCopilot ? <Sparkles className="size-3" /> : <User className="size-3" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-foreground">
          {byCopilot ? t("journal.copilotRewrote") : t("journal.youEdited")} {fieldList(replaced)}
        </span>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="shrink-0 rounded-lg border border-border px-[9px] py-[3px] text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/60"
        >
          {t("journal.restore")}
        </button>
      </div>

      {open && (
        <div className="flex flex-col gap-2 pl-[74px]">
          {replaced.title !== undefined && <Previous label={t("journal.field.title")} text={replaced.title} />}
          {replaced.spec !== undefined && <Previous label={t("journal.field.spec")} text={replaced.spec ?? t("journal.empty")} />}
          {replaced.acceptance !== undefined && (
            <Previous label={t("journal.field.acceptance")} text={replaced.acceptance.join("\n")} />
          )}
          <p className="text-xs text-muted-foreground">
            {payload.truncated
              ? t("journal.shortened")
              : t("journal.restoreIsEdit")}
          </p>
          <button
            type="button"
            onClick={() => void restore()}
            disabled={busy}
            className={cn(
              "flex w-fit items-center gap-1.5 rounded-lg border border-border px-[9px] py-[3px] text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/60",
              busy && "opacity-60",
            )}
          >
            <RotateCcw className="size-[11px]" />
            {busy ? t("journal.restoring") : t("journal.restoreThis")}
          </button>
        </div>
      )}
    </li>
  );
}

/** Previous content of one field. A text node, never markdown — this is evidence, not a document. */
function Previous({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <p className="whitespace-pre-wrap break-words rounded-md bg-muted/50 px-2 py-1.5 text-xs">
        {text}
      </p>
    </div>
  );
}

/**
 * Has a HUMAN rewritten this card since the copilot last did?
 *
 * Reformulate works from the ORIGINAL DICTATION, so it discards whatever you typed by hand. That is
 * right when the copilot's own draft disappointed you, and wrong when you have just spent five
 * minutes on the spec — and the journal is the only thing that can tell the two apart. Events come
 * newest first, so the most recent edit decides and the rest is history.
 *
 * Pure + exported: the answer gates a confirmation, and getting it wrong either nags on every card
 * or silently eats an edit.
 */
export function editedByHandSince(events: BoardEvent[]): boolean {
  for (const e of events) {
    if (e.type !== "card.edited") continue;
    return (e.payload as { reason?: string } | null)?.reason !== "copilot";
  }
  return false;
}

/** "the spec", "the title and the spec" — exported for the unit test. */
export function fieldList(replaced: EditPayload["replaced"] = {}): string {
  const names: string[] = [];
  if (replaced.title !== undefined) names.push(t("journal.of.title"));
  if (replaced.spec !== undefined) names.push(t("journal.of.spec"));
  if (replaced.acceptance !== undefined) names.push(t("journal.of.acceptance"));
  if (names.length === 0) return t("journal.of.card");
  if (names.length === 1) return names[0]!;
  return t("journal.and", { list: names.slice(0, -1).join(", "), last: names.at(-1)! });
}

/** What to do about a refused auto-merge, in the operator's words. Exported for the test. */
export function autoMergeHint(error: string): string {
  return /not allowed for this repository/i.test(error) ? t("journal.automerge.off") : error || t("journal.automerge.yourself");
}

/** The decision half of a `run.decision` line; an unknown one shows raw rather than vanishing. */
function leadDecision(p: Record<string, unknown>): string {
  switch (p.decision) {
    case "finished":
      return t("journal.lead.done");
    case "prompt":
      return p.prompt ? t("journal.lead.sentQuoted", { prompt: String(p.prompt) }) : t("journal.lead.sent");
    case "keep":
      return t("journal.lead.kept");
    case "fold":
      return t("journal.lead.folded");
    case "drop":
      // Journaled on the reviewed card — the follow-up itself is deleted — so it names it.
      return p.followUp ? t("journal.lead.droppedNamed", { title: String(p.followUp) }) : t("journal.lead.dropped");
    default:
      return t("journal.lead.decided", { decision: String(p.decision) });
  }
}

/**
 * A one-line rendering of the other event types, in the current language. Falls back to the raw type
 * rather than hiding an event nobody has written a sentence for yet — a journal with holes in it is
 * worse than one with a bit of jargon.
 */
export function describeEvent(event: BoardEvent): string {
  const p = (event.payload ?? {}) as Record<string, unknown>;
  const reason = () => String(p.reason ?? t("journal.noReason"));
  switch (event.type) {
    case "card.created":
      return t("journal.created");
    case "card.status":
      return t("journal.status", { from: String(p.from), to: String(p.to) }) + (p.reason ? ` — ${String(p.reason)}` : "");
    case "card.worktree":
      return t("journal.worktree", { branch: String(p.branch) }) + (p.after ? t("journal.worktreeAfter", { after: String(p.after) }) : "");
    case "card.prompted":
      if (p.command) return t("journal.ran", { command: String(p.command) });
      return p.followUp ? t("journal.followUp") : t("journal.specSent");
    case "card.operator_said":
      return t("journal.operatorSaid", { text: String(p.text ?? "").slice(0, 120) });
    case "card.automerge_armed":
      return t("journal.automerge.armed");
    case "card.automerge_refused":
      return t("journal.automerge.refused", { hint: autoMergeHint(String(p.error ?? "")) });
    case "card.template":
      return t("journal.template", { name: String(p.name ?? "") });
    case "card.start_failed":
      return t("journal.startFailed", { stage: String(p.stage), error: String(p.error) });
    case "card.split_from":
      return p.after ? t("journal.splitAfter", { after: String(p.after) }) : t("journal.split");
    case "session.opened":
      return t("journal.sessionOpened");
    // The other half of an `agent`-origin card's trace (ADR 0010): the new card points back here,
    // and this points forward, at the moment it happened — which is the part a link can't say, and
    // the only thing that tells you WHICH of a card's sessions filed it.
    case "card.filed":
      return t("journal.filed", { title: String(p.title ?? t("journal.untitled")) });
    case "agent.notify":
      return t("journal.agentAsked", { message: String(p.message ?? "") });
    case "session.closed":
      return t("journal.sessionEnded", { outcome: String(p.outcome) });
    case "review.created":
      return t("journal.reviewed") + (p.verdict ? `: ${String(p.verdict)}` : "");
    // The card that came here is GONE — this line is the only thing left saying it ever existed, so
    // it names it. Never "reviewed": nobody reviewed anything, someone tapped Convertir en action.
    case "card.action_added":
      return t("journal.actionAdded", { title: String(p.title ?? t("journal.untitled")) });
    case "copilot.reformulated":
      return t("journal.reformulated") + (Number(p.split) > 0 ? t("journal.reformulatedSplit", { count: Number(p.split) }) : "");
    case "copilot.reformulate_failed":
      return t("journal.reformulateFailed");
    case "copilot.refined": {
      // The instruction IS the entry: "the copilot corrected this card" without saying what you
      // asked for sends you looking for the correction somewhere it isn't.
      const quoted = `“${String(p.instruction ?? "")}”`;
      // On a sub-task the instruction was given to the parent, and saying "on your instruction" on a
      // card you never typed one into reads as the board inventing corrections.
      if (p.parentId) return t("journal.refinedParent", { quoted });
      const subs = Number(p.subtasks) || 0;
      return t("journal.refined", { quoted }) + (subs > 0 ? t("journal.refinedSubs", { count: subs }) : "");
    }
    case "copilot.refine_failed":
      return t("journal.refineFailed", { instruction: String(p.instruction ?? t("journal.thatCorrection")) });
    case "copilot.review_failed":
      return t("journal.reviewFailed");
    case "copilot.explained":
      // The two paragraphs ARE the entry — a line saying "the copilot explained something" would
      // send you looking for the explanation somewhere it isn't.
      return [
        t("journal.explainAbout", { action: String(p.action ?? t("journal.failedAction")) }),
        p.meaning ? String(p.meaning) : null,
        p.next ? t("journal.explainNext", { next: String(p.next) }) : null,
        p.likelyBug ? t("journal.explainBug") : null,
      ]
        .filter(Boolean)
        .join("\n\n");
    case "copilot.explain_failed":
      return t("journal.explainFailed");
    // The lead's journal (ADR 0017) — payloads from bridge/db.ts → RunEventPayloads. Every line
    // carries the reason: a decision without its why is a diff you'd have to go read after all.
    case "run.decision":
      return `${leadDecision(p)} — ${reason()}`;
    case "run.triaged":
      return `${p.accept ? t("journal.triage.accepted") : t("journal.triage.rejected")}${p.verdict ? ` (${String(p.verdict)})` : ""} — ${reason()}`;
    case "run.gate":
      return p.ok ? t("journal.gate.green", { command: String(p.command) }) : t("journal.gate.red", { command: String(p.command) });
    case "run.halted":
      return t("journal.halted", { reason: reason() });
    case "run.finished":
      return t("journal.runFinished");
    case "copilot.split_kept":
      return t("journal.splitKept", { started: String(p.started ?? t("journal.aSubtask")) });
    default:
      return event.type;
  }
}
