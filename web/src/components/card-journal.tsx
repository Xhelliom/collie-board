import { useState } from "react";
import { RotateCcw, Sparkles, User } from "lucide-react";

import { Button } from "@/components/ui/button";
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
    <ul className="flex flex-col gap-1">
      {events.slice(0, 30).map((e) =>
        e.type === "card.edited" ? (
          <EditEntry key={e.id} event={e} onRestore={() => onRestore(e.id)} />
        ) : (
          <li key={e.id} className="flex gap-2 text-xs text-muted-foreground">
            <span className="w-16 shrink-0 tabular-nums">{timeAgo(e.ts)}</span>
            <span className="min-w-0 flex-1 truncate">{describeEvent(e)}</span>
          </li>
        ),
      )}
    </ul>
  );
}

/**
 * One overwrite, with what it replaced behind a tap and a Restore beside it.
 *
 * The cause is spelled out rather than shown as a `reason` field: "the copilot rewrote this" and
 * "you rewrote this" call for different reactions, and that distinction is the whole reason the
 * cause is recorded at all.
 */
function EditEntry({ event, onRestore }: { event: BoardEvent; onRestore: () => Promise<void> }) {
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
    <li className="rounded-lg border border-dashed bg-card/40 px-2.5 py-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 text-left text-xs"
      >
        <span className="w-16 shrink-0 tabular-nums text-muted-foreground">{timeAgo(event.ts)}</span>
        {byCopilot ? (
          <Sparkles className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <User className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate">
          {byCopilot ? "The copilot rewrote" : "You edited"} {fieldList(replaced)}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-2 pt-2">
          {replaced.title !== undefined && <Previous label="Title" text={replaced.title} />}
          {replaced.spec !== undefined && <Previous label="Spec" text={replaced.spec ?? "(empty)"} />}
          {replaced.acceptance !== undefined && (
            <Previous label="Acceptance" text={replaced.acceptance.join("\n")} />
          )}
          <p className="text-[11px] text-muted-foreground">
            {payload.truncated
              ? "Shortened for this list — restoring puts the whole text back."
              : "Restoring is itself an edit, so it lands here too and can be undone."}
          </p>
          <Button variant="outline" onClick={() => void restore()} disabled={busy} className="h-9 gap-2">
            <RotateCcw className="size-3.5" />
            {busy ? "Restoring…" : "Restore this version"}
          </Button>
        </div>
      )}
    </li>
  );
}

/** Previous content of one field. A text node, never markdown — this is evidence, not a document. */
function Previous({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
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
  if (replaced.title !== undefined) names.push("the title");
  if (replaced.spec !== undefined) names.push("the spec");
  if (replaced.acceptance !== undefined) names.push("the acceptance criteria");
  if (names.length === 0) return "this card";
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * A one-line English rendering of the other event types. Falls back to the raw type rather than
 * hiding an event nobody has written a sentence for yet — a journal with holes in it is worse than
 * one with a bit of jargon.
 */
export function describeEvent(event: BoardEvent): string {
  const p = (event.payload ?? {}) as Record<string, unknown>;
  switch (event.type) {
    case "card.created":
      return "Card created";
    case "card.status":
      return `Moved from ${String(p.from)} to ${String(p.to)}${p.reason ? ` — ${String(p.reason)}` : ""}`;
    case "card.worktree":
      return `Worktree on ${String(p.branch)}${p.after ? `, after “${String(p.after)}”` : ""}`;
    case "card.prompted":
      return p.followUp ? "Follow-up instruction sent" : "Spec sent to the agent";
    case "card.start_failed":
      return `Start failed at ${String(p.stage)}: ${String(p.error)}`;
    case "card.split_from":
      return p.after ? `Split off, after “${String(p.after)}”` : "Split off from a dictation";
    case "session.opened":
      return "Agent session opened";
    case "session.closed":
      return `Session ended (${String(p.outcome)})`;
    case "review.created":
      return `Reviewed${p.verdict ? `: ${String(p.verdict)}` : ""}`;
    case "copilot.reformulated":
      return `Copilot rewrote the card${Number(p.split) > 0 ? ` and split it into ${String(p.split)}` : ""}`;
    case "copilot.reformulate_failed":
      return "Copilot couldn't rewrite this card";
    case "copilot.review_failed":
      return "Copilot couldn't review this card";
    case "copilot.split_kept":
      return `Split kept — ${String(p.started ?? "a sub-task")} has already started`;
    default:
      return event.type;
  }
}
