// Push subtitle — fills in the "what actually happened" half of the body notify-content.ts leaves
// empty on the first, plain push. Title and layout are that module's, not this one's: this file only
// ever supplies the subtitle string. The free tier below is NOT optional — it costs a transcript read, so its only condition is transcripts being on
// at all. `NotifyPrefs.copilotSubtitle` (off by default) gates the SLOW tier and nothing else: the
// caller folds it into `copilot.enabled` (index.ts's onFire hook), so "off" here means "no copilot
// polish", never "no subtitle".
//
// TWO TIERS, RENDERED IN THAT ORDER — FAST ONE FIRST, ALWAYS. The free tier (the agent's own last
// transcript line, verbatim) needs nothing but a file read (~10-60ms — see context.ts's own
// measurement) and renders as soon as it's ready. The copilot REPHRASES that into one clean sentence,
// but it's a serialised agent turn — seconds to minutes, one request at a time across the whole board
// — so it lands, if at all, as a LATER upgrade over the fast one, never instead of it. Landing the
// fast tier first is deliberate, not just "first is faster to code": a pane the operator has already
// handled by the time the copilot's turn comes back is exactly the case notify-subtitle's staleness
// guard exists for (see below) — putting the free tier first means that guard only ever costs the
// copilot's polish, never the notification's only chance at being informative at all.
//
// TWO-STAGE PUSH (now three-stage, counting the base one), DELIBERATELY. A push notification's value
// decays fast, so waiting for EITHER tier before the FIRST push would defeat the alert — the plain
// push fires immediately, unchanged (NotificationCoordinator). Each tier here that lands fires a
// SILENT update (`renotify:false`) on the same tag, re-rendering the very same composition with the
// subtitle filled in — the title and the repo are never touched. If the alert has since resolved,
// or a second one joined it and the summary became a multi-agent digest, THAT tier's update is dropped: nothing stale
// ever lands on the lock screen, whether it's the fast tier or the copilot's later upgrade.

import { notifySubtitlePrompt, toNotifySubtitle } from "./copilot.ts";
import { notifyContent } from "./notify-content.ts";
import type { Alert, FiredAlert, NotifySink } from "./notifications.ts";
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

interface EnrichOpts {
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
}

/**
 * Render one subtitle update, but only if the alert it's ABOUT is still the thing on screen —
 * unchanged status, still the sole outstanding one (not swallowed into a multi-agent digest). Shared
 * by both tiers below, since both can equally arrive after the pane has moved on; returns whether it
 * actually rendered, so a caller can tell "landed" from "the pane moved on" without duplicating the
 * check itself.
 */
function pushSubtitle(opts: EnrichOpts, alert: FiredAlert, subtitle: string): boolean {
  const current = opts.coordinator.currentSolo(alert.paneId);
  if (!current || current.status !== alert.status) {
    console.log(`[notify-subtitle] dropped a stale answer for ${alert.paneId}`);
    return false;
  }
  console.log(`[notify-subtitle] ${alert.paneId}: "${subtitle}"`);
  // Same composer as the plain push this replaces (notify-content.ts) — the ONLY difference between
  // the two renders is the subtitle, so an upgrade can never also rewrite the title back to a
  // different sentence about the same alert.
  opts.sink.render({ ...notifyContent(current, subtitle), paneId: alert.paneId, renotify: false });
  opts.notifyLog?.enrich(alert.paneId, alert.status, subtitle);
  return true;
}

/**
 * Render the agent's own last line first (the fast tier — see the header), then let the copilot
 * upgrade it once it answers, if it still can. Fire-and-forget by design — call from the
 * coordinator's `onFire` hook without awaiting it there, and never let a failure here surface: every
 * input is best-effort.
 */
export async function enrichNotification(opts: EnrichOpts): Promise<void> {
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

  // FAST TIER — no queue to wait on, so this is the notification's real shot at being informative;
  // see the header for why it goes first rather than only being a fallback for a failed copilot call.
  const fastLanded = lastMessage ? pushSubtitle(opts, alert, rawFallbackSubtitle(lastMessage)) : false;

  if (!opts.copilot.enabled) {
    if (!fastLanded) console.log(`[notify-subtitle] nothing to enrich ${alert.paneId} from — skipping`);
    return;
  }

  // The diff is copilot-prompt material only — a raw `--stat` listing isn't subtitle material on its
  // own the way the agent's own sentence is — so it's not worth a git subprocess when the copilot
  // isn't even going to see it.
  const statSummary =
    alert.status === "done" ? await opts.statFor({ cardId: alert.cardId, cwd: alert.cwd }).catch(() => null) : null;
  if (!lastMessage && !statSummary && !card?.spec) {
    if (!fastLanded) console.log(`[notify-subtitle] nothing to enrich ${alert.paneId} from — skipping`);
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
  // SLOW TIER upgrade. Dropped exactly like the fast one above if the pane has moved on by now — and
  // that's fine even when it does: the fast tier, if it had anything to work with, already landed.
  pushSubtitle(opts, alert, subtitle);
}
