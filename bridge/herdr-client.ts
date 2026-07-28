import type { AgentStatus } from "./types.ts";
import { dialHerdr, type DialMode, type SockHandle } from "./dial.ts";
import { decodeReplyLine, decodeStreamLine } from "./wire.ts";

// ─────────────────────────────────────────────────────────────────────────────
// The Herdr socket adapter. THIS IS THE ONLY FILE that knows Herdr's method names
// and wire shapes. Everything else talks to the typed methods below, so a Herdr
// API change is a one-file fix. Protocol facts are documented in HERDR_API.md.
//
// Key fact: RPC is ONE-SHOT — the server closes the connection after a single
// response. So every request opens a fresh connection, reads one line, closes.
// ─────────────────────────────────────────────────────────────────────────────

/** Raw wire shape of a workspace from `workspace.list`. */
interface WireWorkspace {
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  pane_count: number;
  tab_count: number;
  active_tab_id: string;
  agent_status: AgentStatus;
}

/** Raw wire shape of a tab from `tab.list`. */
interface WireTab {
  tab_id: string;
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  pane_count: number;
  agent_status: AgentStatus;
}

/** Raw wire shape of a pane from `pane.list` (and, identically, inside `session.snapshot`). */
export interface WirePane {
  pane_id: string;
  terminal_id: string;
  workspace_id: string;
  tab_id: string;
  focused: boolean;
  cwd: string;
  foreground_cwd?: string;
  agent?: string | null;
  agent_status: AgentStatus;
  /** User-set pane label (herdr `pane.rename`). Present only once set — the key disappears when
   *  cleared with `label: null`, so absent/null both read as "no label". */
  label?: string | null;
  revision: number;
  /**
   * The agent's OWN session identity, as the agent reported it to Herdr (herdr ≥ 0.7.2). For Claude
   * this is `{kind:"id", value:"<uuid>"}` — the uuid naming its on-disk session log, which is how
   * Collie serves real conversation history for a pane whose terminal keeps no scrollback (see
   * transcript.ts). Optional + defensively typed: older servers omit it, and `kind` may be something
   * other than "id" for other agents.
   */
  agent_session?: {
    source?: string;
    agent?: string;
    kind?: string;
    value?: string;
  } | null;
  /**
   * Scroll geometry (herdr ≥ 0.7.2); optional so older servers that omit it still typecheck.
   *
   * `max_offset_from_bottom` is how far the pane can scroll UP — the depth of its scrollback ring —
   * so `max_offset_from_bottom + viewport_rows` is the line count a `pane.read source:"recent"` can
   * return. Live-verified on a sandbox pane (2026-07-26): 95+31 → 127 lines read, 498+31 → 530 (the
   * +1 is the trailing newline). Exact once scrollback exists; an OVER-estimate on a near-empty
   * screen, where trailing blank rows are trimmed from the read (0+31 → 4 lines read).
   *
   * This is the only trustworthy "is there more to load" signal Herdr gives us — `PaneRead.truncated`
   * is ALWAYS false, even when a read demonstrably cut scrollback off (200 requested of 6895
   * available still reports `truncated: false`). Gate on this, never on `truncated`.
   */
  scroll?: {
    offset_from_bottom: number;
    max_offset_from_bottom: number;
    viewport_rows: number;
  } | null;
}

/**
 * Raw shape of `session.snapshot` — the whole herd in one reply, superseding the three parallel
 * list calls. `agents`/`layouts`/`focused_*` are carried too but intentionally unused: agents stay
 * derived from `panes` so there's one code path. Older servers predate the method (see StateEngine).
 */
export interface WireSnapshot {
  version: string;
  protocol: number;
  workspaces: WireWorkspace[];
  tabs: WireTab[];
  panes: WirePane[];
}

/** The freshly-created shell pane returned by tab.create / workspace.create (`root_pane`). */
export interface CreatedShell {
  paneId: string;
  workspaceId: string;
  workspaceLabel?: string;
  tabId: string;
  cwd: string;
}

export interface PaneRead {
  pane_id: string;
  text: string;
  truncated: boolean;
  revision: number;
}

type ReadSource = "visible" | "recent" | "recent-unwrapped";
type ReadFormat = "text" | "ansi";

let idCounter = 0;

/** Per-request wall-clock budget. Exported so callers can pass it explicitly alongside a dial mode. */
export const DEFAULT_TIMEOUT_MS = 5000;

/** Budget for `agent.start`, which blocks server-side until the agent's TUI is ready for input. */
export const AGENT_START_TIMEOUT_MS = 45_000;

/** Raw `worktree.create` / `worktree.open` reply. */
interface WireWorktreeResult {
  worktree: { path: string; branch?: string | null };
  workspace: WireWorkspace;
  tab: WireTab;
  root_pane: WirePane;
  /** `worktree.open` only — true when the worktree was already open (idempotent re-open). */
  already_open?: boolean;
}

/**
 * Raw `agent.get` reply. A superset of {@link WirePane} with the launch-state fields — which are
 * present ONLY on agent records, and only while they mean something (herdr omits them once settled,
 * so `undefined` reads as "not launching" / "unknown", never as false).
 */
export interface WireAgent extends WirePane {
  name?: string | null;
  /** True while herdr is still bringing the agent up; `agent.prompt` is refused until it clears. */
  launch_pending?: boolean;
  /** True once the agent's TUI will accept a prompt. THE readiness signal. */
  interactive_ready?: boolean;
}

/** A worktree-backed workspace, ready to launch an agent in. */
export interface CreatedWorktree {
  /** Absolute path of the checkout — the cwd every `git` call for this card runs in. */
  checkoutPath: string;
  branch: string | null;
  workspaceId: string;
  workspaceLabel: string;
  tabId: string;
  paneId: string;
  /** True when the workspace was already open, so nothing was created. */
  alreadyOpen: boolean;
}

function toCreatedWorktree(r: WireWorktreeResult): CreatedWorktree {
  return {
    checkoutPath: r.worktree.path,
    branch: r.worktree.branch ?? null,
    workspaceId: r.workspace.workspace_id,
    workspaceLabel: r.workspace.label,
    tabId: r.tab.tab_id,
    paneId: r.root_pane.pane_id,
    alreadyOpen: r.already_open === true,
  };
}

export class HerdrClient {
  constructor(
    private readonly socketPath: string,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
    /** Which dialer to use; see {@link DialMode}. `auto` picks by platform. */
    private readonly dialMode: DialMode = "auto",
  ) {}

  /**
   * One request, one reply, one connection. Rejects on error reply, timeout, or early close.
   *
   * `timeoutMs` overrides the client-wide budget for the handful of methods that legitimately take
   * much longer than an RPC: `agent.start` waits for the agent to become interactively ready
   * (30 s default, server-side), and `agent.prompt`/`agent.wait` with a `wait` clause block until
   * the agent reaches a state. Applying the 5 s default to those would time out every single call.
   */
  private request<T>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs: number = this.timeoutMs,
  ): Promise<T> {
    const id = `b${++idCounter}`;
    return new Promise<T>((resolve, reject) => {
      let buf = "";
      let settled = false;
      // The live socket, once the dial opens one. Hoisted so EVERY terminal path (timeout
      // included) can close it — otherwise a timeout leaves the FD dangling.
      let socket: SockHandle | null = null;
      // Aborts a dial that is still connecting — a timeout that fires mid-connect has no socket
      // to end() yet, and without this the pending OS handle lives until the connect settles.
      let cancelDial: (() => void) | null = null;
      // Stream-decode so a multi-byte UTF-8 codepoint split across chunk boundaries isn't
      // corrupted into replacement characters.
      const decoder = new TextDecoder("utf-8");
      // Settle BEFORE closing: socket.end() synchronously fires `close`, which re-enters finish —
      // but `settled` is already set there, so that reject is a no-op and we keep the real outcome.
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
        if (socket) {
          try {
            socket.end();
          } catch {
            /* ignore */
          }
          socket = null;
        } else if (cancelDial) {
          // Timed out (or failed) while still connecting — abort the in-flight dial.
          try {
            cancelDial();
          } catch {
            /* ignore */
          }
        }
        cancelDial = null;
      };
      const timer = setTimeout(
        () => finish(() => reject(new Error(`herdr ${method}: timed out after ${timeoutMs}ms`))),
        timeoutMs,
      );

      dialHerdr(this.socketPath, {
        onDial(cancel) {
          cancelDial = cancel;
        },
        open(s) {
          socket = s;
        },
        data(s, chunk) {
          socket = s;
          buf += decoder.decode(chunk, { stream: true });
          const nl = buf.indexOf("\n");
          if (nl < 0) return;
          const line = buf.slice(0, nl);
          finish(() => {
            try {
              resolve(decodeReplyLine<T>(line, method));
            } catch (e) {
              reject(e as Error);
            }
          });
        },
        error(_s, err) {
          finish(() => reject(err));
        },
        close() {
          finish(() => reject(new Error(`herdr ${method}: connection closed before reply`)));
        },
      }, this.dialMode)
        .then((s) => {
          // Already settled (e.g. timed out) before the connection opened — close it so the FD
          // doesn't leak, and don't bother writing.
          if (settled) {
            try {
              s.end();
            } catch {
              /* ignore */
            }
            return;
          }
          socket = s;
          // Write only once the connection is established — matches the verified probe pattern.
          s.write(JSON.stringify({ id, method, params }) + "\n");
          s.flush();
        })
        .catch((err) => finish(() => reject(err)));
    });
  }

  async listWorkspaces(): Promise<WireWorkspace[]> {
    const r = await this.request<{ workspaces: WireWorkspace[] }>("workspace.list");
    return r.workspaces;
  }

  async listPanes(): Promise<WirePane[]> {
    const r = await this.request<{ panes: WirePane[] }>("pane.list");
    return r.panes;
  }

  /** All tabs across every workspace (`tab.list` with no filter returns the full set). */
  async listTabs(): Promise<WireTab[]> {
    const r = await this.request<{ tabs: WireTab[] }>("tab.list");
    return r.tabs;
  }

  /**
   * The whole herd in one round-trip (herdr ≥ 0.7.2). Replaces workspace.list + pane.list +
   * tab.list for the poll loop. An older server rejects the method with an "unknown variant" error
   * reply — StateEngine treats only that as a permanent signal to fall back to the three list calls.
   */
  async sessionSnapshot(): Promise<WireSnapshot> {
    const r = await this.request<{ type: string; snapshot: WireSnapshot }>("session.snapshot");
    return r.snapshot;
  }

  /**
   * Open a LONG-LIVED `events.subscribe` stream. Unlike every other method here (one-shot), this
   * connection stays open: after the ack, each line is an event. It exists ONLY to poke re-polls —
   * callers must not treat events as state. `onDown` fires exactly once when the stream ends for any
   * reason (error line, socket error, close, or a 5s ack timeout); `close()` is idempotent and also
   * ends it with reason "closed". Reconnect/backoff live in the caller (see EventPoker).
   */
  subscribeEvents(opts: {
    subscriptions: Array<{ type: string; pane_id?: string }>;
    onUp: () => void;
    onEvent: (event: string, data: unknown) => void;
    onDown: (reason: string) => void;
  }): { close(): void } {
    const id = `es${++idCounter}`;
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    let socket: SockHandle | null = null;
    let cancelDial: (() => void) | null = null;
    let down = false;
    let acked = false;

    // The single terminal path. Guarded so onDown never fires twice, and closes the FD once.
    const fireDown = (reason: string) => {
      if (down) return;
      down = true;
      clearTimeout(ackTimer);
      if (socket) {
        try {
          socket.end();
        } catch {
          /* ignore */
        }
        socket = null;
      } else if (cancelDial) {
        // Ack timeout (or close()) while the dial was still connecting — abort it so repeated
        // reconnect attempts can't stack pending OS handles.
        try {
          cancelDial();
        } catch {
          /* ignore */
        }
      }
      cancelDial = null;
      opts.onDown(reason);
    };

    // A server that accepts the connection but never acks (hung) counts as down, not healthy.
    const ackTimer = setTimeout(() => fireDown("ack timeout"), 5000);

    const handleLine = (line: string) => {
      if (line === "") return;
      let decoded;
      try {
        decoded = decodeStreamLine(line);
      } catch (e) {
        fireDown(`protocol error: ${(e as Error).message}`);
        return;
      }
      if (decoded.kind === "error") {
        fireDown(`${decoded.code}: ${decoded.message}`);
        return;
      }
      if (decoded.kind === "ack") {
        if (acked) return;
        acked = true;
        clearTimeout(ackTimer);
        opts.onUp();
        return;
      }
      opts.onEvent(decoded.event, decoded.data);
    };

    dialHerdr(this.socketPath, {
      onDial(cancel) {
        cancelDial = cancel;
      },
      open(s) {
        socket = s;
      },
      // Multiple lines can arrive per chunk (bursty events); drain ALL complete lines and keep the
      // stream open. Stream-decode so a multi-byte codepoint split across chunks isn't corrupted.
      data(s, chunk) {
        socket = s;
        buf += decoder.decode(chunk, { stream: true });
        let nl = buf.indexOf("\n");
        while (nl >= 0 && !down) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          handleLine(line);
          nl = buf.indexOf("\n");
        }
      },
      error(_s, err) {
        fireDown(err.message || "socket error");
      },
      close() {
        fireDown("connection closed");
      },
    }, this.dialMode)
      .then((s) => {
        if (down) {
          try {
            s.end();
          } catch {
            /* ignore */
          }
          return;
        }
        socket = s;
        s.write(JSON.stringify({ id, method: "events.subscribe", params: { subscriptions: opts.subscriptions } }) + "\n");
        s.flush();
      })
      .catch((err) => fireDown((err as Error).message || "connect failed"));

    return { close: () => fireDown("closed") };
  }

  /**
   * Create a new tab in a workspace, opening a fresh shell pane. `cwd` is optional — omitted, the
   * tab inherits the workspace's directory (verified). `focus:false` so we never yank the desktop
   * TUI's focus. Returns the new shell pane to navigate into.
   */
  async createTab(workspaceId: string, opts: { label?: string; cwd?: string } = {}): Promise<CreatedShell> {
    const params: Record<string, unknown> = { workspace_id: workspaceId, focus: false };
    if (opts.label) params.label = opts.label;
    if (opts.cwd) params.cwd = opts.cwd;
    const r = await this.request<{ root_pane: WirePane }>("tab.create", params);
    const p = r.root_pane;
    return { paneId: p.pane_id, workspaceId: p.workspace_id, tabId: p.tab_id, cwd: p.cwd };
  }

  /**
   * Create a new workspace ("space") with a fresh shell pane rooted at `cwd`. `focus:false` to
   * leave the desktop TUI undisturbed. Returns the new shell pane (with its workspace label).
   */
  async createWorkspace(opts: { cwd: string; label?: string }): Promise<CreatedShell> {
    const params: Record<string, unknown> = { cwd: opts.cwd, focus: false };
    if (opts.label) params.label = opts.label;
    const r = await this.request<{
      workspace: WireWorkspace;
      root_pane: WirePane;
    }>("workspace.create", params);
    const p = r.root_pane;
    return {
      paneId: p.pane_id,
      workspaceId: p.workspace_id,
      workspaceLabel: r.workspace.label,
      tabId: p.tab_id,
      cwd: p.cwd,
    };
  }

  async readPane(
    paneId: string,
    source: ReadSource,
    lines: number,
    format: ReadFormat = "text",
  ): Promise<PaneRead> {
    const r = await this.request<{ read: PaneRead }>("pane.read", {
      pane_id: paneId,
      source,
      lines,
      // "text" = plain (no escapes); "ansi" = SGR color codes (verified: no cursor sequences),
      // parsed + escaped safely on the client to render a faithful, colored terminal mirror.
      format,
    });
    return r.read;
  }

  /** Type literal text into a pane's terminal (does not submit). */
  sendPaneText(paneId: string, text: string): Promise<void> {
    return this.request<void>("pane.send_text", { pane_id: paneId, text });
  }

  /** Send key names (e.g. ["Enter"]) to a pane — used to submit a reply. */
  sendPaneKeys(paneId: string, keys: string[]): Promise<void> {
    return this.request<void>("pane.send_keys", { pane_id: paneId, keys });
  }

  /** Close a pane, terminating its agent ("kill"). Resolves on Herdr's `{type:"ok"}` reply. */
  closePane(paneId: string): Promise<void> {
    return this.request<void>("pane.close", { pane_id: paneId });
  }

  /**
   * Set or clear a pane's label. `label: null` clears it (the key then disappears from pane
   * records). Resolves on Herdr's `pane_info` reply — the returned pane isn't consumed here, the
   * next snapshot poll carries the new label (pane.rename emits no event). Bad id → `pane_not_found`.
   */
  renamePane(paneId: string, label: string | null): Promise<void> {
    return this.request<void>("pane.rename", { pane_id: paneId, label });
  }

  /**
   * Set a tab's label. Unlike {@link renamePane}, `label` is a NON-null string: herdr's `tab.rename`
   * rejects `null` (`invalid type: null, expected a string`) and stores an empty string literally
   * rather than clearing to the default number — both live-verified 2026-07-19 — so a tab has no
   * "clear". Resolves on herdr's `tab_info` reply; the new label surfaces on the next snapshot poll
   * (tab.rename also emits a `tab_renamed` event, which Collie doesn't consume). Bad id → `tab_not_found`.
   */
  renameTab(tabId: string, label: string): Promise<void> {
    return this.request<void>("tab.rename", { tab_id: tabId, label });
  }

  /**
   * Close a tab, terminating EVERY pane inside it (live-verified 2026-07-19: the tab's shell/agent
   * panes all disappear with it — closing a tab is a bulk pane-close). Resolves on herdr's
   * `{type:"ok"}` reply; the closure surfaces on the next `session.snapshot` poll (tab.close also
   * emits a `tab_closed` event, which Collie doesn't consume). Bad id → `tab_not_found`.
   */
  closeTab(tabId: string): Promise<void> {
    return this.request<void>("tab.close", { tab_id: tabId });
  }

  // ── Board additions (the fork) ────────────────────────────────────────────
  // Everything below is used by the card lifecycle. Verified against the bundled schema of the
  // installed server (`herdr api schema --json`) and live-probed on 0.7.5, 2026-07-28.

  /**
   * Create a git worktree AND open it as a workspace with a shell pane — checkout, workspace, tab
   * and pane in one RPC. `base` seeds a NEW branch; when the branch already exists it is reused and
   * `base` is ignored (live-verified).
   *
   * ⚠️ Live-verified failure mode: if the checkout DIRECTORY already exists, herdr fails with
   * `worktree_create_failed` ("… existe déjà" straight from git) rather than reusing it. That is
   * what {@link openWorktree} is for — see `startCard` in cards.ts, which falls back to it.
   */
  async createWorktree(opts: {
    cwd: string;
    branch: string;
    base?: string | null;
    label?: string;
  }): Promise<CreatedWorktree> {
    const params: Record<string, unknown> = { cwd: opts.cwd, branch: opts.branch, focus: false };
    if (opts.base) params.base = opts.base;
    if (opts.label) params.label = opts.label;
    const r = await this.request<WireWorktreeResult>("worktree.create", params);
    return toCreatedWorktree(r);
  }

  /**
   * Open an EXISTING worktree as a workspace. Idempotent: a worktree already open returns
   * `already_open: true` with the live workspace and its root pane (live-verified), which is exactly
   * what relaunching an orphaned card needs.
   */
  async openWorktree(opts: { cwd: string; branch: string; label?: string }): Promise<CreatedWorktree> {
    const params: Record<string, unknown> = { cwd: opts.cwd, branch: opts.branch, focus: false };
    if (opts.label) params.label = opts.label;
    const r = await this.request<WireWorktreeResult>("worktree.open", params);
    return toCreatedWorktree(r);
  }

  /**
   * Launch a supported agent in a pane sitting at its interactive shell prompt. `kind` is one of
   * herdr's known agent kinds (claude, codex, …); `name` must match `^[a-z][a-z0-9_-]{0,31}$`.
   *
   * ⚠️ **This does NOT wait for the agent to be usable.** The CLI's help says success means the
   * agent "is ready for input", but that is the CLI polling afterwards — the socket method itself
   * returns in ~2 ms with `agent_status: "unknown"` and leaves `launch_pending: true` on the pane
   * (live-probed on 0.7.5, 2026-07-28). Prompting in that window fails with `agent_not_ready`.
   * Callers must poll {@link getAgent} until `interactive_ready` — see `waitForAgentReady` in
   * cards.ts. `timeout_ms` is herdr's own startup deadline, not a wait on our side.
   */
  async startAgent(opts: {
    paneId: string;
    kind: string;
    name: string;
    args?: string[];
    timeoutMs?: number;
  }): Promise<void> {
    const timeout = opts.timeoutMs ?? AGENT_START_TIMEOUT_MS;
    const params: Record<string, unknown> = {
      pane_id: opts.paneId,
      kind: opts.kind,
      name: opts.name,
      // Herdr's own startup deadline (must be > 3000). It bounds the launch, not this call.
      timeout_ms: Math.max(3001, timeout),
    };
    if (opts.args?.length) params.args = opts.args;
    await this.request<unknown>("agent.start", params, DEFAULT_TIMEOUT_MS);
  }

  /**
   * One agent's live record. `interactive_ready` is the field that matters: it is the only signal
   * that `agent.prompt` will be accepted (see {@link startAgent}). `target` takes a pane id or the
   * agent's name — both live-verified.
   */
  async getAgent(target: string): Promise<WireAgent> {
    const r = await this.request<{ agent: WireAgent }>("agent.get", { target });
    return r.agent;
  }

  /**
   * Submit a prompt to an agent — the text AND its submit keystroke, handled by herdr per agent.
   * Distinct from `agent.send` / `pane.send_text`, which type literal text and leave it unsent.
   *
   * With `until`, herdr blocks until the agent reaches one of those states; the request budget then
   * has to cover the agent's whole turn, which is why `timeoutMs` is a parameter and not a constant.
   */
  async promptAgent(opts: {
    target: string;
    text: string;
    until?: AgentStatus[];
    timeoutMs?: number;
  }): Promise<void> {
    const params: Record<string, unknown> = { target: opts.target, text: opts.text };
    if (opts.until?.length) {
      params.wait = { until: opts.until, timeout_ms: (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) - 2000 };
    }
    await this.request<unknown>("agent.prompt", params, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }

  /** Block until an agent reaches one of `until`. Same budget caveat as {@link promptAgent}. */
  async waitAgent(opts: { target: string; until: AgentStatus[]; timeoutMs: number }): Promise<void> {
    await this.request<unknown>(
      "agent.wait",
      { target: opts.target, until: opts.until, timeout_ms: opts.timeoutMs - 2000 },
      opts.timeoutMs,
    );
  }

  /** One pane's current record — `cwd` / `foreground_cwd` are what the card's diff is scoped to. */
  async getPane(paneId: string): Promise<WirePane> {
    const r = await this.request<{ pane: WirePane }>("pane.get", { pane_id: paneId });
    return r.pane;
  }

  /**
   * Push display-only metadata onto a pane. We use it for one thing: the context gauge, which then
   * renders as `$ctx` in herdr's own Agents sidebar — so the number is visible in the TUI, not just
   * in the phone app. `ttl_ms` makes it self-expiring, so a bridge that stops reporting leaves no
   * stale number behind.
   *
   * Token KEYS are constrained server-side to `^[A-Za-z0-9_-]{1,32}$`; values are free strings.
   */
  reportPaneMetadata(opts: {
    paneId: string;
    source: string;
    tokens: Record<string, string | null>;
    ttlMs?: number;
  }): Promise<void> {
    const params: Record<string, unknown> = {
      pane_id: opts.paneId,
      source: opts.source,
      tokens: opts.tokens,
    };
    if (opts.ttlMs) params.ttl_ms = opts.ttlMs;
    return this.request<void>("pane.report_metadata", params);
  }

  /** Reachability check for the connected/disconnected banner. */
  async ping(): Promise<boolean> {
    try {
      await this.listWorkspaces();
      return true;
    } catch {
      return false;
    }
  }
}
