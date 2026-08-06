// Copilot-authored push subtitle — turns "repo · card title" into "repo · what actually happened",
// spending the same fire-and-forget agent turn the post-`done` review already does. Optional
// (`NotifyPrefs.copilotSubtitle`, off by default) and a no-op unless the copilot itself is enabled.
//
// TWO-STAGE, DELIBERATELY. The copilot is a serialised agent turn — seconds to minutes, one request
// at a time across the whole board — and a push notification's value decays fast, so waiting for it
// before the FIRST push would defeat the alert. The plain push fires immediately, unchanged
// (NotificationCoordinator). This module fires a SECOND, SILENT update (`renotify:false`) on the same
// tag once the copilot answers, replacing only the half of the body after the repo name — the repo
// itself is never touched. If the alert has since resolved, or a second one joined it and the summary
// became a multi-agent digest, the update is dropped: nothing stale ever lands on the lock screen.

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
}): Promise<void> {
  if (!opts.copilot.enabled) return;
  const { alert } = opts;
  const card = alert.cardId ? opts.board.getCard(alert.cardId) : null;

  const transcriptBy = alert.agentSessionId
    ? { sessionId: alert.agentSessionId }
    : opts.resolvePath
      ? await opts.resolvePath({ paneId: alert.paneId, cwd: alert.cwd })
          .then((p) => (p ? { path: p } : null))
          .catch(() => null)
      : null;

  const [lastMessage, statSummary] = await Promise.all([
    transcriptBy && opts.transcripts
      ? lastAssistantSnippet(opts.transcripts, transcriptBy)
      : Promise.resolve(null),
    // Every `done` pane gets a diff attempt now, card or not — a hand-launched agent has no branch
    // to measure from, so `cwdDiffSummary` (via statFor) just reads what's currently uncommitted.
    alert.status === "done"
      ? opts.statFor({ cardId: alert.cardId, cwd: alert.cwd }).catch(() => null)
      : Promise.resolve(null),
  ]);
  // Nothing beyond what the plain push already shows (the card title) — not worth an agent turn.
  if (!lastMessage && !statSummary && !card?.spec) {
    console.log(`[notify-subtitle] nothing to enrich ${alert.paneId} from — skipping`);
    return;
  }

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
  const subtitle = toNotifySubtitle(parsed);
  if (!subtitle) {
    console.warn(`[notify-subtitle] copilot gave no usable subtitle for ${alert.paneId}`);
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
}
