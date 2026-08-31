// The board tells its own story in the bell.
//
// Until now a notification could only ever be about a PANE: an agent went blocked, an agent
// finished. Everything the board itself does — the copilot rendering a review, a cleanup being
// refused, a copilot request quietly failing — happened with nobody watching, and left a trace only
// in a card's journal, which you have to already be on the card to read (NOTIFY_AUDIT.md §6).
//
// The trigger is not a new loop and not a diff of snapshots: it is the JOURNAL. `event` (db.ts) is
// append-only with an autoincrement primary key, every one of these facts is already written to it
// by the code that does them, and so tailing it with `WHERE id > ?` cannot miss a fact between two
// polls the way a state diff can — the journal is written by the ACTION, not derived from a state.
// This rides `engine.onUpdate` alongside `reconcile()` (index.ts), and its per-tick cost is one
// range scan on the primary key that returns zero rows in the normal case (§6.2).
//
// THE CURSOR IS IN MEMORY, initialised to the newest id at construction — so a bridge restart
// resumes from now and never replays the past into the bell. Same posture as `NotifyLog` itself and
// as `CopilotCoordinator.busyCards`: runtime state is never persisted (CLAUDE.md §The board).
//
// IT WRITES TO TWO PLACES, AND THE DIFFERENCE IS THE RETRACTION. {@link tell} is the bell: a story,
// told once, never taken back — `NotifyLog.add()` in the clear, no push, no debounce (§6.6 step 1).
// {@link alarm} and {@link unblocks} are the PHONE: facts that go through the herd's own
// coordinator, and each is here only because it can say WHEN IT STOPS BEING TRUE (§6.1). A fact with
// no retraction predicate would sit in the herd's slot for ever and the digest would keep announcing
// a three-day-old state as if it were now — so it goes to the bell or nowhere.
//
// AND ONE OF THEM OPENS INSTEAD OF ASKING. Everything else in this file reports something that went
// wrong; {@link unblocks} reports that a predecessor finished and a card may now be started (§6.3,
// B4). It is the same slot and the same digest, but its own marker — `Ready`, never `Needs you` —
// and a preference that ships OFF, because nothing is late because the buzz never came. It starts
// nothing: the gate at `startCard` stays a gate, and you are still the one who opens it.
//
// AND THERE IS NO SECOND CHANNEL. Same `collie:herd` slot, same digest, same snooze, same settings
// screen as an agent going blocked. What the coordinator had to give up for that is the assumption
// that an alert is a pane: it keys on an opaque string, and this module keys `card:<id>` (§6.4).

import type { BoardEvent } from "./db.ts";
import type { NotifyLog, NotifyLogEntry } from "./notify-log.ts";
import type { Alert } from "./notifications.ts";

/** A push body has room for one short line, not a stack trace. Same cap as notify-subtitle.ts's. */
const oneLine = (s: string): string => {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > 140 ? `${clean.slice(0, 139)}…` : clean;
};

const str = (payload: unknown, key: string): string | null => {
  const v = (payload as Record<string, unknown> | null)?.[key];
  return typeof v === "string" && v.trim() ? v : null;
};

/**
 * What a journal entry is worth saying in the bell, or null for the thirty-odd types that are worth
 * nothing there. THE FILTER IS THE FACT, NOT THE TRIGGER: the tailer hands everything to this, and
 * a `card.merged` being dropped here is the design working, not a gap.
 *
 * Three facts, and each earns its place by the same test — nobody asked for it, nothing else says
 * it, and there is something to decide once you know (§6.3, B2/B7/B10).
 *
 * Exported for the test: it is the whole editorial judgement of this module.
 */
export function tell(e: BoardEvent): Pick<NotifyLogEntry, "status" | "subtitle"> | null {
  // B2 — the copilot has an opinion on a card you have already stopped watching. The verdict is
  // already in the payload (`complete | partial | drift`), so this costs no read.
  if (e.type === "review.created") {
    const verdict = str(e.payload, "verdict");
    return { status: "done", subtitle: verdict ? `Copilot review: ${verdict}` : "Copilot review is in" };
  }
  // B7 — the worktree or branch is still on your disk because the automatic cleanup refused to
  // touch it. Nothing else reports this: `autoCleanup` is fired by the wrapup coordinator with no
  // tap behind it, so its refusal has no HTTP response to land in (wrapup.ts, integrate.ts).
  if (e.type === "card.cleanup_failed") {
    const stage = str(e.payload, "stage") ?? "cleanup";
    const error = str(e.payload, "error");
    return { status: "blocked", subtitle: oneLine(error ? `${stage} kept: ${error}` : `${stage} kept`) };
  }
  // B10 — a tap that produced nothing. Every copilot request is asynchronous and answers into the
  // card; when it fails there is no answer, and no way to learn that except this.
  if (e.type.startsWith("copilot.") && e.type.endsWith("_failed")) {
    const what = e.type.slice("copilot.".length, -"_failed".length);
    return { status: "blocked", subtitle: `Copilot ${what} failed — ask again` };
  }
  return null;
}

/**
 * What a journal entry is worth WAKING A PHONE for ABOUT ITS OWN CARD, or null — which is all but
 * two of the thirty-odd types ({@link unblocks} carries the third fact, which is about another
 * card). The bar is higher than {@link tell}'s by exactly one condition: §6.1 lets a
 * board fact into the herd's slot only if there is a readable predicate for when it stops being
 * true, and {@link fingerprint} below is that predicate for both of these.
 *
 * Exported for the test, like `tell` — together they are the whole editorial judgement here.
 */
export function alarm(e: BoardEvent): string | null {
  // B1 — the card's pane is gone from the snapshot. No pane transition can report this: the pane is
  // what disappeared. `reconcile()` writes it (cards.ts), and a restarted herdr writes it for the
  // whole board in one tick — which the herd's coalescing slot absorbs into one notification.
  if (e.type === "card.status" && str(e.payload, "to") === "orphaned") {
    return "its agent's pane is gone — relaunch from the last handoff";
  }
  // B5 — the handoff never landed, so the card keeps a session whose agent is out of context and
  // has no successor. THE ONE FAILURE OF THE BOARD NOTHING ELSE REPORTS TODAY: the handoff runs off
  // the poll (handoff.ts), so its failure has no HTTP response to surface in and no pane to signal.
  if (e.type === "handoff.expired") return "handoff never landed — the agent wrote no note";
  if (e.type === "handoff.failed") {
    const error = str(e.payload, "error");
    return oneLine(error ? `handoff failed: ${error}` : "handoff failed");
  }
  return null;
}

/**
 * B4 — whether this entry FREED somebody: a card reaching `done` or `archived` lifts the gate on
 * whatever was waiting for it (`dependsOn`, the gate at cards.ts's `startCard`).
 *
 * Alone of everything in this file it does not describe the card the event is about, so it cannot
 * return a subtitle the way {@link alarm} does: the fact belongs to the SUCCESSORS, which only a
 * query knows ({@link BoardNotifySource.dependentsOf}). That query is the only cost this fact adds
 * over the tailer, and it is paid on a `done`/`archived` and nowhere else (§6.3).
 *
 * AND IT STILL STARTS NOTHING. The gate stays a gate; this is the notification that you may now
 * open it yourself — which is why its marker is `Ready` and its preference ships off (§6.3, note
 * de priorité sur B4).
 */
export function unblocks(e: BoardEvent): boolean {
  if (e.type !== "card.status") return false;
  const to = str(e.payload, "to");
  return to === "done" || to === "archived";
}

/** The columns a card can sit in and still be waiting to be started — the successors this says
 *  anything about, and the exact set its retraction predicate watches it leave. */
const UNSTARTED = new Set(["backlog", "ready"]);

/** The corner of `BoardDb` this needs — enough to keep the test from standing up a database. */
export interface BoardNotifySource {
  lastEventId(): number;
  eventsAfter(after: number): BoardEvent[];
  getCard(id: string): { id: string; title: string; status: string; repoPath: string | null } | null;
  /** The cards waiting on this one, for B4 ({@link unblocks}) — one unindexed scan, on a `done`. */
  dependentsOf(id: string): { id: string; title: string; status: string; repoPath: string | null }[];
  /** The card's live session, for {@link fingerprint} — two indexed reads per armed alert per tick,
   *  of which there are normally none. */
  openSessionFor(id: string): { id: string; handoffRequestedAt: number | null } | null;
}

/** The corner of `NotificationCoordinator` this drives: an opaque key, and its two verbs. */
export interface BoardAlertSink {
  arm(key: string, alert: Alert): void;
  retract(key: string): void;
}

/** The coordinator's key for a card. A herdr pane id never looks like this, which is the whole
 *  reason a prefix is enough to share one map with pane alerts (§6.4). */
const keyFor = (cardId: string): string => `card:${cardId}`;

/**
 * How the card reads RIGHT NOW, as one comparable string — and the retraction predicate of both
 * facts above. Deliberately ONE predicate rather than one per fact: §6.1 asks each fact to say when
 * it stops being true, and both answer the same way. **The alert holds while the card still reads
 * exactly as the fact left it** — same column, same session, same handoff state.
 *
 *   • B1 retracts when the card leaves `orphaned`: relaunched, archived, or moved by hand.
 *   • B5 retracts when the card gets a new session (the handoff landed after all, or the operator
 *     restarted it), when a fresh handoff is requested, or when the card leaves the live columns.
 *   • B4 retracts when the card STARTS — a start moves its column and opens a session, so either
 *     half of this catches it — and when it leaves `backlog`/`ready` any other way. Being dragged
 *     `backlog` → `ready` by hand retracts too, and that is the right answer rather than a near
 *     miss: somebody had the card in front of them.
 *
 * Null once the card is gone, which retracts too — there is no longer anything to open.
 */
function fingerprint(db: BoardNotifySource, cardId: string): string | null {
  const card = db.getCard(cardId);
  if (!card) return null;
  const session = db.openSessionFor(cardId);
  return `${card.status}|${session?.id ?? ""}|${session?.handoffRequestedAt ?? ""}`;
}

export class BoardNotifier {
  private cursor: number;
  /** cardId → the fingerprint its alert was armed against. The alert lives exactly as long as the
   *  card keeps reading that way; {@link sweep} is where that is decided, every tick.
   *
   *  ponytail: written even when the coordinator refused the alert (the `board` preference is off),
   *  because `arm` does not report back — so a disabled preference still costs this two indexed
   *  reads per tick per card until that card moves. Bounded and self-clearing; give `arm` a return
   *  value if a board ever sits on dozens of stalled cards with the preference off. */
  private readonly armed = new Map<string, string>();

  constructor(
    private readonly db: BoardNotifySource,
    private readonly log: NotifyLog,
    /** The herd's coordinator. Omitted (in a test, or if the push half is ever backed out) leaves
     *  this a bell-only tailer, exactly as it shipped in 0.129.0. */
    private readonly alerts?: BoardAlertSink,
  ) {
    this.cursor = db.lastEventId();
  }

  /** One range scan plus one fingerprint per armed alert. Hung off `engine.onUpdate`; no snapshot is
   *  read, so a `disconnected` one is not a case here — `onUpdate` only ever fires after a
   *  successful poll anyway. */
  update(): void {
    for (const e of this.db.eventsAfter(this.cursor)) {
      // Advanced per row and BEFORE the work, so a fact this can't render is still consumed.
      this.cursor = e.id;
      const said = tell(e);
      const alarmed = this.alerts ? alarm(e) : null;
      const freed = this.alerts ? unblocks(e) : false;
      // The card is read only for a fact worth something — the other thirty types cost no query.
      if ((!said && !alarmed && !freed) || !e.cardId) continue;
      // The card as it reads NOW, not as the event left it: both surfaces compose their sentence
      // from the same `cardTitle`/`cardStatus` a pane alert carries (notify-content.ts), and a card
      // deleted since simply has no story left to tell.
      const card = this.db.getCard(e.cardId);
      if (!card) continue;
      if (said) {
        this.log.add({
          ...said,
          cwd: card.repoPath ?? "",
          cardId: card.id,
          cardTitle: card.title,
          cardStatus: card.status,
        });
      }
      // The bell entry for an alarm is not written here: it comes from the coordinator's `onFire`
      // hook 30 seconds later (index.ts), so a fact that retracted inside the debounce — you
      // relaunched the card at your desk — leaves no trace on either surface.
      if (alarmed) this.raise(card, "stalled", alarmed);
      // B4, and the only fact here whose alert is NOT about the card the event names: the event is
      // the predecessor finishing, the news belongs to whoever it was blocking. A successor already
      // past `backlog`/`ready` is a card somebody started by hand before its gate lifted — nothing
      // opened for it, so it is not told.
      if (freed) {
        for (const next of this.db.dependentsOf(card.id)) {
          if (!UNSTARTED.has(next.status)) continue;
          this.raise(next, "ready", oneLine(`“${card.title}” is ${card.status} — this one can start`));
        }
      }
    }
    this.sweep();
  }

  private raise(
    card: { id: string; title: string; status: string; repoPath: string | null },
    status: Alert["status"],
    subtitle: string,
  ): void {
    const mark = fingerprint(this.db, card.id);
    if (mark === null) return;
    this.armed.set(card.id, mark);
    this.alerts?.arm(keyFor(card.id), {
      // No `paneId`: this alert is about a card and there is no terminal behind it, which is what
      // sends every surface's tap to the card (notify-content.ts's `notifyCardId`).
      cwd: card.repoPath ?? "",
      status,
      cardId: card.id,
      cardTitle: card.title,
      cardStatus: card.status,
      subtitle,
    });
  }

  /** Retract every alert whose card has moved on — see {@link fingerprint}. */
  private sweep(): void {
    for (const [cardId, mark] of [...this.armed]) {
      if (fingerprint(this.db, cardId) === mark) continue;
      this.armed.delete(cardId);
      this.alerts?.retract(keyFor(cardId));
    }
  }
}
