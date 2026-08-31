import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.ts";
import type { NotifiableStatus } from "./notifications.ts";
import type { AgentStatus } from "./types.ts";

// Which agent lifecycle events are worth a push. A companion to Snooze (the do-not-disturb deadline):
// where Snooze mutes everything for a while, this decides which *kinds* of alert ever fire. By default
// only "agent needs your input" (blocked) pushes; a "done" push is off — most people don't want a buzz
// for every completed task. Bridge-wide (not per-device), like Snooze, because a push fans out to
// every subscribed device. Persisted to the state dir so a preference survives the `systemctl restart`
// that backend changes require. Missing file / missing keys fall back to defaults.

/** Notification type preferences: which notifiable statuses actually push. */
export interface NotifyPrefs {
  /** Push when an agent becomes blocked (waiting on your input). Default on. */
  blocked: boolean;
  /** Push when an agent finishes its task. Default off. */
  done: boolean;
  /** Push when a newer Collie release is available. Default on — the off-switch for update alerts,
   *  which otherwise bypass snooze (an update isn't quiet-hours material). Not an agent status, so it
   *  never flows through {@link isNotifiable}; the update monitor reads it directly. */
  updates: boolean;
  /** Let the copilot REPHRASE the push subtitle into one clean sentence (from the agent's last
   *  message, and for `done` the diff), once it answers — see notify-subtitle.ts. Default off: it's
   *  an extra agent turn on the copilot's own quota, and a no-op unless the copilot itself is
   *  enabled. Off is not "plain body again" — the free tier under it (the agent's own last line,
   *  read straight from the transcript) lands either way. The repo name is never touched. */
  copilotSubtitle: boolean;
  /** Push when the BOARD reports a card whose work has stopped and which nothing will restart — its
   *  pane vanished, or its handoff never landed (bridge/board-notify.ts). Default on: nobody asked
   *  for either fact and no pane transition reports them, which is the same case `blocked` makes.
   *  ONE boolean for the whole family, not one per event — otherwise this screen becomes the
   *  recensement of NOTIFY_AUDIT.md §6.3. */
  board: boolean;
  /** Push when a finished predecessor leaves a card free to START (bridge/board-notify.ts).
   *  **Default off**, like `done` and for the same reason turned around: this is the one fact of
   *  the set that opens a possibility instead of reporting a problem, so nothing is late because
   *  the push never came. Its own switch and not `board`'s, because it is its own marker —
   *  `Ready`, never `Needs you` (NOTIFY_AUDIT.md §6.3, note de priorité sur B4). */
  ready: boolean;
}

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  blocked: true,
  done: false,
  updates: true,
  copilotSubtitle: false,
  board: true,
  ready: false,
};

/**
 * Coerce an untrusted parsed value into a {@link NotifyPrefs}, filling any missing or non-boolean key
 * from the defaults. Pure + exported so the file-shape handling is unit-testable.
 */
export function coerceNotifyPrefs(raw: unknown): NotifyPrefs {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    blocked: typeof o.blocked === "boolean" ? o.blocked : DEFAULT_NOTIFY_PREFS.blocked,
    done: typeof o.done === "boolean" ? o.done : DEFAULT_NOTIFY_PREFS.done,
    updates: typeof o.updates === "boolean" ? o.updates : DEFAULT_NOTIFY_PREFS.updates,
    copilotSubtitle:
      typeof o.copilotSubtitle === "boolean" ? o.copilotSubtitle : DEFAULT_NOTIFY_PREFS.copilotSubtitle,
    board: typeof o.board === "boolean" ? o.board : DEFAULT_NOTIFY_PREFS.board,
    ready: typeof o.ready === "boolean" ? o.ready : DEFAULT_NOTIFY_PREFS.ready,
  };
}

export class NotifyPrefsStore {
  private prefs: NotifyPrefs = { ...DEFAULT_NOTIFY_PREFS };
  private readonly file: string;

  constructor(private readonly cfg: Config) {
    this.file = join(cfg.stateDir, "notify-prefs.json");
  }

  async load(): Promise<void> {
    try {
      this.prefs = coerceNotifyPrefs(await Bun.file(this.file).json());
    } catch {
      /* none saved yet — keep defaults */
    }
  }

  /** A copy of the current prefs (never the internal object, so callers can't mutate our state). */
  current(): NotifyPrefs {
    return { ...this.prefs };
  }

  /**
   * Whether a transition into `status` should notify, per the current prefs. Any status that isn't a
   * notifiable kind (idle/working/unknown) is always false — mirrors the coordinator's old static set.
   */
  isNotifiable(status: AgentStatus | NotifiableStatus): boolean {
    if (status === "blocked") return this.prefs.blocked;
    if (status === "done") return this.prefs.done;
    if (status === "stalled") return this.prefs.board;
    if (status === "ready") return this.prefs.ready;
    return false;
  }

  /** Merge a partial patch (only booleans are applied), persist, and return the updated prefs. The
   *  keys are the DEFAULTS' keys, so adding a preference cannot leave this one behind. */
  async set(patch: Partial<NotifyPrefs>): Promise<NotifyPrefs> {
    for (const key of Object.keys(DEFAULT_NOTIFY_PREFS) as (keyof NotifyPrefs)[]) {
      if (typeof patch[key] === "boolean") this.prefs[key] = patch[key];
    }
    await this.save();
    return this.current();
  }

  /** Atomic, owner-only write: fresh temp file (mode 0600) then rename over the target. */
  private async save(): Promise<void> {
    await mkdir(this.cfg.stateDir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.prefs, null, 2), { mode: 0o600 });
    await rename(tmp, this.file);
  }
}
