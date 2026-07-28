import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { loadAdapters } from "./adapters.ts";
import { AuditLog, fileAuditAppender } from "./audit.ts";
import { reconcile } from "./cards.ts";
import { loadConfig } from "./config.ts";
import { ContextTracker } from "./context.ts";
import { Copilot, CopilotCoordinator } from "./copilot.ts";
import { BoardDb } from "./db.ts";
import { EventPoker } from "./event-poker.ts";
import { HandoffCoordinator } from "./handoff.ts";
import { DEFAULT_TIMEOUT_MS, HerdrClient } from "./herdr-client.ts";
import { NotificationCoordinator, makeNotifySink, type NotifyClock } from "./notifications.ts";
import { NotifyPrefsStore } from "./notify-prefs.ts";
import { Push } from "./push.ts";
import { startServer } from "./server.ts";
import {
  deriveConfigRoot,
  herdTagFor,
  SessionRegistry,
  type SessionFactory,
} from "./sessions.ts";
import { Snooze } from "./snooze.ts";
import { StateEngine, type EngineSnapshot } from "./state-engine.ts";
import {
  bridgeStampSync,
  githubTagsFetcher,
  UpdateMonitor,
  UpdateStateStore,
} from "./update.ts";
import { cardDiffSummary } from "./git.ts";
import { ClaudeTranscriptSource } from "./transcript.ts";
import { SWEEP_INTERVAL_MS, sweepUploads } from "./uploads.ts";

// How often the registry rescans the filesystem for sessions that appeared/disappeared after boot.
const SESSION_REFRESH_MS = 15_000;
// Upstream release check cadence. Releases are rare, so poll every few hours; the first check is
// delayed so we never probe the network mid-boot.
const UPDATE_FIRST_DELAY_MS = 90_000;
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Entry point: resolve config, wire the pieces, start polling and serving.
const cfg = loadConfig();

// Ensure the state dir exists with private (0700) perms before push/snooze/uploads write into it —
// it holds push subscription endpoints and uploaded images, so keep it owner-only.
await mkdir(cfg.stateDir, { recursive: true, mode: 0o700 });

// ── Process-global services, shared across every session ─────────────────────
const push = new Push(cfg);
await push.init();

const snooze = new Snooze(cfg);
await snooze.load();

const notifyPrefs = new NotifyPrefsStore(cfg);
await notifyPrefs.load();

// Append-only audit trail of write-level actions (see audit.ts). A write failure here is swallowed
// inside record() so it can never break the user action it's auditing.
const audit = new AuditLog(fileAuditAppender(join(cfg.stateDir, "audit.log")));

// The board's durable store. Lives in the state dir next to the audit log and the push
// subscriptions, so a single `rm -rf` of that directory resets the whole plugin's state.
const board = new BoardDb(join(cfg.stateDir, "board.db"));

// Per-agent divergence, resolved once at boot: shipped adapters/agents.toml, then the operator's.
const adapters = loadAdapters(cfg.adapterPaths);

// The copilot: one long-lived agent in its own workspace, driven exactly like a worker. Off unless
// COLLIE_BOARD_COPILOT is set — it draws on the same subscription the cards do.
// `snapshotRef` is filled in by the primary session factory below — the copilot needs the live herd
// to adopt an existing pane, and it is constructed before the engine exists.
let snapshotRef: () => EngineSnapshot = () => ({
  agents: [],
  shellPanes: [],
  workspaces: [],
  tabs: [],
  bridge: "disconnected",
});
const copilot = new Copilot(
  new HerdrClient(cfg.socketPath, DEFAULT_TIMEOUT_MS, cfg.dialMode),
  cfg,
  join(cfg.stateDir, "copilot"),
  () => snapshotRef(),
  adapters,
);
const copilotBoard = new CopilotCoordinator(board, copilot, cfg);
if (cfg.boardCopilot) console.log("[copilot] enabled");

// ── Update-availability monitor ───────────────────────────────────────────────
// The running plugin version, captured NOW at module load — never re-read from disk later, or a
// post-pull package.json would mask the very update we detect (same class of bug as the buildId gap).
// The bridge-source stamp is snapshotted here too, so a rebuilt-but-not-restarted process reads stale.
const bridgeDir = import.meta.dir;
const rootDir = join(bridgeDir, "..");
const currentVersion = (
  JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as { version: string }
).version;

const updateStore = new UpdateStateStore(cfg);
await updateStore.load();

// The repo the release check + release links point at. This fork has no published releases, and
// pointing it at upstream would nag about versions this code isn't — so the RELEASE half is opt-in:
// set COLLIE_BOARD_UPDATE_REPO to `owner/name` once the fork is published. `bridgeStale` (the
// rebuilt-but-not-restarted detector) is local and keeps working either way.
const updateRepo = process.env.COLLIE_BOARD_UPDATE_REPO?.trim() || "";
const updateMonitor = new UpdateMonitor({
  repo: updateRepo,
  current: currentVersion,
  startupStamp: bridgeStampSync(bridgeDir, rootDir),
  fetchTags: updateRepo ? githubTagsFetcher(updateRepo) : async () => [],
  bridgeStamp: () => bridgeStampSync(bridgeDir, rootDir),
  store: updateStore,
  now: Date.now,
  // The `updates` notify pref is the off-switch — update pushes bypass snooze, so this is their gate.
  updatesEnabled: () => notifyPrefs.current().updates,
  notify: (latest) =>
    void push.send({
      type: "update",
      tag: "collie:update",
      // No command in the body — the tap opens Settings (target below), and the update banner / linked
      // release page carry the location-independent Herdr actions. Keeps this off the cwd-dependent path.
      title: "Collie update available",
      body: `Version ${latest} is available`,
      target: "settings",
    }),
});

// First check delayed (don't probe mid-boot); then every few hours. unref() so neither timer holds
// the process open; both cleared on shutdown. Not scheduled at all without an update repo — there'd
// be nothing to fetch.
const updateFirstCheck = setTimeout(() => void updateMonitor.checkRelease(), UPDATE_FIRST_DELAY_MS);
updateFirstCheck.unref();
const updateTimer = setInterval(() => void updateMonitor.checkRelease(), UPDATE_INTERVAL_MS);
updateTimer.unref();
if (!updateRepo) {
  clearTimeout(updateFirstCheck);
  clearInterval(updateTimer);
}

// ── Per-session runtime factory ──────────────────────────────────────────────
// One HerdrClient + StateEngine + EventPoker + NotificationCoordinator per herdr session. The
// registry calls this for the primary at construction and for each session discovered later. Push,
// snooze, notify-prefs, the audit log and the uploads dir stay process-global (shared here).
const makeSession: SessionFactory = (name, socketPath, isPrimary) => {
  const herdr = new HerdrClient(socketPath, DEFAULT_TIMEOUT_MS, cfg.dialMode);
  const engine = new StateEngine(herdr, cfg.pollMs);

  // Event-poked polling: a long-lived events.subscribe stream pokes an immediate re-poll on any herd
  // change, and while it's healthy the interval relaxes to the safety-net cadence. Events are ONLY a
  // poke — the snapshot poll stays the source of truth — so a missed event costs one interval, not
  // correctness. The fresh snapshot after any pane lifecycle change re-scopes the subscriptions.
  const poker = new EventPoker(herdr);
  poker.onPoke(() => engine.pokeNow());
  poker.onHealth((h) => engine.setCadence(h ? cfg.pollIdleMs : cfg.pollMs));
  engine.onUpdate((s) => poker.setAgentPanes(s.agents.map((a) => a.paneId)));

  // Background notifications on lifecycle transitions (foreground toasts are computed client-side by
  // diffing snapshots). Each session gets its own coordinator + notification slot: the primary keeps
  // the bare `collie:herd` tag (so pre-feature notifications don't orphan) and omits the session name
  // from the payload; every other session tags `collie:herd:<name>` and carries the name for deep-links.
  const clock: NotifyClock<ReturnType<typeof setTimeout>> = {
    schedule: (fn, ms) => setTimeout(fn, ms),
    cancel: (h) => clearTimeout(h),
  };
  const sink = makeNotifySink(push, snooze, herdTagFor(isPrimary, name), isPrimary ? undefined : name);
  const notifications = new NotificationCoordinator(clock, sink, cfg.notifyDelayMs, (status) =>
    notifyPrefs.isNotifiable(status),
  );
  engine.onTransition((agent, from, to) => notifications.onTransition(agent, from, to));
  engine.onRemove((paneId) => notifications.onRemove(paneId));

  // Board reconciliation rides the SAME snapshot poll — no second loop, no second source of truth.
  // Primary session only: a card's pane id is meaningless in another herdr server (see server.ts).
  if (isPrimary) {
    snapshotRef = () => engine.current();
    engine.onUpdate((snap) => reconcile(board, snap));
    // Context telemetry rides it too, throttled per pane inside the tracker (a transcript read is
    // far too expensive for a 1.5s tick). Fire-and-forget: the gauge must never delay a poll.
    const context = new ContextTracker(
      board,
      herdr,
      new ClaudeTranscriptSource(cfg.transcriptRoot),
      cfg.boardCtxWindow,
      adapters,
    );
    engine.onUpdate((snap) => void context.update(snap));
    // Handoffs finish here too: the request only prompts the agent, and this notices when it has
    // gone quiet and swaps the pane. Guarded against re-entry inside the coordinator.
    const handoffs = new HandoffCoordinator(board, herdr, cfg);
    engine.onUpdate((snap) => handoffs.update(snap));
    // Post-`done` review, and the todos it produces become the next cards. The stat is fetched
    // lazily so a disabled copilot costs no git subprocesses at all.
    engine.onUpdate((snap) => copilotBoard.update(snap, (cardId) => cardDiffSummary(board, cardId)));
  }

  engine.start();
  poker.start();
  return { herdr, engine, poker, notifications };
};

// List the session directory names under `<configRoot>/sessions` (empty if the dir doesn't exist).
const listSessionDirs = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
};

const registry = new SessionRegistry({
  configRoot: deriveConfigRoot(cfg.socketPath),
  primarySocketPath: cfg.socketPath,
  factory: makeSession,
  multiSession: cfg.multiSession,
  listSessionDirs,
  exists: (p) => existsSync(p),
});

// Fail soft with a clear message if the PRIMARY Herdr isn't reachable at startup. Other sessions come
// up lazily via refresh(); an unreachable one just reads `reachable:false` in the sessions list.
const primary = registry.get();
if (primary && !(await primary.herdr.ping())) {
  console.warn(
    `[bridge] cannot reach Herdr socket at ${cfg.socketPath} yet — ` +
      `will keep retrying on the poll loop. Is the Herdr server running?`,
  );
}

// Discover any already-running named sessions now, then rescan on an interval so a session
// started/stopped after boot is picked up (or disposed) within SESSION_REFRESH_MS. A no-op when
// multi-session is off. unref() so the timer never keeps the process alive; cleared on shutdown.
await registry.refresh();
const refreshTimer = setInterval(() => void registry.refresh(), SESSION_REFRESH_MS);
refreshTimer.unref();

// Prune uploaded images past their TTL: once at startup, then on an interval. Uploads are single-use
// (Herdr reads them by path when the message is sent), so nothing else reclaims them. unref() so the
// timer never keeps the process alive; it's also cleared on shutdown.
const uploadsDir = join(cfg.stateDir, "uploads");
void sweepUploads(uploadsDir).then((removed) => {
  if (removed.length) console.log(`[uploads] swept ${removed.length} expired image(s) at startup`);
});
const sweepTimer = setInterval(() => {
  void sweepUploads(uploadsDir).then((removed) => {
    if (removed.length) console.log(`[uploads] swept ${removed.length} expired image(s)`);
  });
}, SWEEP_INTERVAL_MS);
sweepTimer.unref();

const server = startServer({
  cfg,
  registry,
  push,
  snooze,
  notifyPrefs,
  updateMonitor,
  audit,
  board,
  copilot: copilotBoard,
});

const shutdown = async () => {
  console.log("\n[bridge] shutting down");
  // Stop accepting new connections and let in-flight requests drain briefly (non-forced stop)
  // before we tear down the poll loops and exit.
  await server.stop();
  clearInterval(refreshTimer);
  registry.disposeAll();
  clearInterval(sweepTimer);
  clearTimeout(updateFirstCheck);
  clearInterval(updateTimer);
  board.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
