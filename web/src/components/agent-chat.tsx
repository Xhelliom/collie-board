import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/i18n";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useNavigate, useRevalidator } from "react-router";
import {
  ArrowUpToLine,
  BookOpenText,
  Columns3,
  EllipsisVertical,
  FileCode2,
  Images,
  LayoutGrid,
  PanelTop,
  Loader2,
  ScrollText,
  Maximize2,
  Pin,
  Search,
  TerminalSquare,
  XCircle,
} from "lucide-react";
import { useSpaceActions } from "@/hooks/use-spaces";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import { useStableTerminalDraft } from "@/hooks/use-terminal-draft";
import { usePendingConfirm } from "@/hooks/use-pending-confirm";
import { isConnecting } from "@/lib/connection";
import { closePane, fetchHistory, sendKeys } from "@/lib/api";
import { BlockedScreenBanner } from "@/components/blocked-screen-banner";
import { submitFreeText, type FreeTextModel } from "@/lib/free-text-action";
import { boardErrorMessage, cardPath, handoffCard } from "@/lib/board";
import { collectImages, openLightbox } from "@/lib/lightbox";
import { setStatus } from "@/lib/status";
import { ChatMessageList, type ChatMessageListHandle } from "@/components/ui/chat/chat-message-list";
import { BottomSheet } from "@/components/ui/sheet";
import { MigrateHcButton } from "@/components/migrate-hc-button";
import { AppHeader } from "@/components/app-header";
import { NotificationBell } from "@/components/notification-bell";
import { AnsiOutput } from "@/components/ansi-output";
import { parseAnsi } from "@/lib/ansi";
import { splitLines } from "@/lib/blocks";
import { adapterFor } from "@/lib/harness";
import { ActionRow, DestructiveActionRow } from "@/components/action-sheet-rows";
import { FindBar } from "@/components/find-bar";
import { ABOVE_TAB_BAR } from "@/components/app-nav";
import { Composer, type ComposerHandle } from "@/components/composer";
import { AgentViewIdentity, ContextMeter } from "@/components/agent-view-header";
import { SubagentsLine } from "@/components/subagents-line";
import { WorkMark } from "@/components/work-mark";
import { PinButton, useAgentPin } from "@/components/pin-button";
import { ThreadSidebar } from "@/components/agent-sidebar";
import { PaneListColumn } from "@/components/pane-list-column";
import { AgentIcon } from "@/components/agent-icon";
import { TabStrip } from "@/components/tab-strip";
import { ReadOnlyBanner } from "@/components/read-only-banner";
import { ResumeOffer } from "@/components/auto-handoff";
import { HeldControl } from "@/components/held";
import { ReadingView } from "@/components/reading-view";
import { LastTurnButtons } from "@/components/last-turn-buttons";
import { HC_SPACE, isHcAgent, isOrchestrator, placeOf } from "@/lib/agent-groups";
import { nameOf } from "@/lib/agent-identity";
import { submitPromptOption } from "@/lib/prompt-action";
import { submitWizardKeys } from "@/lib/wizard-action";
import { submitPreviewKeys, submitPreviewNote, submitPreviewOption } from "@/lib/preview-action";
import { submitMultiSelectIntent, type MultiSelectIntent } from "@/lib/multi-select-action";
import type { PreviewBlockAction } from "@/components/preview-select-block";
import { canGrowRequestedLines, growRequestedLines, HISTORY_PAGE_SIZE } from "@/lib/loaders";
import { historyPath, homePath, paneArtifactsPath, panePath, spacePath, zoomPath } from "@/lib/nav";
import { isReadOnly } from "@/lib/types";
import type { AgentView, BridgeStatus, DeviceAuth, TabView } from "@/lib/types";
import type {
  MultiSelectModel,
  PreviewSelectModel,
  PromptModel,
  PromptOption,
  WizardModel,
} from "@/lib/blocks";

interface AgentChatProps {
  paneId: string;
  /** The session this pane lives in (undefined = primary) — scopes every read/write + the safety chip. */
  session?: string;
  agent: AgentView | undefined;
  agents: AgentView[];
  shellPanes: AgentView[];
  /** The pane list's herd (this machine's panes and the peers'); defaults to `agents` + `shellPanes`. */
  herd?: AgentView[];
  /** The board's own panes (lead, copilot): left out of the pane list. */
  internal?: ReadonlySet<string>;
  tabs: TabView[];
  /** Label of the pane's tab, shown in the header as "space › tab". */
  tabLabel?: string;
  /** Pane output from the route loader (refreshed by polling/revalidation). */
  text: string;
  /** The scrollback window `text` was fetched with — tells a grown fetch from a stale in-flight poll. */
  requestedLines?: number;
  /** The pane's `revision` for `text` — the race guard checks a tapped menu against this. */
  revision?: number;
  /** Per-device auth from the snapshot; an unauthorised device drops the composer to read-only. */
  device?: DeviceAuth;
  // Global connection state — fed straight to the shared AppHeader, which drives the header Collie
  // mark (gallop/rest, identically to the dashboard), and lets us dim the stale StatusBadge while not
  // live. Defaults describe a healthy link so tests that don't care render "live".
  bridge?: BridgeStatus | undefined;
  error?: boolean;
  stalled?: boolean;
  onBack: () => void;
  onSelect: (paneId: string) => void;
}

// At most one drawer/sheet is open at a time; null = none. (The composer's own Keys/Quick/Agent
// sheets are separate and live inside <Composer>.)
type Drawer = "switcher" | "tabs" | "more" | null;
const NO_PANES: ReadonlySet<string> = new Set();

// The detail view mirrors a terminal pane, NOT a chat thread. The pane's output comes from the
// route loader (`text`); polling revalidates it. Replies/keys are confirmed via the header status
// line (`setStatus`), then a revalidation pulls the fresh output.
//
// This shell owns the pane frame: the header (the find bar takes it over while find is open), the
// terminal mirror (freeze, find highlighting, load-older scrollback), and navigation (the nav hub +
// pane switcher). The composer cluster — draft, send, keys, quick actions, slash-commands, image
// upload, display prefs, and the find-in-output trigger — lives in <Composer>; it reaches back here
// only to re-follow the tail after a send, focus on a mirror tap, and open find (which freezes the tail).
export function AgentChat({
  paneId,
  session,
  agent,
  agents,
  shellPanes,
  herd = [...agents, ...shellPanes],
  internal = NO_PANES,
  tabs,
  tabLabel,
  text,
  requestedLines = 0,
  revision = 0,
  device,
  bridge = "connected",
  error = false,
  stalled = false,
  onBack,
  onSelect,
}: AgentChatProps) {
  const tr = useT();
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  // Poll-truth "is the data on screen not live". The header (AppHeader) reads the same inputs to drive
  // the Collie mark + pill; here we use it to dim the StatusBadge, so the badge stops presenting the
  // last snapshot's status as current while we're reconnecting/lost, and restores instantly on recovery.
  const connecting = isConnecting({ bridge, error, stalled });
  const { newTab } = useSpaceActions();
  // Single display-prefs instance: the View controls (in <Composer>) write it, the mirror reads it.
  const { prefs, setWrap, stepFontSize, setRawTerminal, setReading } = useDisplayPrefs();
  // Raw-terminal escape hatch: when on, every Claude grammar is bypassed and the plain mirror shows,
  // so a mis-detected/mis-rendered dialog can always be driven by hand with the keys pad.
  const grammarsOn = !prefs.rawTerminal;
  // The toggle also switches Herdr's read source (raw = un-wrapped scrollback, see paneLoader), so
  // refetch the moment it flips instead of leaving the old buffer up until the next poll. The effect
  // runs after commit, i.e. after the pref has been written to storage the loader reads.
  const lastRaw = useRef(prefs.rawTerminal);
  useEffect(() => {
    if (lastRaw.current === prefs.rawTerminal) return;
    lastRaw.current = prefs.rawTerminal;
    revalidator.revalidate();
  }, [prefs.rawTerminal, revalidator]);
  const isShell = agent?.kind === "shell";
  // This device isn't allowlisted to type into agents: the backend rejects every write, so the
  // composer drops to read-only (and shows a banner). The mirror still polls (reading is fine).
  const readOnly = isReadOnly(device);

  // Drawers/sheets are mutually exclusive — at most one open. A single value makes that invariant
  // unrepresentable to violate.
  const [drawer, setDrawer] = useState<Drawer>(null);
  const closeDrawer = () => setDrawer(null);
  const listRef = useRef<ChatMessageListHandle>(null);
  const composerRef = useRef<ComposerHandle>(null);

  // Close pane — reached from the "⋯" sheet now (redesign §5). Two-tap, same shape as
  // PaneActionsSheet's own close (that sheet is still reached via the pane pill's long-press
  // elsewhere; this is the SAME action from the header, duplicated rather than nested — a sheet
  // opening a sheet is a back-button trap on a phone).
  const { pending: closePending, confirm: confirmClose } = usePendingConfirm();
  const [closingPane, setClosingPane] = useState(false);
  async function requestClosePane() {
    if (!agent) return;
    if (!confirmClose(agent.paneId)) return;
    setClosingPane(true);
    try {
      const res = await closePane(agent.paneId, session);
      if (res.ok) {
        closeDrawer();
        onBack();
      } else {
        setStatus(res.error ?? tr("pane.closeFailed"), "error");
      }
    } catch (e) {
      setStatus(boardErrorMessage(e), "error");
    } finally {
      setClosingPane(false);
    }
  }

  const gone = !agent;

  // Mirror freeze: at the bottom we follow live output; the moment you scroll up to read backscroll
  // we hold the text steady (no reflow / no re-pin) until you jump back to latest — so a long
  // message stays put long enough to read instead of sliding out of the rolling window.
  //
  // The frozen snapshot is a {text, revision} PAIR captured at the same instant: the prompt-select
  // race guard must check a tap against the revision of what the user is LOOKING AT. The live
  // `revision` prop keeps advancing with background polls while the mirror is frozen — comparing
  // against it would blind the guard to drift that happened before the freeze (live-vs-live always
  // matches). While following, the frozen pair IS the live pair by definition.
  const [following, setFollowing] = useState(true);
  const [shown, setShown] = useState({ text, revision });
  useEffect(() => {
    if (!following) return;
    // Functional update that returns the previous object when nothing changed keeps React's
    // Object.is bailout — no re-render per poll while the pane is quiet.
    setShown((prev) =>
      prev.text === text && prev.revision === revision ? prev : { text, revision },
    );
  }, [text, revision, following]);
  const display = shown.text;
  const hasNew = !following && display !== text;

  // The agent's own statusline (model · ctx% · cwd · branch · tokens) is stripped off the mirror by
  // stripChrome so it doesn't duplicate the composer — but it carries real context (the branch, most
  // notably), so we re-surface it as app chrome just above the composer, where it sat in the TUI.
  // EVERY line under the box, not just the first: a `statusLine` hook paints its OWN line above
  // Claude's — a user running one saw `[PONYTAIL]` here and nothing else — and the line below carries
  // the permission / auto mode. Which of them matters isn't ours to guess (see extractStatusLines).
  // Routed through the SAME adapter (adapterFor) whose buildBlocks strips the chrome, so the two can't
  // drift; empty when there's no adapter for the agent, a menu is up, or no box at the tail, in which
  // case the strip is hidden. A second parse of `display`, but memoised on it, so it only recomputes
  // when the buffer content changes — off the render hot path.
  const statusLines = useMemo(
    () =>
      grammarsOn
        ? adapterFor(agent?.agent)?.extractStatusLines(splitLines(parseAnsi(display))) ?? []
        : [],
    [display, agent?.agent, grammarsOn],
  );

  // A user draft stranded on the input box's "❯" line — a message queued while the agent was busy
  // then recalled, which persists across turns. stripChrome peels the box off the mirror so it goes
  // invisible, and (worse) pane.send_text appends to it, corrupting the next send. We surface it to
  // the composer as a read-only preview the user can deliberately Take over — the input is otherwise
  // exclusively phone-owned. Same parse source + same adapter as the statusline, so the two can't
  // drift; null when raw-terminal is on, there's no adapter, no box is at the tail, or the line is empty.
  const rawTerminalDraft = useMemo(
    () =>
      grammarsOn
        ? adapterFor(agent?.agent)?.extractInputDraft(splitLines(parseAnsi(display))) ?? null
        : null,
    [display, agent?.agent, grammarsOn],
  );
  // Is a dialog (prompt/wizard/preview/multi-select) on screen right now? Any non-raw block means
  // the TUI's keyboard belongs to it, so the composer must refuse a free-text send: the text would
  // be swallowed and the submit key would answer the dialog (#34). Same parse source and adapter as
  // the two probes above, so the three can't drift. This is the zero-latency fail-fast; the
  // load-bearing protection is reply-action's verify-before-submit, which also covers a dialog that
  // appears after this render.
  //
  // Kept as the BLOCK itself, not just a boolean: ReadingView renders it as the same native card the
  // mirror does (its own dialog probe is downstream of this one), so both need the model, not just
  // its presence.
  const dialogBlock = useMemo(
    () =>
      grammarsOn
        ? (adapterFor(agent?.agent)?.buildBlocks(splitLines(parseAnsi(display))) ?? []).find(
            (b) => b.kind !== "raw",
          ) ?? null
        : null,
    [display, agent?.agent, grammarsOn],
  );
  const dialogPresent = dialogBlock !== null;
  // A screen the transcript can't show holds the agent: herdr says `blocked` (folder trust, one repo
  // MCP server), or it says `idle` while the input box is gone (the multi-server MCP checklist) —
  // HERDR_API.md § first-run screens. Reading mode shows it in a banner unless a grammar lifted it.
  const terminalScreenHolds = useMemo(() => {
    if (dialogBlock || !display) return false;
    if (agent?.status === "blocked") return true;
    const adapter = agent?.status === "idle" ? adapterFor(agent.agent) : undefined;
    return !!adapter && !adapter.hasInputBox(splitLines(parseAnsi(display)));
  }, [dialogBlock, display, agent?.status, agent?.agent]);

  // Both are threaded to the composer: the RAW value (live) plus a stabilised one. extractInputDraft
  // is stateless, so it can't distinguish a stranded draft from the ~350ms flash where our OWN
  // just-sent reply sits on the "❯" line waiting for the bridge's pending Enter. The stabilised value
  // (same text must persist ~1.5s) gates the preview's APPEARANCE so that flash never surfaces (the
  // composer adds a second guard: it suppresses a draft matching what it just sent); once shown, the
  // preview's text tracks the RAW line live, so host typing streams in without ever touching the input.
  const terminalDraft = useStableTerminalDraft(rawTerminalDraft);

  // Find-in-output: search the already-fetched buffer. The bar takes over the header while open;
  // AnsiOutput highlights matches and reports the count back here; prev/next scrolls the focused
  // match into view. Opening freezes the tail so matches don't shift under you as polls land.
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  useEffect(() => {
    setCurrentMatch(0); // a fresh query starts from the first match
  }, [findQuery]);
  const handleMatchCount = useCallback((n: number) => {
    setMatchCount(n);
    setCurrentMatch((c) => (n === 0 ? 0 : Math.min(c, n - 1)));
  }, []);
  function gotoMatch(delta: number) {
    if (matchCount === 0) return;
    setFollowing(false); // freeze the tail so scroll-into-view doesn't fight the live re-pin
    setCurrentMatch((c) => (c + delta + matchCount) % matchCount);
  }
  function openFind() {
    setFollowing(false); // freeze the buffer so the search target is stable while you type
    setFindOpen(true);
  }
  function closeFind() {
    setFindOpen(false);
    setFindQuery("");
  }

  // What the top of the buffer can offer — see the JSX for why these are mutually exclusive.
  // `historyAvailable`: the pane reported an agent session, so a transcript exists to open.
  // `moreScrollback`: Herdr says this pane can still yield lines beyond the window we've asked for,
  // AND we're under the cap Herdr's own read clamp imposes. `readableLines` is undefined on an older
  // bridge/Herdr; treat that as "no idea" and stay hidden rather than offer a tap that fetches nothing.
  // Any AGENT pane, not just one carrying `agentSessionId`. That field only exists once the optional
  // `herdr integration install <agent>` hook is planted, which most installs don't have — gating on it
  // hid History (and reading mode) from nearly everyone, while the bridge could resolve the transcript
  // from the pane's process all along (it already does, for the context gauge).
  //
  // ponytail: "is an agent pane" is a slightly loose gate — for a harness that keeps no readable
  // transcript the bridge answers `no-log` and the view says so, which costs one wasted tap. The
  // bridge is where the truth lives (it checks the agent's adapter before resolving by directory, so a
  // wrong conversation can never be served). Expose that capability on AgentView if a non-Claude agent
  // ever makes the empty tap annoying.
  const historyAvailable = Boolean(agent) && agent?.kind !== "shell";

  /**
   * Open the viewer over every image this session touched. The images are a fact of the TRANSCRIPT,
   * which this screen doesn't hold (the mirror is a terminal snapshot, and reading mode owns its own
   * copy), so the entry fetches one on demand — an explicit tap, never a poll. A session with no
   * pictures says so rather than opening an empty viewer.
   */
  const openSessionImages = useCallback(async () => {
    try {
      const res = await fetchHistory(paneId, { limit: HISTORY_PAGE_SIZE }, session);
      const images = res.available ? collectImages(res.entries) : [];
      if (images.length === 0) {
        setStatus(tr("pane.images.none"));
        return;
      }
      openLightbox(images);
    } catch {
      setStatus(tr("pane.images.failed"), "error");
    }
  }, [paneId, session, tr]);

  // READING MODE — the second mode of this screen (see components/reading-view.tsx). Gated on a
  // transcript existing at all, so the toggle never leads somewhere empty: a shell pane, or an agent
  // whose harness keeps no session log, simply has no reading mode to offer.
  // `noReading`: ReadingView said this pane has no transcript to read. The terminal shows meanwhile,
  // but the stored pref is left alone — it's the user's choice, and other panes may well have a log.
  // ponytail: cleared on pane/session change or an explicit tap on Reading; a log appearing later
  // on the same pane isn't picked up until then.
  const [noReading, setNoReading] = useState<string | null>(null);
  const readingKey = `${paneId}|${session ?? ""}`;
  const markNoReading = useCallback(() => setNoReading(readingKey), [readingKey]);
  const reading = prefs.reading && historyAvailable && noReading !== readingKey;
  // Its buttons are live on this screen only for the project's orchestrator (ADR 0044).
  const orchestrator = !!agent && isOrchestrator(agent);
  // Reading mode still depends on the mirror — the dialog probe, the statusline and the terminal-draft
  // preview are all derived from `display`, which stops tracking the live text while the mirror is
  // frozen. Nothing can un-freeze it once the mirror is unmounted (freezing is a scroll gesture), so a
  // stale freeze would silently blind the dialog banner. Re-follow on entry, and the three probes stay
  // live for as long as reading mode is up.
  useEffect(() => {
    if (reading) setFollowing(true);
  }, [reading]);

  const moreScrollback =
    agent?.readableLines !== undefined &&
    requestedLines < agent.readableLines &&
    canGrowRequestedLines(paneId, session);

  // Load older scrollback: raise the per-pane requested line count and refetch. The enlarged buffer
  // prepends older lines at the top, so we adopt it into the frozen display and re-anchor the scroll
  // position (measure height before, restore after) to keep the content you were reading in place.
  const [loadingOlder, setLoadingOlder] = useState(false);
  const olderAnchor = useRef<{ height: number; top: number } | null>(null);
  const adoptTarget = useRef<number | null>(null); // the requestedLines a pending grow is waiting on
  const pendingRestore = useRef(false); // re-anchor scroll after the enlarged display paints
  function loadOlder() {
    if (loadingOlder || !canGrowRequestedLines(paneId, session)) return;
    const el = listRef.current?.getScrollElement();
    olderAnchor.current = el ? { height: el.scrollHeight, top: el.scrollTop } : null;
    setLoadingOlder(true);
    setFollowing(false); // stay put in history rather than snapping to the tail
    adoptTarget.current = growRequestedLines(paneId, session);
    revalidator.revalidate();
  }
  // Adopt the enlarged buffer into the frozen display once the *grown* fetch lands — keyed on the
  // requested line count so a stale in-flight poll (still on the old window) can't adopt early.
  // Adopts the whole {text, revision} pair (props from the same loader result) so the frozen
  // snapshot stays coherent for the race guard.
  useEffect(() => {
    const target = adoptTarget.current;
    if (target === null || requestedLines < target) return;
    adoptTarget.current = null;
    setLoadingOlder(false);
    if (text === display) {
      olderAnchor.current = null; // nothing new arrived (buffer shorter than the window)
      return;
    }
    pendingRestore.current = true;
    setShown({ text, revision });
  }, [requestedLines, text, revision, display]);
  // After the enlarged display paints, keep the previously-visible content anchored (content grew at
  // the top, so push scrollTop down by the height delta).
  useLayoutEffect(() => {
    if (!pendingRestore.current) return;
    pendingRestore.current = false;
    const anchor = olderAnchor.current;
    const el = listRef.current?.getScrollElement();
    if (anchor && el) el.scrollTop = anchor.top + (el.scrollHeight - anchor.height);
    olderAnchor.current = null;
  }, [display]);

  // Opening / switching into this pane must land on the live tail. Stickiness usually handles it,
  // but the first flex layout + AnsiOutput paint can race; pin once after mount so a tab/pane open
  // never strands you at the oldest scrollback.
  useLayoutEffect(() => {
    listRef.current?.scrollToBottom();
  }, []);

  // After a successful send, snap the mirror back to the live tail so the reply's result is visible.
  const onSent = () => {
    setFollowing(true);
    revalidator.revalidate();
    listRef.current?.scrollToBottom();
  };

  // Tap a prompt-select option. This can type into a real terminal, so it runs the revision-based
  // race guard first (fresh fetch → revision + re-derived-menu equality); only a clean match sends
  // the option's keys. The guard checks against the FROZEN pair's revision — the menu the user
  // tapped was derived from `shown.text`, so `shown.revision` is the revision of what they saw
  // (the live `revision` prop may have advanced under a frozen mirror). A stale tap is discarded
  // with a "menu changed" notice and a revalidate; a clean send snaps back to the tail so the
  // result is visible. The free-text row has its own handler (handleFreeText).
  const handlePromptAction = useCallback(
    async (option: PromptOption, prompt: PromptModel) => {
      if (readOnly) {
        setStatus(tr("pane.readOnlyStatus"), "error");
        return;
      }
      const result = await submitPromptOption({
        paneId,
        session,
        requestedLines,
        detectedRevision: shown.revision,
        prompt,
        option,
      });
      if (result.status === "sent") {
        setFollowing(true);
        revalidator.revalidate();
        listRef.current?.scrollToBottom();
      } else if (result.status === "changed") {
        setStatus(tr("pane.changed.menu"), "warn");
        revalidator.revalidate();
      } else {
        setStatus(result.error || tr("pane.sendFailed"), "error");
      }
    },
    [readOnly, paneId, session, requestedLines, shown.revision, revalidator],
  );

  // Answer a dialog's "Type something." row: same guard, then digit → text → Enter.
  const handleFreeText = useCallback(
    async (text: string, model: FreeTextModel) => {
      if (readOnly) {
        setStatus(tr("pane.readOnlyStatus"), "error");
        return;
      }
      const result = await submitFreeText({ paneId, session, requestedLines, detectedRevision: shown.revision, model, text });
      if (result.status === "sent") {
        setFollowing(true);
        revalidator.revalidate();
        listRef.current?.scrollToBottom();
      } else if (result.status === "changed") {
        setStatus(tr("pane.changed.menu"), "warn");
        revalidator.revalidate();
      } else {
        setStatus(result.error || tr("pane.sendFailed"), "error");
      }
    },
    [readOnly, paneId, session, requestedLines, shown.revision, revalidator],
  );

  // Tap a wizard control (an option digit, step navigation, or the review step's submit/cancel).
  // Same shape as handlePromptAction — the guard re-derives the wizard from a FRESH read and only
  // a clean match sends the single keystroke (incremental round-trip; grammar/WIZARD_NOTES.md).
  // gate: claude-only (see hasBlockGrammar) — wizard blocks only ever exist for a Claude pane
  // (buildBlocks gates on ctx.agent), so this handler can't fire for other agents.
  const handleWizardAction = useCallback(
    async (keys: string[], wizard: WizardModel) => {
      if (readOnly) {
        setStatus(tr("pane.readOnlyStatus"), "error");
        return;
      }
      const result = await submitWizardKeys({
        paneId,
        session,
        requestedLines,
        detectedRevision: shown.revision,
        wizard,
        keys,
      });
      if (result.status === "sent") {
        setFollowing(true);
        revalidator.revalidate();
        listRef.current?.scrollToBottom();
      } else if (result.status === "changed") {
        setStatus(tr("pane.changed.wizard"), "warn");
        revalidator.revalidate();
      } else {
        setStatus(result.error || tr("pane.sendFailed"), "error");
      }
    },
    [readOnly, paneId, session, requestedLines, shown.revision, revalidator],
  );

  // Tap a preview-dialog control (an option, the note add/edit/remove, or the wizard step nav).
  // Same guard-first shape as the two handlers above, but the choreography behind an intent is
  // MULTI-step (digit→verify→Enter; n→verify→type→Escape — see lib/preview-action.ts and
  // grammar/NOTES_NOTES.md), so the handler dispatches on the intent kind.
  // gate: claude-only (see hasBlockGrammar) — preview blocks only ever exist for a Claude pane.
  const handlePreviewAction = useCallback(
    async (action: PreviewBlockAction, preview: PreviewSelectModel) => {
      if (readOnly) {
        setStatus(tr("pane.readOnlyStatus"), "error");
        return;
      }
      const base = {
        paneId,
        session,
        requestedLines,
        detectedRevision: shown.revision,
        preview,
      };
      const result =
        action.kind === "option"
          ? await submitPreviewOption({ ...base, option: action.option })
          : action.kind === "note"
            ? await submitPreviewNote({ ...base, text: action.text })
            : await submitPreviewKeys({ ...base, keys: action.keys });
      if (result.status === "sent") {
        if (action.kind === "note") setStatus(action.text ? tr("pane.note.saved") : tr("pane.note.removed"), "success");
        setFollowing(true);
        revalidator.revalidate();
        listRef.current?.scrollToBottom();
      } else if (result.status === "changed") {
        setStatus(tr("pane.changed.dialog"), "warn");
        revalidator.revalidate();
      } else {
        setStatus(result.error || tr("pane.sendFailed"), "error");
        revalidator.revalidate();
      }
    },
    [readOnly, paneId, session, requestedLines, shown.revision, revalidator],
  );

  // Tap a multi-select control (toggle a checkbox, Submit, the "Chat about this" escape, or the
  // review screen's confirm/cancel). Same guard-first shape as the wizard handler — the guard
  // re-derives the dialog from a FRESH read; toggle sends one digit, Submit drives the closed-loop
  // Down→Up→verify→Enter macro (see lib/multi-select-action.ts). gate: claude-only (multi-select
  // blocks only ever exist for a Claude pane, buildBlocks gates on ctx.agent).
  const handleMultiSelectAction = useCallback(
    async (action: MultiSelectIntent, multi: MultiSelectModel) => {
      if (readOnly) {
        setStatus(tr("pane.readOnlyStatus"), "error");
        return;
      }
      const result = await submitMultiSelectIntent({
        paneId,
        session,
        requestedLines,
        detectedRevision: shown.revision,
        multi,
        intent: action,
      });
      if (result.status === "sent") {
        setFollowing(true);
        revalidator.revalidate();
        listRef.current?.scrollToBottom();
      } else if (result.status === "changed") {
        setStatus(tr("pane.changed.selection"), "warn");
        revalidator.revalidate();
      } else {
        setStatus(result.error || tr("pane.sendFailed"), "error");
      }
    },
    [readOnly, paneId, session, requestedLines, shown.revision, revalidator],
  );

  // NOTE: the composer is deliberately NOT auto-focused on open/switch — that would pop the Android
  // keyboard and cover the output. You read the pane first, then tap the input to type. (Explicit
  // actions inside the composer still focus it; the mirror tap focuses it via composerRef.)

  // Switch to another thread from the sidebar or the pane switcher (DetailRoute keys AgentChat
  // by pane, so this remounts fresh — composer resets — same as opening from home).
  function switchTo(id: string) {
    closeDrawer();
    if (id !== paneId) onSelect(id);
  }

  // hc has no space nor tab (ADR 0052 phase 4): no tabs row in « ⋯ ».
  const hc = !!agent && isHcAgent(agent);

  // Jump to another tab in this space by opening one of its panes (the in-pane tab bar).
  function goToTab(tabId: string) {
    if (!agent || tabId === agent.tabId) return;
    const target = [...agents, ...shellPanes].find((p) => p.tabId === tabId);
    if (target) switchTo(target.paneId);
  }

  // Open a space from the nav hub — go to its detail route (its tabs + panes, incl. shells). A step
  // back up out of the pane, so it slides backward.
  function openSpace(workspaceId: string) {
    closeDrawer();
    // hc has no spaces: its overview is the herd, grouped by project.
    navigate(isHcAgent({ workspaceId }) ? homePath(session) : spacePath(workspaceId, session));
  }

  // Tapping the terminal mirror focuses the composer so you can start typing right away. Two bails:
  //  - the tap landed on an interactive control INSIDE the mirror — a native prompt/wizard/preview
  //    button, the Load-older button, or the note editor's own textarea. Their click bubbles up to
  //    this handler, and focusing the composer here would pop the soft keyboard on every option tap
  //    (and steal focus from the note editor). Only a tap on the raw terminal text should focus.
  //  - the user is selecting text (a long-press selection), so copy works instead of the tap
  //    collapsing the selection and popping the keyboard.
  function focusFromMirror(e: ReactMouseEvent<HTMLDivElement>) {
    const target = e.target as Element | null;
    if (target?.closest?.("button, a, input, textarea, select, [role='textbox']")) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    composerRef.current?.focusInput();
  }

  // The agent's name as the Agents page writes it (its card, « Orchestrateur », its own name): the
  // screen's h1 and the « ⋯ » sheet's title, so the two can't drift from the header.
  const paneTitle = agent ? nameOf(agent, tr("agents.orchestrator")) : tr("pane.agentGone");

  // The card this pane backs — undefined for a hand-launched pane (`withCardFields` resolves none).
  // A `const`, so the narrowing survives into the row's onClick below.
  const cardId = agent?.cardId;
  const cardLabel = agent?.cardTitle ?? tr("pane.cardCarried");
  const pin = useAgentPin(agent);

  function toggleReading() {
    if (!reading) setNoReading(null);
    setReading(!reading);
  }

  // Find takes the header over while open, at both widths.
  const findBar = (
    <FindBar
      query={findQuery}
      onQueryChange={setFindQuery}
      count={matchCount}
      current={currentMatch}
      onPrev={() => gotoMatch(-1)}
      onNext={() => gotoMatch(1)}
      onClose={closeFind}
    />
  );
  const moreButton = (
    <button
      type="button"
      onClick={() => setDrawer("more")}
      aria-label={tr("pane.more")}
      title={tr("pane.more")}
      className="flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 active:bg-muted/60"
    >
      <EllipsisVertical className="size-4" />
    </button>
  );
  // A row of the « ⋯ » sheet that closes it first.
  const row = (icon: ReactNode, label: string, run: () => void) => (
    <ActionRow
      icon={icon}
      label={label}
      onClick={() => {
        closeDrawer();
        run();
      }}
    />
  );
  const rowIcon = "size-4 shrink-0 text-muted-foreground";

  // The ONE handoff call this screen makes — the desktop rail's button and the composer's Quick dock
  // both fire it, so "hand off from the session" can't drift into two behaviours. Same request the
  // card page's own HandoffButton sends (lib/board.ts handoffCard).
  const runHandoff = async (id: string) => {
    try {
      await handoffCard(id);
      setStatus(tr("pane.handoffAsked"), "info");
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    }
    revalidator.revalidate();
  };

  return (
    // ABOVE_TAB_BAR: the mobile tab bar shows on this screen too — the composer, the column's in-flow
    // bottom edge, sits on top of it instead of under it.
    <div className={`flex min-h-0 w-full min-w-0 max-w-[100dvw] flex-1 flex-col overflow-x-hidden lg:max-w-none lg:flex-row ${ABOVE_TAB_BAR}`}>
      {/* 2xl-only, 296px: the Agents page's list, compact — the same one the pane switcher shows
          (redesign §5 "three panes"). The full nav sidebar (248px) stays on this screen, so below
          `2xl` this column would starve the mirror — there the toolbar's pane menu and the composer's
          pane switcher do the job. */}
      <PaneListColumn
        herd={herd}
        internal={internal}
        currentPaneId={paneId}
        onSelect={switchTo}
      />

      {/* The middle column: identity chrome (mobile header OR desktop toolbar — never both), the
          screen's h1, then the content region (statusline/mirror/composer) — unchanged below this
          point regardless of breakpoint. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Phone: back to the agents list, then who this is on three short lines (name + state;
            project, machine, model; the gauge). Everything else this view can do is behind « ⋯ ».
            Sticky HERE, not only on the header inside: the row's overflow-x-hidden makes it a vertical
            scroller, and when the column overflows (keyboard open) it scrolled the header's first line
            under the status bar — a sticky header in a wrapper its own height never sticks. */}
        <div className="sticky top-0 z-20 shrink-0 lg:hidden">
          <AppHeader
            onBack={onBack}
            backLabel={tr("pane.backToAgents")}
            override={findOpen ? findBar : undefined}
            rightLead={moreButton}
          >
            {agent ? (
              <AgentViewIdentity agent={agent} stale={connecting} phone />
            ) : (
              <span className="min-w-0 flex-1 truncate font-semibold">{tr("pane.agentGone")}</span>
            )}
          </AppHeader>
        </div>

        {/* Desktop: the same identity on two lines with the gauge beside it, then three actions —
            terminal ⇄ reading, the pin, « ⋯ » — and the bell every screen ends on. No back chevron:
            the nav sidebar is the way back on desktop. */}
        <div className="hidden min-h-14 flex-none items-center gap-3 border-b border-border px-5 py-2 lg:flex">
          {findOpen ? (
            findBar
          ) : agent ? (
            <>
              {isShell ? (
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-muted">
                  <TerminalSquare className="size-3.5 text-muted-foreground" />
                </div>
              ) : (
                <AgentIcon agent={agent.agent} className="size-7 shrink-0" />
              )}
              <AgentViewIdentity agent={agent} stale={connecting} />
              <ContextMeter agent={agent} />
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate font-semibold">{tr("pane.agentGone")}</span>
          )}
          <div className="flex shrink-0 items-center gap-1">
            {historyAvailable && (
              <button
                type="button"
                onClick={toggleReading}
                aria-label={reading ? tr("pane.toTerminal") : tr("pane.toReading")}
                title={reading ? tr("pane.toTerminal") : tr("pane.toReading")}
                className="flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60"
              >
                {reading ? <TerminalSquare className="size-4" /> : <BookOpenText className="size-4" />}
              </button>
            )}
            {agent && <PinButton agent={agent} />}
            {moreButton}
            {/* The bell, last — same anchored slot it holds in AppHeader, which this toolbar replaces. */}
            <NotificationBell />
          </div>
        </div>

      {/* The screen's one h1, for the sheets' headings to hang off. */}
      <h1 className="sr-only">{paneTitle}</h1>

      {/* Content region below the header — the mirror inside is the scroller. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Read-only notice when this device isn't allowlisted (the composer below is disabled too). */}
        <ReadOnlyBanner device={device} />

        {/* Phone: the sub-agents the desktop header names on its second line. */}
        <SubagentsLine subagents={agent?.subagents} className="shrink-0 border-b border-border/60 px-3 py-1 lg:hidden" />
        <WorkMark agent={agent} className="shrink-0 border-b border-border/60 px-3 py-1" />

        {/* The screen's body: the terminal mirror, or the reading view over the same conversation.
            Everything below (statusline, gauge, composer) belongs to both and doesn't move. */}
        {/* A screen the transcript can't show (folder trust, repo MCP…) and no grammar lifted into
            buttons: its tail + raw keys, so reading mode isn't blind to a stuck agent. */}
        {reading && terminalScreenHolds && (
          <BlockedScreenBanner
            display={display}
            disabled={readOnly || gone}
            onShowTerminal={() => setReading(false)}
            onKeys={(keys) =>
              void sendKeys(paneId, keys, session)
                .then((res) => (res.ok ? revalidator.revalidate() : setStatus(res.error ?? tr("pane.keys.failed"), "error")))
                .catch(() => setStatus(tr("pane.keys.failed"), "error"))
            }
          />
        )}
        {reading ? (
          <ReadingView
            paneId={paneId}
            session={session}
            agent={agent?.agent}
            // The poll's own heartbeat, NOT the pane's `revision` — herdr 0.7.x returns 0 for every
            // pane, always (HERDR_API.md), so a revision tick fires once at mount and never again.
            poll={revalidator.state}
            onUnavailable={markNoReading}
            orchestrator={orchestrator}
            working={agent?.status === "working"}
            dialogBlock={dialogBlock}
            dialogDisabled={readOnly || gone}
            onPromptAction={handlePromptAction}
            onWizardAction={handleWizardAction}
            onFreeText={handleFreeText}
            onPreviewAction={handlePreviewAction}
            onMultiSelectAction={handleMultiSelectAction}
          />
        ) : (
        <>
        {/* Terminal mirror — tapping it focuses the composer so you can start typing right away
            (unless you're selecting text to copy, which the tap must not collapse). */}
        {/* min-w-0 only — do NOT set overflow-x-hidden here: that forces overflow-y to `auto` (CSS
            quirk) and makes this wrapper a second vertical scroller competing with ChatMessageList. */}
        <div className="min-h-0 min-w-0 flex-1" onClick={focusFromMirror}>
          <ChatMessageList
            ref={listRef}
            dep={display}
            onAtBottomChange={setFollowing}
            hasNew={hasNew}
            // `bg-terminal-background` on the SCROLLPORT, not just the `<pre>` inside (which stays
            // `shrink-0` content-height on purpose — see ansi-output.tsx's preClass). On a short
            // transcript in a tall desktop pane the `<pre>`'s own dark box used to end well above the
            // composer, showing the plain page background in the gap — this keeps the terminal look
            // for the full scrollable height regardless of how much output there actually is.
            className="bg-terminal-background px-2 py-3"
          >
            {display ? (
              <>
                {/* Top-of-buffer affordance, reached by scrolling up. WHICH button appears is decided
                    by what the pane can actually offer, because the two are never both possible:

                      • an agent pane with a transcript → "Show entire history". Its terminal runs on
                        the alternate screen, which keeps no scrollback ring, so the mirror can never
                        show more than the viewport — the agent's own session log is the only history
                        that exists (see bridge/transcript.ts).
                      • a pane with real scrollback (a shell, on the primary screen) → "Load older",
                        which grows the requested window.
                      • neither → nothing.

                    This used to be gated on `truncated`, which Herdr never sets true — so the button
                    rendered on no pane at all. `readableLines` (scrollback depth + viewport) is the
                    signal that actually works. */}
                {historyAvailable ? (
                  <button
                    type="button"
                    onClick={() => navigate(historyPath(paneId, session))}
                    className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-xs font-medium text-muted-foreground transition-colors active:bg-muted/50"
                  >
                    <ScrollText className="size-3.5" />
                    {tr("pane.history.all")}
                  </button>
                ) : moreScrollback ? (
                  <button
                    type="button"
                    onClick={loadOlder}
                    disabled={loadingOlder}
                    className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-xs font-medium text-muted-foreground transition-colors active:bg-muted/50 disabled:opacity-60"
                  >
                    {loadingOlder ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ArrowUpToLine className="size-3.5" />
                    )}
                    {loadingOlder ? tr("common.loading") : tr("pane.loadOlder")}
                  </button>
                ) : null}
                <AnsiOutput
                  text={display}
                  wrap={prefs.wrap}
                  fontSize={prefs.fontSize}
                  query={findOpen ? findQuery : ""}
                  currentMatch={findOpen ? currentMatch : -1}
                  onMatchCount={findOpen ? handleMatchCount : undefined}
                  agent={grammarsOn ? agent?.agent : undefined}
                  onPromptAction={handlePromptAction}
                  onWizardAction={handleWizardAction}
                  onFreeText={handleFreeText}
                  onPreviewAction={handlePreviewAction}
                  onMultiSelectAction={handleMultiSelectAction}
                  promptDisabled={readOnly || gone}
                />
              </>
            ) : (
              <div className="py-16 text-center text-sm text-muted-foreground">{tr("pane.noRecentOutput")}</div>
            )}
          </ChatMessageList>
        </div>
        </>
        )}

        {/* Bottom region: the composer. The status line USED to float here as an overlay just above
            the composer, but it covered the terminal tail (the prompt/cursor and up-levelled prompt
            buttons) — the toasts now float under the header (ui/sonner.tsx). The pane switcher used to
            have a grab-handle band of its own here; it's a button in the composer's action row now
            (see composer.tsx), which costs the mirror nothing. */}
        <div className="relative">

          {/* Right above the reply box, at every breakpoint: the reply is what would reload the cache. */}
          {cardId && agent?.handoffReady && <ResumeOffer cardId={cardId} />}
          {/* « En main » (ADR 0058): writing here takes the card by itself; the button is for taking it before, and giving it back. */}
          {cardId && !orchestrator && <HeldControl cardId={cardId} held={!!agent?.held} className="justify-end border-t border-border/40 px-3 py-1.5" />}

          {orchestrator && !reading && <LastTurnButtons paneId={paneId} session={session} poll={revalidator.state} />}

          <Composer
            ref={composerRef}
            paneId={paneId}
            session={session}
            agent={agent?.agent}
            hc={hc}
            isShell={isShell}
            gone={gone}
            readOnly={readOnly}
            dialogPresent={dialogPresent}
            text={text}
            mirrorText={display}
            terminalDraft={terminalDraft}
            rawTerminalDraft={rawTerminalDraft}
            prefs={prefs}
            setWrap={setWrap}
            stepFontSize={stepFontSize}
            setRawTerminal={setRawTerminal}
            onSent={onSent}
            onSwitchPane={
              agents.length + shellPanes.length > 1 ? () => setDrawer("switcher") : undefined
            }
            onHandoff={cardId ? () => runHandoff(cardId) : undefined}
            working={agent?.status === "working"}
            agentName={agent ? paneTitle : undefined}
          />
        </div>
      </div>
      </div>

      {/* Swipe-up quick switcher — just the panes (agents + shells), reached by the thumb gesture.
          Switch-only: pane closing lives in the pane pill's long-press sheet, not here. */}
      <BottomSheet open={drawer === "switcher"} onClose={closeDrawer} title={tr("pane.switch")}>
        <ThreadSidebar herd={herd} internal={internal} currentPaneId={paneId} onSelect={switchTo} />
      </BottomSheet>

      {/* The context row's tab segment — the SAME TabStrip, just moved off an always-visible strip
          into a sheet (redesign §5). Its own create/rename/close logic is untouched. */}
      {agent && (
        <BottomSheet open={drawer === "tabs"} onClose={closeDrawer} title={tr("pane.tabs")}>
          <TabStrip
            workspaceId={agent.workspaceId}
            tabs={tabs}
            agents={agents}
            selected={agent.tabId}
            onSelect={(id) => {
              if (id) goToTab(id);
              closeDrawer();
            }}
            onNewTab={(workspaceId) => {
              newTab(workspaceId);
              closeDrawer();
            }}
            allowAll={false}
            session={session}
            readOnly={readOnly}
            onRenamed={() => revalidator.revalidate()}
            // Closing the tab this pane lives in kills the pane too — leave for Home the same way a
            // pane-close does (onBack); closing any other tab just revalidates so it drops out.
            onClosed={(tabId) => {
              closeDrawer();
              if (agent?.tabId === tabId) onBack();
              else revalidator.revalidate();
            }}
          />
        </BottomSheet>
      )}

      {/* « ⋯ »: everything this view does beyond reading and replying. The agent's status line (its
          mode, its shells) heads it — information, not an action. Desktop shows the view toggle and
          the pin in the toolbar too; the phone has only this. */}
      <BottomSheet open={drawer === "more"} onClose={closeDrawer} title={paneTitle}>
        <div className="flex flex-col gap-1">
          {statusLines.length > 0 && (
            <section aria-label={tr("pane.statusLine")} className="mb-2 flex flex-col gap-0.5 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              {statusLines.map((line, i) => (
                <div key={i} className="truncate">
                  {line}
                </div>
              ))}
            </section>
          )}
          {cardId && row(<Columns3 className={rowIcon} />, tr("pane.openCard", { title: cardLabel }), () => navigate(cardPath(cardId)))}
          {historyAvailable &&
            row(
              reading ? <TerminalSquare className={rowIcon} /> : <BookOpenText className={rowIcon} />,
              reading ? tr("pane.toTerminal") : tr("pane.toReading"),
              toggleReading,
            )}
          {pin && (
            <div className="lg:hidden">
              {row(<Pin className={rowIcon} />, tr(pin.on ? "pin.remove" : "pin.add"), pin.toggle)}
            </div>
          )}
          {display && !reading && row(<Search className={rowIcon} />, tr("find.label.output"), openFind)}
          {display && !reading && row(<Maximize2 className={rowIcon} />, tr("zoom.open"), () => navigate(zoomPath(paneId, session)))}
          {agent && historyAvailable && row(<ScrollText className={rowIcon} />, tr("pane.history"), () => navigate(historyPath(paneId, session)))}
          {agent && historyAvailable && row(<Images className={rowIcon} />, tr("pane.images"), () => void openSessionImages())}
          {/* The worktree files the session wrote — card-backed panes only (the reader is confined to the CARD's worktree). */}
          {cardId && row(<FileCode2 className={rowIcon} />, tr("pane.artifacts"), () => navigate(paneArtifactsPath(paneId, session)))}
          {agent && row(<LayoutGrid className={rowIcon} />, tr("pane.openOverview", { space: placeOf(agent) }), () => openSpace(agent.workspaceId))}
          {agent && tabLabel && !hc && row(<PanelTop className={rowIcon} />, tr("pane.tabs"), () => setDrawer("tabs"))}
          {/* Mounted with the sheet only: it asks the bridge. On success the agent lives in another pane — follow it. */}
          {agent && drawer === "more" && (
            <MigrateHcButton
              paneId={agent.paneId}
              watch={agent.status}
              onDone={(message, ok, to) => {
                closeDrawer();
                setStatus(message, ok ? "success" : "error");
                if (to) navigate(panePath(to, session), { replace: true, state: { freshPane: { ...agent, paneId: to, workspaceId: HC_SPACE, workspaceLabel: HC_SPACE, tabId: HC_SPACE } } });
                else void revalidator.revalidate();
              }}
            />
          )}
          {agent && (
            <DestructiveActionRow
              icon={<XCircle className="size-4 shrink-0" />}
              label={tr("pane.close")}
              confirmLabel={tr("pane.close.confirm")}
              closingLabel={tr("pane.close.closing")}
              armed={closePending === agent.paneId}
              closing={closingPane}
              onClick={() => void requestClosePane()}
            />
          )}
        </div>
      </BottomSheet>
    </div>
  );
}
