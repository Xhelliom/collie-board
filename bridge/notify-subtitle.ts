// Push subtitle — turns "repo · card title" into "repo · what actually happened". Optional
// (`NotifyPrefs.copilotSubtitle`, off by default): even the free tier below reads a transcript file
// the operator may not want read for this.
//
// TWO TIERS. The copilot REPHRASES what happened into one clean sentence — but it's a serialised
// agent turn (seconds to minutes, one request at a time across the whole board) and spends the same
// quota a worker does, so it only runs when the copilot itself is enabled too. Without it (or when it
// answers with nothing usable), this falls back to the agent's own last transcript message, VERBATIM
// — not as good as a rephrase, but free, fast (a file read, ~10-60ms — see context.ts's own
// measurement), and a long way better than the bare card title it replaces.
//
// TWO-STAGE PUSH, DELIBERATELY, either way. A push notification's value decays fast, so waiting for
// either tier before the FIRST push would defeat the alert. The plain push fires immediately,
// unchanged (NotificationCoordinator). This module fires a SECOND, SILENT update (`renotify:false`)
// on the same tag once it has an answer, replacing only the half of the body after the repo name —
// the repo itself is never touched. If the alert has since resolved, or a second one joined it and
// the summary became a multi-agent digest, the update is dropped: nothing stale ever lands on the
// lock screen.

import { notifySubtitlePrompt, toNotifySubtitle } from "./copilot.ts";
import type { Alert, FiredAlert, NotifySink } from "./notifications.ts";
import { paneDisplayName } from "./types.ts";
import type { TranscriptEntry } from "./transcript.ts";

/** Just the corner of `TranscriptStore` this needs — narrowed so a fake can stand in for it in tests
 *  without a real transcript on disk (the real class carries a private cache, which a plain object
 *  literal can never structurally match). */
interface TranscriptReader {
  page(sessionId: string, opts: { limit: number }): Promise<{ entries: TranscriptEntry[] } | null>;
  /** Same page, by resolved file path — the {@link enrichNotification}'s `resolvePath` fallback, for
   *  a pane herdr never gave a session id (verified live: this is common, not the rare case). */
  pageAt(path: string, opts: { limit: number }): Promise<{ entries: TranscriptEntry[] } | null>;
}

/**
 * The last assistant text turn in a transcript, single-line and capped — the freshest first-person
 * account of what the agent did or is asking, for the copilot to work from. Null on any read/parse
 * failure or empty transcript; the feature is optional, so that just means a plainer subtitle.
 */
async function lastAssistantSnippet(
  store: TranscriptReader,
  by: { sessionId: string } | { path: string },
): Promise<string | null> {
  const page = await ("sessionId" in by
    ? store.page(by.sessionId, { limit: 6 })
    : store.pageAt(by.path, { limit: 6 })
  ).catch(() => null);
  if (!page) return null;
  for (let i = page.entries.length - 1; i >= 0; i--) {
    const entry = page.entries[i]!;
    if (entry.role !== "assistant") continue;
    const text = entry.parts
      .filter((p): p is Extract<typeof p, { kind: "text" }> => p.kind === "text")
      .map((p) => p.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) return text.slice(0, 600);
  }
  return null;
}

/** The free-tier subtitle: the agent's own last message, as-is bar whitespace and a length cap — a
 *  push body has room for one short line, not the paragraph an agent's closing message often is. */
function rawFallbackSubtitle(message: string): string {
  const clean = message.replace(/\s+/g, " ").trim();
  return clean.length > 140 ? `${clean.slice(0, 139)}…` : clean;
}

/**
 * Ask the copilot for a one-line subtitle and, if it answers before the alert moved on, silently
 * refresh the live push with it. Fire-and-forget by design — call from the coordinator's `onFire`
 * hook without awaiting it there, and never let a failure here surface: every input is best-effort.
 */
export async function enrichNotification(opts: {
  alert: FiredAlert;
  /** Just the staleness check — see `NotificationCoordinator.currentSolo`. */
  coordinator: { currentSolo(paneId: string): Alert | undefined };
  sink: NotifySink;
  /** Just the corner of `Copilot` this needs — see {@link TranscriptReader} for why it's narrowed. */
  copilot: { enabled: boolean; ask(buildPrompt: (outPath: string) => string): Promise<unknown | null> };
  /** Just the corner of `BoardDb` this needs. */
  board: { getCard(id: string): { title: string; spec: string | null } | null };
  transcripts: TranscriptReader | null;
  /** `resolveWithoutSession`, bound to this session's herdr/transcript source — the same fallback
   *  ContextTracker already relies on for a pane herdr reports no `agent_session` for. Optional: a
   *  bridge with transcripts off, or a caller that doesn't need the fallback, just omits it. */
  resolvePath?: (input: { paneId: string; cwd: string }) => Promise<string | null>;
  /** `cardDiffSummary` for a card, `cwdDiffSummary` otherwise — injected so this stays testable
   *  without a real git checkout. `cardId` is omitted for a hand-launched pane. */
  statFor: (target: { cardId?: string; cwd: string }) => Promise<string>;
  /** Patches the bell's history entry to match the live push — optional so a caller with no log (or
   *  a test) simply doesn't get it. Without this the subtitle would only ever be visible in the
   *  fleeting OS notification, never in the history you'd check after missing it. */
  notifyLog?: { enrich(paneId: string, status: "blocked" | "done", subtitle: string): void };
}): Promise<void> {
  const { alert } = opts;
  const card = alert.cardId ? opts.board.getCard(alert.cardId) : null;

  const transcriptBy = alert.agentSessionId
    ? { sessionId: alert.agentSessionId }
    : opts.resolvePath
      ? await opts.resolvePath({ paneId: alert.paneId, cwd: alert.cwd })
          .then((p) => (p ? { path: p } : null))
          .catch(() => null)
      : null;
  const lastMessage =
    transcriptBy && opts.transcripts ? await lastAssistantSnippet(opts.transcripts, transcriptBy) : null;

  // The diff is copilot-prompt material only — a raw `--stat` listing isn't subtitle material on its
  // own the way the agent's own sentence is — so it's not worth a git subprocess when the copilot
  // isn't even going to see it.
  const statSummary =
    opts.copilot.enabled && alert.status === "done"
      ? await opts.statFor({ cardId: alert.cardId, cwd: alert.cwd }).catch(() => null)
      : null;

  let subtitle: string | null = null;
  if (opts.copilot.enabled && (lastMessage || statSummary || card?.spec)) {
    const parsed = await opts.copilot.ask((out) =>
      notifySubtitlePrompt({
        verb: alert.status === "blocked" ? "needs input" : "finished",
        cardTitle: card?.title ?? alert.cardTitle,
        cardSpec: card?.spec ?? null,
        statSummary,
        lastMessage,
        outPath: out,
      }),
    );
    subtitle = toNotifySubtitle(parsed);
    if (!subtitle) console.warn(`[notify-subtitle] copilot gave no usable subtitle for ${alert.paneId}`);
  }
  // No copilot, or it came back empty — the free tier: the agent's own words, unrephrased.
  if (!subtitle && lastMessage) {
    subtitle = rawFallbackSubtitle(lastMessage);
    console.log(`[notify-subtitle] ${alert.paneId}: falling back to the agent's own last line`);
  }
  if (!subtitle) {
    console.log(`[notify-subtitle] nothing to enrich ${alert.paneId} from — skipping`);
    return;
  }

  // The alert may have resolved (handled at the desk) or been superseded by a second one (now a
  // digest) while the copilot was thinking — either way, this answer no longer describes what's on
  // the lock screen, so it's dropped rather than rendered.
  const current = opts.coordinator.currentSolo(alert.paneId);
  if (!current || current.status !== alert.status) {
    console.log(`[notify-subtitle] dropped a stale answer for ${alert.paneId}`);
    return;
  }

  console.log(`[notify-subtitle] ${alert.paneId}: "${subtitle}"`);
  opts.sink.render({
    title: `${paneDisplayName(current)} ${current.status === "blocked" ? "needs you" : "is done"}`,
    body: `${current.workspaceLabel} · ${subtitle}`,
    paneId: alert.paneId,
    renotify: false,
  });
  opts.notifyLog?.enrich(alert.paneId, alert.status, subtitle);
}
