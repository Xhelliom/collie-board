import { homedir } from "node:os";
import { join } from "node:path";

import type { DialMode } from "./dial.ts";

// All bridge configuration, resolved once at startup. Env-driven so the systemd unit and the
// plugin launcher can configure it without code changes. Defaults are safe for a single-user,
// tailnet-only deployment.

/**
 * Read an integer env var, falling back to `fallback` (with one warning line) on anything invalid:
 * an empty/unset value, non-integer garbage (`parseInt("123abc")` used to sneak `123` through — a
 * strict regex rejects it), or a value outside the optional `[min, max]` bounds. Keeping bad config
 * from silently becoming a nonsense number (a negative poll interval, port 0) is the whole point.
 */
function envInt(
  name: string,
  fallback: number,
  opts: { min?: number; max?: number } = {},
): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const trimmed = raw.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) {
    console.warn(`[config] ${name}="${raw}" is not an integer — using default ${fallback}`);
    return fallback;
  }
  const n = Number(trimmed);
  const { min, max } = opts;
  if ((min !== undefined && n < min) || (max !== undefined && n > max)) {
    console.warn(`[config] ${name}=${n} is out of the allowed range — using default ${fallback}`);
    return fallback;
  }
  return n;
}

function envList(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Read a boolean env var. Empty/unset → `fallback`. `off`/`0`/`false`/`no` → false; `on`/`1`/`true`/
 * `yes` → true (case-insensitive); anything else falls back with a warning. Used for feature toggles
 * that default on, where a typo silently flipping the feature would be surprising.
 */
/**
 * Read an env var constrained to a fixed set of string values, falling back (with a warning) on
 * anything not in `allowed`. Empty/unset → `fallback`. Case-insensitive.
 */
function envEnum<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  const match = allowed.find((a) => a.toLowerCase() === v);
  if (match !== undefined) return match;
  console.warn(`[config] ${name}="${raw}" is not one of ${allowed.join("|")} — using default ${fallback}`);
  return fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["off", "0", "false", "no"].includes(v)) return false;
  if (["on", "1", "true", "yes"].includes(v)) return true;
  console.warn(`[config] ${name}="${raw}" is not a boolean — using default ${fallback}`);
  return fallback;
}

export interface Config {
  /** Path to Herdr's control socket. A non-Herdr-launched daemon must discover this itself. */
  socketPath: string;
  /**
   * Which dialer opens that socket. `auto` (the default) is correct everywhere: `node:net` on
   * Windows, where herdr's socket is a named pipe, and Bun's native transport elsewhere. Forcing
   * `net` on Linux/macOS exercises the Windows dial path against the real socket — the only way to
   * run that code without a Windows box. Set via `COLLIE_BOARD_HERDR_DIAL`.
   *
   * Optional so it stays out of unrelated test fixtures: `loadConfig` always resolves it, and an
   * absent value means the same thing as `auto` at the one place it's consumed.
   */
  dialMode?: DialMode;
  /** TCP port the bridge listens on (loopback only). `tailscale serve` proxies to it. */
  port: number;
  /**
   * Bind host. ALWAYS loopback by default — binding 0.0.0.0 would make the Tailscale identity
   * check meaningless (see ARCHITECTURE.md §6). Override only if you know exactly why.
   */
  host: string;
  /** Poll cadence for the state engine, ms. Also the fast fallback cadence when the event stream is down. */
  pollMs: number;
  /**
   * Relaxed safety-net poll cadence, ms, used while the events.subscribe stream is healthy. Events
   * poke immediate re-polls, so this interval only backstops a missed poke — a miss costs at most
   * one of these, never correctness. Falls back to {@link pollMs} the moment the stream drops.
   */
  pollIdleMs: number;
  /**
   * Debounce window before a blocked/done transition becomes a push, ms. An agent that resolves
   * within this window (you handled it at your desk) never notifies; one that fires is retracted
   * when it later resolves. See NotificationCoordinator. 0 = notify on the next tick (no debounce).
   */
  notifyDelayMs: number;
  /** How many lines of scrollback to pull for the agent detail view. */
  readLines: number;
  /**
   * Serve agent conversation history from the agent's own on-disk session log. This is the only
   * way to get scrollback for a Claude pane at all — Claude runs on the terminal's alternate
   * screen, which has no scrollback ring, so Herdr retains nothing behind the viewport (see
   * transcript.ts). Off disables the feature and its route wholesale.
   */
  transcript: boolean;
  /**
   * Root of the agent's session logs — Claude Code's `~/.claude/projects`. Every transcript read is
   * confined to this directory (after symlink resolution). Override only to relocate a non-default
   * Claude home; it is never derived from a request.
   */
  transcriptRoot: string;
  /** Key sequence sent to submit a reply after the text (agent-dependent; see HERDR_API.md). */
  submitKeys: string[];
  /**
   * Tailscale identity gate. If set, any request carrying a `Tailscale-User-Login` header
   * (injected by `tailscale serve`) must match this login — a mismatching tailnet user is
   * rejected. A request with no such header still passes (direct-loopback callers don't get one),
   * so this narrows *which* user is trusted rather than mandating the header. Empty = trust any
   * loopback caller (fine when only tailscaled can reach the port).
   */
  trustedUser: string;
  /**
   * Per-device authorisation. Name of a request header carrying an opaque device identifier,
   * injected by a trusted upstream reverse proxy. Empty = the feature is off (no behaviour change).
   * When set, devices whose header value isn't in {@link deviceAllowlist} are read-only. See
   * `deviceAuth()` in server.ts for the full matrix. The header is trusted only because the bridge
   * binds loopback behind the proxy — a direct client can't set it (same trust basis as trustedUser).
   */
  deviceHeader: string;
  /**
   * Device identifiers permitted to perform sensitive actions (typing into agent terminals,
   * structural creates). Everything else carrying the header is read-only. To revoke a device,
   * drop its value from this list and restart. Ignored when {@link deviceHeader} is empty.
   */
  deviceAllowlist: string[];
  /** Extra allowed request origins beyond localhost (e.g. your MagicDNS https origin). */
  allowedOrigins: string[];
  /**
   * Host-header allowlist (`host` or `host:port` values). When non-empty, the operator has opted
   * in to strict Host validation: any request whose `Host` header isn't a loopback form, one of
   * these, or a host parsed from {@link allowedOrigins} is rejected before the Origin check. This
   * closes the DNS-rebinding hole (Host==Origin==evil.com would otherwise pass), which matters most
   * under `COLLIE_BOARD_SERVE_MODE=http` (no TLS). Empty = validation off (legacy behaviour) — set this
   * to your MagicDNS name (`collie.<tailnet>.ts.net`), especially in http serve mode.
   */
  publicHosts: string[];
  /** Web Push (VAPID). All three required to enable push; otherwise push is disabled. */
  vapidPublic: string;
  vapidPrivate: string;
  vapidSubject: string;
  /** Where to persist push subscriptions and other runtime state. */
  stateDir: string;
  /**
   * Multi-session support. When on (default), the bridge fronts every running herdr session it
   * discovers under the config root, not just {@link socketPath}, and the UI gains a session
   * switcher. Off (`off`/`0`/`false`) pins the bridge to the primary session only — no discovery,
   * exactly the pre-feature behaviour. Client-supplied session names only ever select an
   * already-discovered session; they never build a filesystem path.
   */
  multiSession: boolean;
  /**
   * Whether `tailscale serve` is bypassed (COLLIE_BOARD_SKIP_SERVE=1) because an operator-run reverse
   * proxy (Caddy/Nginx) fronts the loopback bridge instead. The bridge itself handles every request
   * identically either way — this flag only informs the startup warnings: without `tailscale serve`
   * in front, the `Tailscale-User-Login` header is never injected, so {@link trustedUser} is inert
   * and per-device auth ({@link deviceHeader}) becomes the way to gate writes (README → Variant C).
   */
  skipServe: boolean;

  // ── Board (the fork) ────────────────────────────────────────────────────────

  /**
   * Herdr agent kind launched for a card that doesn't name its own (`claude`, `codex`, …; the set
   * is herdr's, see `herdr agent start --help`). Per-card `agentKind` overrides it.
   */
  boardAgentKind: string;
  /**
   * How many cards may have an agent running at once.
   *
   * This is a QUOTA guard, not a performance one: every worker and the copilot draw on the same
   * subscription, and four agents burning through a plan in parallel is how you discover the limit
   * at the worst moment. Deliberately low; raise it when you know your own ceiling.
   */
  boardMaxAgents: number;
  /** Prefix for branches the board creates, so a card's branch is recognisable in `git branch`. */
  boardBranchPrefix: string;
  /**
   * Context percentage above which a card is flagged as worth handing off. Advisory ONLY — the
   * handoff is always a manual tap (a handoff fired mid-refactor costs more than it saves).
   */
  boardHandoffPct: number;
  /**
   * Context-window size the gauge is a percentage OF, in tokens. Herdr doesn't know it and the
   * transcript doesn't state it, so it is config: 200k for a stock Claude Code, 1_000_000 for a
   * 1M-context model. A wrong value only skews the percentage — nothing depends on it being right.
   */
  boardCtxWindow: number;
  /**
   * The copilot (reformulation + post-`done` review). OFF by default, deliberately: it is a second
   * agent drawing on the same subscription as the workers, and spending someone's quota in the
   * background is not a default anyone should inherit by upgrading. `COLLIE_BOARD_COPILOT=on`.
   */
  boardCopilot: boolean;
  /** Agent kind for the copilot — it can be a cheaper one than the workers. Empty = same. */
  boardCopilotKind: string;
  /** The agent's context-reset command; per-kind (see `adapters/`). */
  boardCopilotClear: string;
}

/**
 * herdr's default socket location: `~/.config/herdr/herdr.sock` on Unix, `%APPDATA%\herdr\herdr.sock`
 * on Windows (the Windows beta keeps its config root under AppData\Roaming). Pure so both branches
 * are unit-testable on any platform.
 */
export function defaultSocketPath(
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): string {
  if (platform === "win32") {
    const appData = env.APPDATA ?? join(home, "AppData", "Roaming");
    return join(appData, "herdr", "herdr.sock");
  }
  return join(home, ".config", "herdr", "herdr.sock");
}

export function loadConfig(): Config {
  const stateDir =
    process.env.HERDR_PLUGIN_STATE_DIR ??
    process.env.COLLIE_BOARD_STATE_DIR ??
    join(homedir(), ".local", "state", "collie");

  const submitKeys = envList("COLLIE_BOARD_SUBMIT_KEYS");

  return {
    socketPath: process.env.HERDR_SOCKET_PATH ?? defaultSocketPath(),
    dialMode: envEnum("COLLIE_BOARD_HERDR_DIAL", ["auto", "net", "bun"] as const, "auto"),
    port: envInt("COLLIE_BOARD_PORT", 8788, { min: 1, max: 65535 }),
    host: process.env.COLLIE_BOARD_HOST ?? "127.0.0.1",
    pollMs: envInt("COLLIE_BOARD_POLL_MS", 1500, { min: 250 }),
    pollIdleMs: envInt("COLLIE_BOARD_POLL_IDLE_MS", 12_000, { min: 1000 }),
    notifyDelayMs: envInt("COLLIE_BOARD_NOTIFY_DELAY_MS", 30_000, { min: 0 }),
    readLines: envInt("COLLIE_BOARD_READ_LINES", 200, { min: 1 }),
    transcript: envBool("COLLIE_BOARD_TRANSCRIPT", true),
    transcriptRoot:
      process.env.COLLIE_BOARD_TRANSCRIPT_ROOT ?? join(homedir(), ".claude", "projects"),
    submitKeys: submitKeys.length ? submitKeys : ["Enter"],
    trustedUser: process.env.COLLIE_BOARD_TRUSTED_USER ?? "",
    deviceHeader: (process.env.COLLIE_BOARD_DEVICE_HEADER ?? "").trim(),
    deviceAllowlist: envList("COLLIE_BOARD_DEVICE_ALLOWLIST"),
    allowedOrigins: envList("COLLIE_BOARD_ALLOWED_ORIGINS"),
    publicHosts: envList("COLLIE_BOARD_PUBLIC_HOSTS"),
    vapidPublic: process.env.COLLIE_BOARD_VAPID_PUBLIC ?? "",
    vapidPrivate: process.env.COLLIE_BOARD_VAPID_PRIVATE ?? "",
    vapidSubject: process.env.COLLIE_BOARD_VAPID_SUBJECT ?? "mailto:admin@example.com",
    stateDir,
    multiSession: envBool("COLLIE_BOARD_MULTI_SESSION", true),
    skipServe: envBool("COLLIE_BOARD_SKIP_SERVE", false),
    boardAgentKind: (process.env.COLLIE_BOARD_AGENT_KIND ?? "claude").trim() || "claude",
    boardMaxAgents: envInt("COLLIE_BOARD_MAX_AGENTS", 3, { min: 1, max: 32 }),
    boardBranchPrefix: process.env.COLLIE_BOARD_BRANCH_PREFIX ?? "board/",
    boardHandoffPct: envInt("COLLIE_BOARD_HANDOFF_PCT", 70, { min: 1, max: 100 }),
    boardCtxWindow: envInt("COLLIE_BOARD_CTX_WINDOW", 200_000, { min: 1000 }),
    boardCopilot: envBool("COLLIE_BOARD_COPILOT", false),
    boardCopilotKind: (process.env.COLLIE_BOARD_COPILOT_KIND ?? "").trim(),
    boardCopilotClear: process.env.COLLIE_BOARD_COPILOT_CLEAR ?? "/clear",
  };
}
