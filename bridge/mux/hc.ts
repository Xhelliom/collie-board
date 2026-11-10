import type { AgentStatus } from "../types.ts";
import { dialHerdr, type DialHandlers, type DialMode, type SockHandle } from "../dial.ts";
import {
  MuxUnsupported,
  type BoardTab,
  type CreatedShell,
  type CreatedWorktree,
  type Mux,
  type PaneRead,
  type ReadSource,
  type WireAgent,
  type WirePane,
  type WireSnapshot,
  type WireTab,
  type WireWorkspace,
} from "./mux.ts";
import { DEFAULT_TIMEOUT_MS } from "./herdr09.ts";
import { addWorktreeAt, runGit, worktreeDirFor, worktreePathFor, type GitRunner } from "../git.ts";

// ─────────────────────────────────────────────────────────────────────────────
// The herdr-core (`hc`) engine behind `Mux` — READ ONLY (ADR 0052 phase 2). THE ONLY FILE that knows
// hc's method names and wire shapes; the measured contract is HERDR_CORE_API.md.
//
// - JSON-RPC 2.0, one line per message, on the core's socket. The connection may stay open, but one
//   request per connection is still valid — so a call opens, asks, reads its reply, closes.
// - A terminal is our pane: its address (`t3`) is the pane id, which is also what `HC_TERMINAL_ID`
//   carries in the agent's environment — so provenance (ADR 0010) matches the snapshot.
// - hc has no workspace and no tab: the snapshot has ONE synthetic space holding every terminal.
// - The status is the program's own (OSC 7501), never read off the screen.
// - Writes (phase 3): a pane is a shell run in its directory, the agent is typed into it, a prompt is
//   `terminal.send` and its `started`. Worktrees are git's (bridge/git.ts). No tab, no paste without
//   Enter, no pane metadata: those reject with MuxUnsupported.
// ─────────────────────────────────────────────────────────────────────────────

/** The one space (and tab) every hc terminal is shown in. */
export const HC_SPACE = "hc";

/**
 * Closes a card's opening prompt under hc. A terminal the agent starts with `hc run` is its child, and
 * hc types a note into the agent when that child ends — a turn spent (HERDR_CORE_API.md §3, measured).
 * `--no-notify` is set by whoever starts the child and nothing else turns it off (no default, no
 * per-parent switch, no method after the start), so the agent is the one to pass it.
 */
export const HC_NO_NOTIFY_HINT =
  "Start any helper terminal with `hc run --no-notify …`: without it, hc types a note into this session when the helper ends, and that costs you a turn. The board already shows your helpers (`hc ls`, their parent is you).";

/** Labels the bridge puts on the terminals it runs: the directory (how a worktree's shell is found again), the pane's name. */
const CWD_LABEL = "collie.cwd";
const NAME_LABEL = "collie.name";

/**
 * herdr-app shows a terminal carrying `herdr.space` + `herdr.tab` (HERDR_CORE_API.md §3, measured): the
 * board's go in ONE space, apart from the operator's own, a tab per card. `collie.tab` keeps the title
 * the tab should carry — the app names nothing from a label, the name is written in its document.
 */
const APP_SPACE = "collie-board";
const APP_SPACE_NAME = "Collie Board";
const SPACE_LABEL = "herdr.space";
const TAB_LABEL = "herdr.tab";
const TITLE_LABEL = "collie.tab";
const appLabels = (show?: BoardTab): Record<string, string> =>
  show ? { [SPACE_LABEL]: APP_SPACE, [TAB_LABEL]: `collie-${show.tab}`, [TITLE_LABEL]: show.title } : {};

/** The part of herdr-app's `herdr-app` document this engine names things in; the rest is carried through untouched. */
export interface AppDoc {
  spaces?: Array<{ id: string; name: string; tabs?: Array<{ id: string; name: string }> }>;
}

/**
 * Name the board's space and its tabs in herdr-app's document, in place. Only what nobody named: a
 * name the operator gave stays. `pending` = a tab the app has not adopted yet (or the app is closed).
 */
export function nameAppTabs(doc: AppDoc | null, titles: Map<string, string>): { changed: boolean; pending: boolean } {
  const space = doc?.spaces?.find((s) => s.id === APP_SPACE);
  let changed = false;
  if (space && !space.name) (space.name = APP_SPACE_NAME), (changed = true);
  let pending = false;
  for (const [id, title] of titles) {
    const tab = space?.tabs?.find((t) => t.id === id);
    if (!tab) pending = true;
    else if (!tab.name) (tab.name = title), (changed = true);
  }
  return { changed, pending };
}

/** `send` waits ~3 s of quiet, then a few seconds for `working` (measured 1.8 s total). */
const SEND_TIMEOUT_MS = 20_000;

/** herdr 0.9's key names (`Enter`, `Escape`, `shift+tab`) → hc's (`enter`, `esc`, `shift+tab`). */
export function hcKey(key: string): string {
  return key === "Escape" ? "esc" : key.toLowerCase();
}

/** One shell line from an argv, POSIX-quoted. shortcut: POSIX shells only; a Windows core's cmd.exe needs its own quoting. */
export function shellLine(argv: string[]): string {
  return argv.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replaceAll("'", `'\\''`)}'`)).join(" ");
}

/** The transport: dial the core and hand back a socket. Injected so the Windows named pipe (and tests) plug in. */
export type HcDial = (handlers: DialHandlers) => Promise<SockHandle>;

/** The part of hc's `Terminal` (`hc schema`) this engine reads. */
export interface HcTerminal {
  address: string;
  argv: string[];
  cwd: string;
  state: string;
  name?: string | null;
  labels?: Record<string, string>;
  /** The terminal that started it (`hc run` from inside a terminal), set once at start. */
  parent?: string | null;
  turn?: number;
  foreground?: { pid: number; name: string; argv: string[]; cwd: string } | null;
  status?: { state: string; app?: string; kind?: string | null; msg?: string } | null;
}

/** OSC 7501 state → ours. `error` needs the human as much as a question does. */
export function hcStatus(state: string | undefined): AgentStatus {
  switch (state) {
    case "idle":
    case "working":
    case "blocked":
    case "done":
      return state;
    case "error":
      return "blocked";
    default:
      return "unknown";
  }
}

/** The app a terminal reports, under the agent name the rest of the bridge knows (adapters, transcripts). */
const APP_AGENT: Record<string, string> = { "claude-code": "claude" };

/** The agent in a terminal, or null for a plain program (it reports no status — hc never guesses). */
export function hcAgent(t: HcTerminal): string | null {
  const app = t.status?.app;
  return app ? (APP_AGENT[app] ?? app) : null;
}

export function toWirePane(t: HcTerminal): WirePane {
  return {
    pane_id: t.address,
    terminal_id: t.address,
    workspace_id: HC_SPACE,
    tab_id: HC_SPACE,
    focused: false,
    cwd: t.cwd,
    ...(t.foreground ? { foreground_cwd: t.foreground.cwd } : {}),
    agent: hcAgent(t),
    agent_status: hcStatus(t.status?.state),
    label: t.labels?.[NAME_LABEL] || t.name || null,
    revision: t.turn ?? 0,
  };
}

/**
 * hc's `children_of`, read off the one `terminal.list` the snapshot already makes (`terminal.list` has
 * no such filter; the `parent` it returns is the same fact): each live terminal → the names of its live
 * children. They are the card agent's subagents under hc, in place of the transcript (subagents.ts).
 */
export function hcChildren(live: HcTerminal[]): Map<string, string[]> {
  const kids = new Map<string, string[]>();
  for (const t of live) {
    if (!t.parent) continue;
    kids.set(t.parent, [...(kids.get(t.parent) ?? []), t.labels?.[NAME_LABEL] || t.name || t.address]);
  }
  return kids;
}

export function hcSnapshot(terminals: HcTerminal[], version = "hc"): WireSnapshot {
  const live = terminals.filter((t) => t.state === "live");
  const kids = hcChildren(live);
  const panes = live.map((t): WirePane => {
    const children = kids.get(t.address);
    return children ? { ...toWirePane(t), children } : toWirePane(t);
  });
  const workspace: WireWorkspace = {
    workspace_id: HC_SPACE,
    number: 1,
    label: HC_SPACE,
    focused: false,
    pane_count: panes.length,
    tab_count: 1,
    active_tab_id: HC_SPACE,
    agent_status: "unknown",
  };
  const tab: WireTab = {
    tab_id: HC_SPACE,
    workspace_id: HC_SPACE,
    number: 1,
    label: HC_SPACE,
    focused: false,
    pane_count: panes.length,
    agent_status: "unknown",
  };
  return { version, protocol: 0, workspaces: [workspace], tabs: [tab], panes };
}

/** One line off the socket: a reply, an error reply, an `event` notification, or another notice. */
export type HcLine =
  | { kind: "reply"; id: unknown; result: unknown }
  | { kind: "error"; id: unknown; message: string }
  | { kind: "event"; type: string; data: unknown }
  | { kind: "notice"; method: string };

/** Decode one line. Throws only on a protocol violation (bad JSON, unknown shape). */
export function decodeHcLine(line: string): HcLine {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(line) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`hc: bad line: ${(e as Error).message}`);
  }
  if (msg !== null && typeof msg === "object") {
    if (msg.error && typeof msg.error === "object") {
      const err = msg.error as { message?: string; data?: { kind?: string } };
      const kind = err.data?.kind;
      return { kind: "error", id: msg.id, message: `${kind ? `${kind}: ` : ""}${err.message ?? "error"}` };
    }
    if ("result" in msg) return { kind: "reply", id: msg.id, result: msg.result };
    if (msg.method === "event" && msg.params && typeof msg.params === "object") {
      const p = msg.params as { type?: unknown; data?: unknown };
      if (typeof p.type === "string") return { kind: "event", type: p.type, data: p.data };
    }
    if (typeof msg.method === "string") return { kind: "notice", method: msg.method };
  }
  throw new Error(`hc: unexpected line: ${line}`);
}

let seq = 0;

export class Hc implements Mux {
  private readonly dial: HcDial;

  constructor(
    socketPath: string,
    dialMode: DialMode = "auto",
    dial?: HcDial,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
    private readonly git: GitRunner = runGit,
    private readonly pause: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    this.dial = dial ?? ((h) => dialHerdr(socketPath, h, dialMode));
  }

  /**
   * Open a connection, send one request, feed every line that answers it (or is a notification) to
   * `on`; `onEnd` fires exactly once, whatever ends it. Returns the ender.
   */
  private open(method: string, params: Record<string, unknown>, on: (m: HcLine, end: (reason: string) => void) => void, onEnd: (reason: string) => void): (reason: string) => void {
    const id = ++seq;
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    let sock: SockHandle | null = null;
    let cancel: (() => void) | null = null;
    let ended = false;
    const end = (reason: string) => {
      if (ended) return;
      ended = true;
      try {
        if (sock) sock.end();
        else cancel?.();
      } catch {
        /* ignore */
      }
      onEnd(reason);
    };
    this.dial({
      onDial: (c) => (cancel = c),
      open: (s) => (sock = s),
      data: (s, chunk) => {
        sock = s;
        buf += decoder.decode(chunk, { stream: true });
        let nl;
        while (!ended && (nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let m: HcLine;
          try {
            m = decodeHcLine(line);
          } catch (e) {
            end((e as Error).message);
            return;
          }
          if ((m.kind === "reply" || m.kind === "error") && m.id !== id) continue;
          on(m, end);
        }
      },
      error: (_s, err) => end(err.message || "socket error"),
      close: () => end("connection closed"),
    })
      .then((s) => {
        if (ended) {
          s.end();
          return;
        }
        sock = s;
        s.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
        s.flush();
      })
      .catch((e: Error) => end(e.message || "connect failed"));
    return end;
  }

  private request<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = this.timeoutMs): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const end = this.open(
        method,
        params,
        (m, end) => {
          if (m.kind === "reply") {
            settled = true;
            resolve(m.result as T);
            end("done");
          } else if (m.kind === "error") end(m.message);
        },
        (reason) => {
          clearTimeout(timer);
          if (!settled) reject(new Error(`hc ${method}: ${reason}`));
        },
      );
      const timer = setTimeout(() => end(`timed out after ${timeoutMs}ms`), timeoutMs);
    });
  }

  async ping(): Promise<boolean> {
    try {
      await this.request("hello");
      return true;
    } catch {
      return false;
    }
  }

  async sessionSnapshot(): Promise<WireSnapshot> {
    const r = await this.request<{ terminals: HcTerminal[] }>("terminal.list");
    return hcSnapshot(r.terminals);
  }

  async listWorkspaces(): Promise<WireWorkspace[]> {
    return (await this.sessionSnapshot()).workspaces;
  }

  async listTabs(): Promise<WireTab[]> {
    return (await this.sessionSnapshot()).tabs;
  }

  async listPanes(): Promise<WirePane[]> {
    return (await this.sessionSnapshot()).panes;
  }

  /**
   * hc's `events.subscribe`: a snapshot reply (= the ack), then `event` notifications. Every terminal,
   * whatever `subscriptions` asks — herdr 0.9's per-pane types have no hc meaning, and an event only
   * pokes the engine's re-poll (EventPoker), it is never state. Heartbeats are not news.
   */
  subscribeEvents(opts: {
    subscriptions: Array<{ type: string; pane_id?: string }>;
    onUp: () => void;
    onEvent: (event: string, data: unknown) => void;
    onDown: (reason: string) => void;
  }): { close(): void } {
    let acked = false;
    const end = this.open(
      "events.subscribe",
      {},
      (m, end) => {
        if (m.kind === "error") end(m.message);
        else if (m.kind === "reply" && !acked) {
          acked = true;
          clearTimeout(ackTimer);
          opts.onUp();
        } else if (m.kind === "event" && m.type !== "heartbeat") opts.onEvent(m.type, m.data);
      },
      (reason) => {
        clearTimeout(ackTimer);
        opts.onDown(reason);
      },
    );
    const ackTimer = setTimeout(() => end("ack timeout"), 5000);
    return { close: () => end("closed") };
  }

  async getPane(paneId: string): Promise<WirePane> {
    return toWirePane(await this.request<HcTerminal>("terminal.get", { terminal: paneId }));
  }

  /** Plain text, no ANSI (that would be `terminal.attach`); `visible` is the screen alone. */
  async readPane(paneId: string, source: ReadSource, lines: number): Promise<PaneRead> {
    const r = await this.request<{ text: string; complete: boolean }>("terminal.read", {
      terminal: paneId,
      lines: source === "visible" ? 0 : lines,
    });
    return { pane_id: paneId, text: r.text, truncated: !r.complete, revision: 0 };
  }

  async paneProcess(paneId: string): Promise<{ pid: number; cwd: string; name: string } | null> {
    const t = await this.request<HcTerminal>("terminal.get", { terminal: paneId });
    return t.foreground ? { pid: t.foreground.pid, cwd: t.foreground.cwd, name: t.foreground.name } : null;
  }

  // ── Writes (phase 3) ──
  // Every pane we open is the machine's SHELL, run where the work is: the pane (= the terminal's
  // address, forever) must exist before its agent, because the card's session records it first and
  // provenance (HC_TERMINAL_ID) is that address. `startAgent` then types the agent's command into it.

  private no(op: string): Promise<never> {
    return Promise.reject(new MuxUnsupported("hc", op));
  }

  private async shell(cwd: string, label?: string, show?: BoardTab): Promise<string> {
    const labels: Record<string, string> = { [CWD_LABEL]: cwd, ...(label ? { [NAME_LABEL]: label } : {}), ...appLabels(show) };
    // A core started from inside a Claude pane hands CLAUDE_CODE_CHILD_SESSION=1 down, and Claude then
    // writes no transcript; `env` only adds, so force it back (HERDR_CORE_API.md §3, measured).
    const env = { CLAUDE_CODE_FORCE_SESSION_PERSISTENCE: "1" };
    const { address } = await this.request<{ address: string }>("terminal.run", { cwd, labels, env, no_parent: true });
    if (show) void this.nameTabs();
    return address;
  }

  /**
   * Titles for the board's tabs in herdr-app. After the run, never before: a tab written ahead of its
   * terminal becomes a second, empty one (measured). The app adopts within a second or two — a few
   * tries, then give up: every later launch names what an earlier one could not (app closed).
   */
  private async nameTabs(): Promise<void> {
    for (let i = 0; i < 6; i++) {
      await this.pause(700);
      try {
        const { terminals } = await this.request<{ terminals: HcTerminal[] }>("terminal.list", { labels: { [SPACE_LABEL]: APP_SPACE } });
        const titles = new Map(terminals.filter((t) => t.state === "live").map((t) => [t.labels?.[TAB_LABEL] ?? "", t.labels?.[TITLE_LABEL] ?? ""]));
        const doc = await this.request<{ value: AppDoc | null; version: number }>("doc.get", { name: "herdr-app" });
        const { changed, pending } = nameAppTabs(doc.value, titles);
        // `version` makes it a compare-and-set: the app writing at the same moment is a conflict, retried.
        if (changed) await this.request("doc.set", { name: "herdr-app", value: doc.value, version: doc.version });
        if (!pending) return;
      } catch {
        /* a conflict or a core blip: next try */
      }
    }
  }

  private shellIn(paneId: string, cwd: string): CreatedShell {
    return { paneId, workspaceId: HC_SPACE, workspaceLabel: HC_SPACE, tabId: HC_SPACE, cwd };
  }

  async createWorkspace(opts: { cwd: string; label?: string; show?: BoardTab }): Promise<CreatedShell> {
    return this.shellIn(await this.shell(opts.cwd, opts.label, opts.show), opts.cwd);
  }

  /** No tab to inherit a directory from: a tab without a cwd would open in the core's. */
  async createTab(_workspaceId: string, opts: { label?: string; cwd?: string; show?: BoardTab } = {}): Promise<CreatedShell> {
    if (!opts.cwd) return this.no("createTab without a cwd");
    return this.shellIn(await this.shell(opts.cwd, opts.label, opts.show), opts.cwd);
  }

  renameTab(): Promise<void> { return this.no("renameTab"); }
  closeTab(): Promise<void> { return this.no("closeTab"); }
  reportPaneMetadata(): Promise<void> { return this.no("reportPaneMetadata"); }
  /** hc only pastes WITH Enter (`terminal.send`); a reply's own Enter after it could answer a dialog. */
  sendPaneText(): Promise<void> { return this.no("sendPaneText"); }

  /** The paste hc does have. Unforced, hc itself refuses a `blocked` program. */
  async sendPaneLine(paneId: string, text: string, force: boolean): Promise<void> {
    await this.request("terminal.send", { terminal: paneId, text, force }, SEND_TIMEOUT_MS);
  }

  async sendPaneKeys(paneId: string, keys: string[]): Promise<void> {
    await this.request("terminal.keys", { terminal: paneId, keys: keys.map(hcKey) });
  }

  /** `kill` refuses a program already gone; `rm` is what takes the terminal off the list. */
  async closePane(paneId: string): Promise<void> {
    await this.request("terminal.kill", { terminal: paneId }).catch(() => {});
    await this.request("terminal.rm", { terminal: paneId });
  }

  async renamePane(paneId: string, label: string | null): Promise<void> {
    await this.request("terminal.label", { terminal: paneId, labels: { [NAME_LABEL]: label ?? "" } });
  }

  // ── Worktrees: git's (bridge/git.ts), hc has none ──

  async createWorktree(opts: { cwd: string; branch: string; base?: string | null; label?: string; show?: BoardTab }): Promise<CreatedWorktree> {
    const checkout = worktreeDirFor(opts.cwd, opts.branch);
    const added = await addWorktreeAt(opts.cwd, checkout, opts.branch, opts.base ?? null, this.git);
    if (!added.ok) throw new Error(`git worktree add: ${added.error}`);
    return this.worktree(checkout, opts.branch, await this.shell(checkout, opts.label, opts.show), false);
  }

  /** Idempotent through the label: the live shell already in that checkout, else a new one. */
  async openWorktree(opts: { cwd: string; branch: string; label?: string; show?: BoardTab }): Promise<CreatedWorktree> {
    const checkout = await worktreePathFor(opts.cwd, opts.branch, this.git);
    if (!checkout) throw new Error(`no worktree for ${opts.branch}`);
    const r = await this.request<{ terminals: HcTerminal[] }>("terminal.list", { labels: { [CWD_LABEL]: checkout } });
    const live = r.terminals.find((t) => t.state === "live");
    // A shell from before the labels (or before herdr-app): labelling it after the fact files it too (measured).
    if (live && opts.show && !live.labels?.[TAB_LABEL]) {
      await this.request("terminal.label", { terminal: live.address, labels: appLabels(opts.show) }).catch(() => {});
      void this.nameTabs();
    }
    return this.worktree(checkout, opts.branch, live?.address ?? (await this.shell(checkout, opts.label, opts.show)), !!live);
  }

  private worktree(checkoutPath: string, branch: string, paneId: string, alreadyOpen: boolean): CreatedWorktree {
    return { checkoutPath, branch, workspaceId: HC_SPACE, workspaceLabel: HC_SPACE, tabId: HC_SPACE, paneId, alreadyOpen };
  }

  /** No workspace holds the checkout: say so in the words integrate.ts falls back to git on. */
  removeWorktree(): Promise<void> {
    return Promise.reject(new Error("hc: workspace_not_found (worktrees are git's)"));
  }

  // ── Agents — only through launchAgent()/promptAndConfirm() ──

  /** Types the agent's command into the pane's shell; readiness is `getAgent`'s, as for herdr 0.9. */
  async startAgent(opts: { paneId: string; kind: string; name: string; args?: string[] }): Promise<void> {
    await this.request("terminal.send", { terminal: opts.paneId, text: shellLine([opts.kind, ...(opts.args ?? [])]) }, SEND_TIMEOUT_MS);
  }

  /**
   * Ready = the program reports its own status (OSC 7501). Claude's trust dialog is up BEFORE it
   * probes for it (HERDR_CORE_API.md §2c), so a dialog is never ready and nothing is typed into it.
   */
  async getAgent(target: string): Promise<WireAgent> {
    const t = await this.request<HcTerminal>("terminal.get", { terminal: target });
    return { ...toWirePane(t), interactive_ready: hcAgent(t) !== null };
  }

  /**
   * `terminal.send` waits for the box to be quiet, pastes, presses Enter, and says whether the agent
   * went `working` (`started`; null = it reports no status). hc itself refuses a `blocked` agent.
   */
  async promptAgent(opts: { target: string; text: string }): Promise<boolean | null> {
    const r = await this.request<{ started?: boolean | null }>("terminal.send", { terminal: opts.target, text: opts.text }, SEND_TIMEOUT_MS);
    return r.started ?? null;
  }
}
