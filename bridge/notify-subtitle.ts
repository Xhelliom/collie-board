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
}

/**
 * The last assistant text turn in a transcript, single-line and capped — the freshest first-person
 * account of what the agent did or is asking, for the copilot to work from. Null on any read/parse
 * failure or empty transcript; the feature is optional, so that just means a plainer subtitle.
 */
async function lastAssistantSnippet(store: TranscriptReader, sessionId: string): Promise<string | null> {
  const page = await store.page(sessionId, { limit: 6 }).catch(() => null);
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
  /** `cardDiffSummary` — injected so this stays testable without a real git checkout. */
  statFor: (cardId: string) => Promise<string>;
}): Promise<void> {
  if (!opts.copilot.enabled) return;
  const { alert } = opts;
  const card = alert.cardId ? opts.board.getCard(alert.cardId) : null;

  const [lastMessage, statSummary] = await Promise.all([
    alert.agentSessionId && opts.transcripts
      ? lastAssistantSnippet(opts.transcripts, alert.agentSessionId)
      : Promise.resolve(null),
    alert.status === "done" && alert.cardId
      ? opts.statFor(alert.cardId).catch(() => null)
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
