import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, TriangleAlert, User } from "lucide-react";

import { ChatMessageList, type ChatMessageListHandle } from "@/components/ui/chat/chat-message-list";
import { TranscriptView } from "@/components/transcript-view";
import { fetchHistory } from "@/lib/api";
import type { TranscriptEntry } from "@/lib/types";

// The pane screen's READING mode — the same conversation the mirror shows, but as prose.
//
// WHY THIS EXISTS, and why it isn't a wrap fix. Herdr hands us the pane already cut to the terminal's
// columns (~81), and the mirror then wraps that again at the phone's ~50 — so every paragraph breaks
// twice, the second time mid-sentence. No wrap setting repairs it, because the first cut is baked into
// the bytes. The agent's own transcript was NEVER cut: it is the Markdown Claude actually wrote. So
// reading mode doesn't un-wrap anything — it reads from the source that was never wrapped.
//
// The mirror stays exactly as it was, and stays the mode you PILOT in: native dialog buttons, the key
// grammars, the statusline. This is the mode you READ in. Both are modes of one screen — the composer,
// the statusline and the context gauge below it belong to neither.
//
// NO NEW POLL LOOP (CLAUDE.md → The board). This has no timer of its own — it rides the pane poll's
// own heartbeat (`poll`, the router revalidator's state), and pulls only what is new via `after`
// (bridge/transcript.ts), so a tick that found nothing costs an empty array rather than a re-download
// of the archive.
//
// The heartbeat used to be the pane's `revision`, which is WRONG on the herdr this targets: 0.7.x
// returns `revision: 0` for every pane, always (HERDR_API.md — it's a stub). A revision-driven view
// fetches once at mount and then silently stops, which reads as "the agent went quiet".
//
// Reading mode is one COMPLETED TURN behind the mirror by construction: Claude Code appends a turn to
// its log when the turn ends, while the TUI streams it as it arrives. That's not lag to fix — it's the
// price of reading text that was never cut to a terminal's width — but it is worth saying on screen
// while the agent is working, so a half-written answer doesn't look like a stalled one.

/**
 * Turns held/asked for. Reading mode is the RECENT conversation — the last few exchanges you'd have
 * scrolled the mirror for. The whole archive is one tap away in History, which is the view built for it.
 */
export const READING_TURNS = 40;

/** Ceiling on turns kept in memory, so a session left open on this mode can't grow without bound. */
const MAX_HELD = 300;

/** Why the view is empty, in the user's terms. Each is an ordinary state, not an error. */
const UNAVAILABLE_COPY: Record<string, string> = {
  disabled: "Transcript reading is switched off on this bridge (COLLIE_BOARD_TRANSCRIPT).",
  "no-session": "This pane has no agent session, so there's nothing to read.",
  "no-log": "No transcript file was found for this pane's session yet.",
  error: "Couldn't read the transcript. Switch to Terminal, or try again in a moment.",
  empty: "Nothing in the transcript yet.",
};

/**
 * Fold a freshly-fetched tail into what we already hold.
 *
 * Overlap is deliberate rather than accidental: the fetch re-asks from the SECOND-newest turn, because
 * a tool result lands by MUTATING the turn that made the call (bridge/transcript.ts folds a call and
 * its output into one entry), so the newest turn we hold can still change after we've seen it. Cutting
 * at the first returned uuid therefore REPLACES the stale copy instead of duplicating it.
 *
 * A window with no overlap at all (the log rotated under us, so the server degraded to its newest
 * page) appends. That can leave a gap, which History shows in full — it can never show a duplicate.
 *
 * Pure + exported for the test.
 */
export function mergeTail(
  prev: TranscriptEntry[],
  fresh: TranscriptEntry[],
  max = MAX_HELD,
): TranscriptEntry[] {
  if (fresh.length === 0) return prev;
  const cut = prev.findIndex((e) => e.uuid === fresh[0]!.uuid);
  const head = cut === -1 ? prev : prev.slice(0, cut);
  return [...head, ...fresh].slice(-max);
}

export function ReadingView({
  paneId,
  session,
  agent,
  poll,
  working = false,
  pendingInput = null,
  dialogPresent,
  onShowTerminal,
}: {
  paneId: string;
  session?: string;
  /** The pane's agent name, for the per-turn brand icon. */
  agent?: string;
  /**
   * The router revalidator's state — the pane poll's heartbeat. Each cycle settles back to "idle",
   * and that settle is the tick: one incremental pull per poll, no timer of our own.
   */
  poll: string;
  /** The agent is mid-turn, so the turn being typed in the mirror isn't in the log yet. */
  working?: boolean;
  /**
   * Text sitting on the terminal's "❯" input line — typed but not yet taken by the agent (typically
   * written while it was busy). It is NOT in the transcript, and won't be until the agent consumes it.
   */
  pendingInput?: string | null;
  /** A dialog is up in the TUI: it exists ONLY there, so reading mode has to say so. */
  dialogPresent: boolean;
  onShowTerminal: () => void;
}) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [note, setNote] = useState<string | null>(null);
  // What we hold, readable from the fetch without making it depend on the render's closure — otherwise
  // every arriving turn would rebuild `pull` and re-fire the effect.
  const held = useRef<TranscriptEntry[]>([]);
  const busy = useRef(false);
  const listRef = useRef<ChatMessageListHandle>(null);

  const pull = useCallback(async () => {
    if (busy.current) return; // a tick landing on a slow fetch waits for the next one
    busy.current = true;
    try {
      // Cursor = the SECOND-newest turn, so the newest comes back too and its tool results catch up
      // (see mergeTail). With nothing (or one turn) held, ask for the newest page instead.
      const cursor = held.current.at(-2)?.uuid;
      const res = await fetchHistory(
        paneId,
        cursor ? { limit: READING_TURNS, after: cursor } : { limit: READING_TURNS },
        session,
      );
      if (!res.available) {
        held.current = [];
        setEntries([]);
        setNote(UNAVAILABLE_COPY[res.reason] ?? UNAVAILABLE_COPY.error!);
        return;
      }
      const next = cursor ? mergeTail(held.current, res.entries) : res.entries.slice(-MAX_HELD);
      held.current = next;
      setEntries(next);
      setNote(next.length === 0 ? UNAVAILABLE_COPY.empty! : null);
    } catch {
      // Keep whatever is on screen — a poll that failed is not a conversation that vanished.
      if (held.current.length === 0) setNote(UNAVAILABLE_COPY.error!);
    } finally {
      busy.current = false;
    }
  }, [paneId, session]);

  // One pull per completed poll: the effect re-runs on every state change, and "idle" is the settle.
  // A pull skipped because one was still in flight is retried by the next beat, so the view converges
  // on its own instead of staying one turn behind forever.
  useEffect(() => {
    if (poll === "idle") void pull();
  }, [poll, pull]);

  // Open on the newest turn, the same place the mirror opens.
  useEffect(() => {
    listRef.current?.scrollToBottom();
  }, []);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* A dialog lives ONLY in the TUI — reading mode can't render it and the composer refuses to
          type past it. Without this banner an agent could sit blocked behind a question the reader
          never sees, which is the one way this mode could be worse than no mode at all. */}
      {dialogPresent && (
        <button
          type="button"
          onClick={onShowTerminal}
          className="mx-3 mt-1.5 flex shrink-0 items-center gap-2 rounded-md border border-status-blocked/40 bg-status-blocked/15 px-3 py-2 text-left text-sm transition-colors active:bg-status-blocked/25"
        >
          <TriangleAlert className="size-4 shrink-0 text-status-blocked" />
          <span className="min-w-0 flex-1">A question is waiting — it can only be answered here.</span>
          <span className="shrink-0 font-medium underline">Terminal</span>
        </button>
      )}

      <div className="min-h-0 min-w-0 flex-1">
        <ChatMessageList ref={listRef} dep={entries} className="px-3 py-3">
          {entries.length === 0 ? (
            <div className="px-2 py-16 text-center text-sm text-muted-foreground">
              {note ?? "Loading…"}
            </div>
          ) : (
            <>
              <TranscriptView entries={entries} agent={agent} />
              {/* Text sitting on the terminal's "❯" line — a DRAFT, which is not the same thing as a
                  queued message and must not read as one. A draft was typed and not submitted (the
                  common case: you wrote it while the agent was busy compacting); a QUEUED message was
                  submitted, and Claude Code then replaces the line with "Press up to edit queued
                  messages" — its text is nowhere in the mirror, so this block can never show it (see
                  INPUT_PLACEHOLDERS in harness/claude/chrome.ts, which is why the draft goes null).
                  Same vocabulary as the composer's own chip, so one thing has one name in this app.
                  Rendered dashed and muted: it is the one thing on screen that is NOT in the
                  conversation. Verbatim text node, never Markdown — this is raw input. */}
              {pendingInput && (
                <div className="mt-3 rounded-lg border border-dashed bg-muted/30 px-3 py-2">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    <User className="size-3" />
                    Draft in terminal · not sent
                  </div>
                  <div className="whitespace-pre-wrap break-words text-base text-muted-foreground">
                    {pendingInput}
                  </div>
                </div>
              )}
              {working && (
                <div className="flex items-center gap-2 px-1 pt-3 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Still writing — this turn appears when the agent finishes it.
                </div>
              )}
            </>
          )}
        </ChatMessageList>
      </div>
    </div>
  );
}
