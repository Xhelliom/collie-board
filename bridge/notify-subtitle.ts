// Push subtitle — fills in the "what actually happened" half of the body notify-content.ts leaves
// empty on its own. Title and layout are that module's, not this one's: this file only ever supplies
// the subtitle string. The free tiers below are NOT optional — they cost a transcript read and a
// `git --stat`, so their only condition is having something to read. `NotifyPrefs.copilotSubtitle`
// (off by default) gates the SLOW tier and nothing else: the caller folds it into `copilot.enabled`
// (index.ts's onFire hook), so "off" here means "no copilot polish", never "no subtitle".
//
// THE CASCADE (NOTIFY_AUDIT.md §3.3), best content first, and it NEVER bottoms out on the subject:
//
//   1. the copilot's sentence, if it answers      — slow, optional, an upgrade over 2 or 3
//   2. the agent's own last transcript line       — a file read (~1-60ms, see context.ts), verbatim
//   3. `git diff --stat` as one line, for a `done`— "3 files, +180 -12" (~20ms)
//   4. nothing                                    — a body of just the repo beats one that echoes
//                                                   the title, which is what `cardTitle ?? cwd` did
//
// TWO STAGES, SPLIT WHERE THE COST IS (§N10). Tiers 2 and 3 are {@link firstSubtitle}: tens of
// milliseconds on top of a debounce that already made the alert wait 30 SECONDS, so the coordinator
// awaits them and THE FIRST PUSH GOES OUT COMPLETE. That matters far beyond tidiness — every message
// shares one collapse topic (push.ts's SEND_OPTIONS), so a sleeping phone is handed only the LAST
// message on the slot. A body that arrives in a later silent update (`renotify:false`) therefore
// reaches a phone in your hand and NO phone on a nightstand, which is the one that needed the buzz.
// Verified on a locked device: split like that, the alert landed silent.
//
// Only the copilot earns a second stage — a serialised agent turn, seconds to MINUTES, one request
// at a time across the whole board. {@link enrichNotification} is that stage and nothing else: it
// fires a SILENT update (`renotify:false`) on the same tag, re-rendering the very same composition
// with a better subtitle. It is off by default, so the DEFAULT configuration sends exactly one
// message per alert. If the alert has since resolved, or a second one joined it and the summary
// became a multi-agent digest, that update is dropped — nothing stale lands on a lock screen.
//
// AND NOTHING WE WAIT ON MAY HANG. A transcript on a stalled filesystem, a wedged git — both are
// bounded by {@link FIRST_PUSH_DEADLINE_MS} and simply left behind. An empty body is an acceptable
// fallback (tier 4); an alert that never arrives is not.

import { notifySubtitlePrompt, toNotifySubtitle } from "./copilot.ts";
import { diffStatLine, formatDiffStat, type DiffStat } from "./git.ts";
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

/** What both stages read the alert's story from. Every source is best-effort: any of them coming
 *  back empty just means a plainer subtitle, never a missing alert. */
export interface SubtitleSources {
  alert: FiredAlert;
  /** Just the corner of `BoardDb` this needs. */
  board: { getCard(id: string): { title: string; spec: string | null } | null };
  transcripts: TranscriptReader | null;
  /** `resolveWithoutSession`, bound to this session's herdr/transcript source — the same fallback
   *  ContextTracker already relies on for a pane herdr reports no `agent_session` for. Optional: a
   *  bridge with transcripts off, or a caller that doesn't need the fallback, just omits it. */
  resolvePath?: (input: { paneId: string; cwd: string }) => Promise<string | null>;
  /** `cardDiffStat` for a card, a plain `diffStat(cwd, null)` otherwise — injected so this stays
   *  testable without a real git checkout. `cardId` is omitted for a hand-launched pane; null means
   *  there is nothing to measure (no branch, no worktree), which is not the same as measuring zero.
   *  The RAW stat, not a rendered string: it is read two ways below, one per tier. */
  statFor: (target: { cardId?: string; cwd: string }) => Promise<DiffStat | null>;
}

/** {@link SubtitleSources} plus what the copilot's later, silent update needs to land. */
export interface EnrichOpts extends SubtitleSources {
  /** Just the staleness check — see `NotificationCoordinator.currentSolo`. */
  coordinator: { currentSolo(paneId: string): Alert | undefined };
  sink: NotifySink;
  /** Just the corner of `Copilot` this needs — see {@link TranscriptReader} for why it's narrowed. */
  copilot: { enabled: boolean; ask(buildPrompt: (outPath: string) => string): Promise<unknown | null> };
  /** Patches the bell's history entry to match the live push — optional so a caller with no log (or
   *  a test) simply doesn't get it. Without this the subtitle would only ever be visible in the
   *  fleeting OS notification, never in the history you'd check after missing it. */
  notifyLog?: { enrich(paneId: string, status: "blocked" | "done", subtitle: string): void };
}

/**
 * Render one subtitle update, but only if the alert it's ABOUT is still the thing on screen —
 * unchanged status, still the sole outstanding one (not swallowed into a multi-agent digest). The
 * copilot's answer can arrive long after the pane moved on, which is exactly what this guards.
 */
function pushSubtitle(opts: EnrichOpts, alert: FiredAlert, subtitle: string): void {
  const current = opts.coordinator.currentSolo(alert.paneId);
  if (!current || current.status !== alert.status) {
    console.log(`[notify-subtitle] dropped a stale answer for ${alert.paneId}`);
    return;
  }
  console.log(`[notify-subtitle] ${alert.paneId}: "${subtitle}"`);
  // Written back onto the outstanding alert, not just rendered: the coordinator re-renders that
  // summary from `Alert.subtitle` on any later change, and must not fall back to the plainer one.
  current.subtitle = subtitle;
  // Same composer as the push this replaces (notify-content.ts) — the ONLY difference between the
  // two renders is the subtitle, so an upgrade can never also rewrite the title back to a different
  // sentence about the same alert.
  opts.sink.render({ ...notifyContent(current, subtitle), paneId: alert.paneId, renotify: false });
  opts.notifyLog?.enrich(alert.paneId, alert.status, subtitle);
}

/** The agent's own last line for this pane, by reported session id or — for a pane herdr gave none
 *  for, which is common — the transcript `resolvePath` finds on disk. Null when neither answers. */
async function readLastMessage(opts: SubtitleSources): Promise<string | null> {
  const { alert } = opts;
  if (!opts.transcripts) return null;
  const by = alert.agentSessionId
    ? { sessionId: alert.agentSessionId }
    : opts.resolvePath
      ? await opts.resolvePath({ paneId: alert.paneId, cwd: alert.cwd })
          .then((path) => (path ? { path } : null))
          .catch(() => null)
      : null;
  return by ? lastAssistantSnippet(opts.transcripts, by) : null;
}

/** The `done`-only diff stat, or null — for `blocked` there is nothing finished to account for. */
function readStat(opts: SubtitleSources): Promise<DiffStat | null> {
  const { alert } = opts;
  if (alert.status !== "done") return Promise.resolve(null);
  return opts.statFor({ cardId: alert.cardId, cwd: alert.cwd }).catch(() => null);
}

/**
 * Everything the FIRST push waits on waits under this. Sized against MEASURED cost, not a guess: a
 * `git --stat` on a real dirty checkout is ~12ms, and the worst transcript on this machine (34MB)
 * parses in ~220ms — so healthy work never comes near it, only hung work does, and even the ceiling
 * is 5% of the 30s debounce the alert already sat through.
 */
const FIRST_PUSH_DEADLINE_MS = 1_500;

/** Resolve to `null` rather than keep waiting past `ms`. The abandoned work still finishes on its
 *  own (git has its own kill timer); we simply stop letting the alert depend on it. */
function withDeadline<T>(work: Promise<T | null>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    void work.catch(() => null).then((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

/**
 * TIERS 2 AND 3 — the subtitle the first, buzzing push carries (§N10). The agent's own last line if
 * there is one, else the diff as one line for a `done`, else nothing at all (tier 4 — never the
 * subject again, §3.3). Feeds `NotificationCoordinator`'s `beforeFire` — whose other half is the card's
 * status, read at the same instant (index.ts, §4.2). It is awaited between the debounce expiring and
 * the alert rendering, which is why the deadline above is non-negotiable.
 */
export function firstSubtitle(
  opts: SubtitleSources,
  timeoutMs: number = FIRST_PUSH_DEADLINE_MS,
): Promise<string | null> {
  return withDeadline(freeSubtitle(opts), timeoutMs);
}

async function freeSubtitle(opts: SubtitleSources): Promise<string | null> {
  const lastMessage = await readLastMessage(opts);
  // TIER 2 outranks tier 3 — and when it wins, nothing else here wants the stat, so no subprocess.
  if (lastMessage) return rawFallbackSubtitle(lastMessage);
  const stat = await readStat(opts);
  return stat ? diffStatLine(stat) : null;
}

/**
 * TIER 1 — the copilot's rephrase, the one thing that earns a second, silent push (§N10). Reads the
 * same sources {@link firstSubtitle} did (the transcript store caches its parse, and `--stat` is a
 * subprocess we only spend once the copilot is on at all) and renders over whatever landed first.
 * Fire-and-forget by design — call from the coordinator's `onFire` hook without awaiting it there,
 * and never let a failure surface: every input is best-effort.
 */
export async function enrichNotification(opts: EnrichOpts): Promise<void> {
  if (!opts.copilot.enabled) return;
  const { alert } = opts;
  const card = alert.cardId ? opts.board.getCard(alert.cardId) : null;
  const lastMessage = await readLastMessage(opts);
  // The stat the copilot's way: the per-file listing, which is prompt material and only ever that —
  // a lock screen has no room for it, which is exactly why tier 3 renders the one-liner instead.
  const stat = await readStat(opts);
  const statSummary = stat ? formatDiffStat(stat) : null;
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
  pushSubtitle(opts, alert, subtitle);
}
